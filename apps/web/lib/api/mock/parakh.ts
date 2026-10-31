import type { ParakhClient } from "@/lib/api/clients";
import type {
  AdvocateMatch,
  CityOption,
  MatchIntent,
  MatchRequest,
  MatchResponse,
  PracticeArea,
} from "@/lib/api/types";
import {
  ADVOCATES,
  courtRef,
  eligibleCourts,
  MORE_CITIES,
  PRIMARY_CITIES,
  type FixtureAdvocate,
} from "./fixtures";
import { PLATFORM_FEE_PAISE } from "./constants";
import { latency, uid } from "./util";

/**
 * Offline stand-in for the Parakh pipeline (brief §1.3): keyword intent instead of the LLM, the same court-
 * jurisdiction hard filter, and a simple relevance score instead of vector search. No trust signal of any kind
 * exists on the frontend.
 */

const AREA_KEYWORDS: Record<PracticeArea, RegExp> = {
  tenancy:
    /landlord|tenant|\brent\b|deposit|evict|lease|kiraya|kirayedar|makan malik|किराय|मकान मालिक|किरायेदार|बेदखल|जमा राशि/i,
  cheque_bounce: /cheque|check bounce|bounced|bounce|\b138\b|चेक|भुगतान नहीं हुआ/i,
  consumer:
    /consumer|refund|defective|warranty|seller|product|online order|delivery|उपभोक्ता|रिफंड|ख़राब|खराब|सामान/i,
  matrimonial:
    /divorce|marriage|husband|wife|dowry|maintenance|alimony|talaq|shaadi|तलाक|शादी|पति|पत्नी|दहेज|भरण-पोषण/i,
  criminal_bail:
    /\bbail\b|\bfir\b|arrest|police|jail|zamanat|ज़मानत|जमानत|गिरफ्तार|गिरफ़्तार|पुलिस|एफआईआर/i,
  property:
    /property|\bland\b|plot|registry|mutation|partition|inheritance|\bwill\b|zameen|ज़मीन|जमीन|संपत्ति|प्लॉट|रजिस्ट्री|बंटवारा/i,
  employment:
    /salary|employer|\bjob\b|fired|terminated|wages|gratuity|\bpf\b|naukri|नौकरी|वेतन|तनख्वाह|तनख़्वाह/i,
};

const CITY_PATTERNS: Array<[CityOption, RegExp]> = [
  [{ district: "lucknow", state: "UP" }, /lucknow|lakhnau|लखनऊ/i],
  [{ district: "delhi", state: "DL" }, /delhi|dilli|दिल्ली/i],
  [{ district: "prayagraj", state: "UP" }, /prayagraj|allahabad|प्रयागराज|इलाहाबाद/i],
  [{ district: "kanpur_nagar", state: "UP" }, /kanpur|कानपुर/i],
  [{ district: "varanasi", state: "UP" }, /varanasi|banaras|benaras|kashi|वाराणसी|बनारस/i],
  [{ district: "agra", state: "UP" }, /\bagra\b|आगरा/i],
  [{ district: "gautam_buddh_nagar", state: "UP" }, /noida|gautam buddh nagar|नोएडा/i],
  [{ district: "ghaziabad", state: "UP" }, /ghaziabad|गाज़ियाबाद|गाजियाबाद/i],
];

const STATUTE_PATTERN =
  /(?:section|sec\.?|धारा|दफा)\s*\d+[a-z]?|\b(?:IPC|BNS|BNSS|CrPC|NI Act)\b/gi;
const HINGLISH =
  /\b(hai|mera|meri|mere|nahi|nahin|kya|kaise|mein|aur|ko|se|ka|ki|ke|raha|rahi|diya)\b/i;

export function classifyIntent(query: string): MatchIntent {
  const scores = (Object.entries(AREA_KEYWORDS) as Array<[PracticeArea, RegExp]>)
    .map(([area, rx]) => [area, (query.match(new RegExp(rx.source, "gi")) ?? []).length] as const)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const language = /[ऀ-ॿ]/.test(query) ? "hi" : HINGLISH.test(query) ? "hinglish" : "en";
  return {
    practice_area: scores[0]?.[0] ?? null,
    sub_issue: null,
    forum: null,
    urgency: /urgent|arrest|tomorrow|today|turant|abhi|तुरंत|आज|कल/i.test(query)
      ? "high"
      : "normal",
    statutes_mentioned: Array.from(new Set(query.match(STATUTE_PATTERN) ?? [])),
    language,
  };
}

export function detectCity(query: string): CityOption | null {
  return CITY_PATTERNS.find(([, rx]) => rx.test(query))?.[0] ?? null;
}

function relevance(advocate: FixtureAdvocate, intent: MatchIntent): number {
  const semantic = intent.practice_area
    ? advocate.practice_areas.includes(intent.practice_area)
      ? 1 - advocate.practice_areas.indexOf(intent.practice_area) * 0.1
      : 0.25
    : 0.5;
  const availability = advocate.available_now
    ? 1 - Math.min(advocate.avg_response_seconds, 300) / 600
    : 0.3;
  const experience = Math.min(advocate.years_experience, 25) / 25;
  const priceFit = 1 - (advocate.rate_paise_per_min - 1_500) / 6_000;
  // Same weight shape as the real reranker (0.60 / 0.25 / 0.10 / 0.05); experience stands in for the hidden signal.
  return 0.6 * semantic + 0.25 * experience + 0.1 * availability + 0.05 * priceFit;
}

const LANGUAGE_NAMES: Record<"en" | "hi", Record<string, string>> = {
  en: { hi: "Hindi", en: "English", ur: "Urdu", pa: "Punjabi", bho: "Bhojpuri" },
  hi: { hi: "हिंदी", en: "अंग्रेज़ी", ur: "उर्दू", pa: "पंजाबी", bho: "भोजपुरी" },
};

const AREA_NAMES: Record<"en" | "hi", Record<PracticeArea, string>> = {
  en: {
    tenancy: "tenancy",
    cheque_bounce: "cheque bounce",
    consumer: "consumer",
    matrimonial: "matrimonial",
    criminal_bail: "criminal and bail",
    property: "property",
    employment: "employment",
  },
  hi: {
    tenancy: "किरायेदारी",
    cheque_bounce: "चेक बाउंस",
    consumer: "उपभोक्ता",
    matrimonial: "वैवाहिक",
    criminal_bail: "आपराधिक और ज़मानत",
    property: "संपत्ति",
    employment: "रोज़गार",
  },
};

/** Premium "why": built only from matched structured fields; never a claim about outcomes (brief §1.3 step 6). */
function whySentence(advocate: FixtureAdvocate, intent: MatchIntent, locale: "en" | "hi"): string {
  const area =
    intent.practice_area && advocate.practice_areas.includes(intent.practice_area)
      ? intent.practice_area
      : advocate.practice_areas[0];
  const areaName = area ? AREA_NAMES[locale][area] : "";
  const court = courtRef(advocate.courts[0] ?? "").name;
  const languages = advocate.languages
    .map((code) => LANGUAGE_NAMES[locale][code] ?? code)
    .join(locale === "hi" ? ", " : " and ");
  return locale === "hi"
    ? `${court} में ${areaName} मामलों में प्रैक्टिस, ${languages} बोलते हैं, ${advocate.years_experience} वर्ष का अनुभव।`
    : `Practises ${areaName} matters at ${court}, speaks ${languages}, and has ${advocate.years_experience} years in practice.`;
}

function toMatch(
  advocate: FixtureAdvocate,
  intent: MatchIntent,
  request: MatchRequest,
): AdvocateMatch {
  return {
    advocate_id: advocate.id,
    display_name: advocate.display_name,
    enrolment_no: advocate.enrolment_no,
    state_bar_council: advocate.state_bar_council,
    courts: advocate.courts.map(courtRef),
    languages: advocate.languages,
    practice_areas: advocate.practice_areas,
    years_experience: advocate.years_experience,
    rate_paise_per_min: advocate.rate_paise_per_min,
    platform_fee_paise_per_min: PLATFORM_FEE_PAISE,
    available_now: advocate.available_now,
    why: request.tier === "premium" ? whySentence(advocate, intent, request.locale) : null,
  };
}

export class FixtureParakhClient implements ParakhClient {
  async match(request: MatchRequest): Promise<MatchResponse> {
    await latency(700, 1_200);
    const intent = classifyIntent(request.query_text);
    const location: CityOption | null =
      request.district && request.state
        ? { district: request.district, state: request.state }
        : detectCity(request.query_text);
    const base = { match_id: uid("match"), intent, degraded: false };

    if (!location) {
      return {
        ...base,
        results: [],
        location: null,
        follow_up: { kind: "location", primary: PRIMARY_CITIES, more: MORE_CITIES },
      };
    }

    const courts = new Set(eligibleCourts(location));
    const needsEnglish = intent.language === "en";
    const results = ADVOCATES.filter(
      (advocate) =>
        advocate.verification_status === "verified" &&
        advocate.courts.some((code) => courts.has(code)) &&
        (!needsEnglish || advocate.languages.includes("en")),
    )
      .map((advocate) => ({ advocate, score: relevance(advocate, intent) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ advocate }) => toMatch(advocate, intent, request));

    return { ...base, results, location, follow_up: null };
  }
}
