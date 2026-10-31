import { describe, expect, it, vi } from "vitest";
import type * as UtilModule from "@/lib/api/mock/util";
import type { MatchRequest } from "@/lib/api/types";

vi.mock("@/lib/api/mock/util", async (importOriginal) => ({
  ...(await importOriginal<typeof UtilModule>()),
  latency: () => Promise.resolve(),
}));

const { FixtureParakhClient, classifyIntent, detectCity } = await import("@/lib/api/mock/parakh");
const { ADVOCATES, eligibleCourts, MORE_CITIES, PRIMARY_CITIES } =
  await import("@/lib/api/mock/fixtures");

const client = new FixtureParakhClient();
const ALL_CITIES = [...PRIMARY_CITIES, ...MORE_CITIES];
const QUERIES: Record<string, string> = {
  tenancy: "My landlord will not return my security deposit",
  cheque_bounce: "The cheque he gave me bounced",
  consumer: "The seller refuses a refund for a defective product",
  matrimonial: "I want to file for divorce and maintenance",
  criminal_bail: "My brother was arrested by the police, we need bail",
  property: "Dispute over partition of ancestral land and plot registry",
  employment: "My employer has not paid my salary for three months",
};

const request = (query_text: string, extra: Partial<MatchRequest> = {}): MatchRequest => ({
  query_text,
  locale: "en",
  tier: "standard",
  ...extra,
});

describe("intent (keyword stand-in for the LLM step)", () => {
  it.each(Object.entries(QUERIES))("classifies %s", (area, query) => {
    expect(classifyIntent(query).practice_area).toBe(area);
  });

  it("handles Hindi and Hinglish", () => {
    expect(classifyIntent("मेरे चेक का भुगतान नहीं हुआ")).toMatchObject({
      practice_area: "cheque_bounce",
      language: "hi",
    });
    expect(classifyIntent("mera makan malik deposit nahi de raha")).toMatchObject({
      practice_area: "tenancy",
      language: "hinglish",
    });
  });

  it("keeps statute mentions verbatim and never guesses an area", () => {
    expect(classifyIntent("Notice under section 138 for my cheque").statutes_mentioned).toEqual([
      "section 138",
    ]);
    expect(classifyIntent("I need some help").practice_area).toBeNull();
  });

  it("detects the city in any script", () => {
    expect(detectCity("लखनऊ में मकान मालिक")?.district).toBe("lucknow");
    expect(detectCity("I live in Allahabad")?.district).toBe("prayagraj");
    expect(detectCity("somewhere else")).toBeNull();
  });
});

describe("match", () => {
  it("asks exactly one follow-up (the city) when the location is unknown", async () => {
    const response = await client.match(request(QUERIES.tenancy ?? ""));
    expect(response.results).toEqual([]);
    expect(response.follow_up).toMatchObject({ kind: "location" });
    expect(response.follow_up?.primary).toHaveLength(4);
  });

  it("never returns an advocate outside the user's court jurisdiction (every city × every area)", async () => {
    for (const city of ALL_CITIES) {
      const allowed = new Set(eligibleCourts(city));
      for (const query of Object.values(QUERIES)) {
        const response = await client.match(
          request(query, { state: city.state, district: city.district }),
        );
        expect(response.results.length).toBeGreaterThan(0);
        expect(response.results.length).toBeLessThanOrEqual(3);
        for (const advocate of response.results) {
          expect(
            advocate.courts.some((court) => allowed.has(court.code)),
            `${advocate.display_name} in ${city.district}`,
          ).toBe(true);
        }
      }
    }
  });

  it("keeps Delhi and Uttar Pradesh pools separate", async () => {
    const delhi = await client.match(
      request(QUERIES.tenancy ?? "", { state: "DL", district: "delhi" }),
    );
    for (const advocate of delhi.results) {
      expect(
        advocate.courts.every((court) => court.code === "DELHI_HC" || court.code.startsWith("DL_")),
      ).toBe(true);
    }
  });

  it("only offers English-speaking advocates for English queries", async () => {
    const response = await client.match(
      request(QUERIES.employment ?? "", { state: "UP", district: "agra" }),
    );
    for (const advocate of response.results) expect(advocate.languages).toContain("en");
  });

  it("exposes factual fields only: no score or ranking signal reaches the client", async () => {
    const response = await client.match(
      request(QUERIES.tenancy ?? "", { state: "UP", district: "lucknow" }),
    );
    for (const advocate of response.results) {
      expect(
        Object.keys(advocate).filter((key) => /score|rank|trust|rating|percentile/i.test(key)),
      ).toEqual([]);
    }
  });

  it("adds the premium 'why' from structured fields only", async () => {
    const standard = await client.match(
      request(QUERIES.tenancy ?? "", { state: "UP", district: "lucknow" }),
    );
    expect(standard.results.every((a) => a.why === null)).toBe(true);

    const premium = await client.match(
      request(QUERIES.tenancy ?? "", { state: "UP", district: "lucknow", tier: "premium" }),
    );
    for (const advocate of premium.results) {
      expect(advocate.why).toContain(`${advocate.years_experience} years`);
      expect(advocate.why).not.toMatch(/\b(win|won|best|top|guarantee|success)/i);
    }
  });

  it("uses only clearly fictional demo advocates", () => {
    expect(ADVOCATES).toHaveLength(40);
    for (const advocate of ADVOCATES) {
      expect(advocate.display_name.startsWith("Demo ")).toBe(true);
      expect(advocate.enrolment_no.startsWith("DEMO/")).toBe(true);
    }
  });
});
