import { findProvision, keyOf, type ActId, type Provision } from "./bare-acts";

export interface SectionMention {
  act: ActId | null;
  section: string;
}

const ACT_WORDS: Array<[RegExp, ActId]> = [
  [/^(?:ipc|i\.p\.c\.?|indian penal code|आईपीसी|भारतीय दंड संहिता)$/i, "IPC"],
  [/^(?:bns|b\.n\.s\.?|bharatiya nyaya sanhita|भारतीय न्याय संहिता)$/i, "BNS"],
  [/^(?:crpc|cr\.?\s?p\.?\s?c\.?|code of criminal procedure)$/i, "CRPC"],
  [/^(?:bnss|b\.n\.s\.s\.?|bharatiya nagarik suraksha sanhita)$/i, "BNSS"],
  [/^(?:ni act|n\.i\. act|negotiable instruments act)$/i, "NI"],
];

const ACT_PATTERN =
  "ipc|i\\.p\\.c\\.?|indian penal code|आईपीसी|भारतीय दंड संहिता|bns|b\\.n\\.s\\.?|bharatiya nyaya sanhita|भारतीय न्याय संहिता|crpc|cr\\.?\\s?p\\.?\\s?c\\.?|code of criminal procedure|bnss|bharatiya nagarik suraksha sanhita|ni act|n\\.i\\. act|negotiable instruments act";

const NUMBER = "\\d{1,3}[A-Za-z]?";
// "Section 420", "Sec. 498A", "u/s 406", "s. 379", "Sections 420 and 406", "धारा 420"; optionally followed by an Act.
const WITH_KEYWORD = new RegExp(
  `(?:\\b(?:sections?|sec\\.?|u\\/s|s\\.)\\s*|धारा\\s*)(${NUMBER}(?:\\s*(?:,|and|&|और)\\s*${NUMBER})*)(?:\\s*\\(\\w{1,3}\\))*(?:[\\s,]*(?:of\\s+(?:the\\s+)?)?(${ACT_PATTERN})(?![\\p{L}]))?`,
  "giu",
);
// "420 IPC", "498A of the IPC".
const WITHOUT_KEYWORD = new RegExp(
  `(?<![\\w.])(${NUMBER})\\s*(?:of\\s+(?:the\\s+)?)?(${ACT_PATTERN})(?![\\p{L}])`,
  "giu",
);

function actFrom(word: string | undefined): ActId | null {
  if (!word) return null;
  const clean = word.trim();
  return ACT_WORDS.find(([pattern]) => pattern.test(clean))?.[1] ?? null;
}

/** Every distinct (act, section) a piece of text refers to, in order of appearance. */
export function extractMentions(text: string): SectionMention[] {
  const found: Array<SectionMention & { index: number }> = [];
  for (const match of text.matchAll(WITH_KEYWORD)) {
    const act = actFrom(match[2]);
    for (const number of (match[1] ?? "").matchAll(new RegExp(NUMBER, "g"))) {
      found.push({ act, section: number[0].toUpperCase(), index: match.index ?? 0 });
    }
  }
  for (const match of text.matchAll(WITHOUT_KEYWORD)) {
    found.push({
      act: actFrom(match[2]),
      section: (match[1] ?? "").toUpperCase(),
      index: match.index ?? 0,
    });
  }
  found.sort((a, b) => a.index - b.index);
  const named = new Set(found.filter((m) => m.act).map((m) => m.section));
  const seen = new Set<string>();
  return found
    .filter((m) => !(m.act === null && named.has(m.section)))
    .filter((m) => {
      const key = `${m.act ?? "?"}:${m.section}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ act, section }) => ({ act, section }));
}

export interface Mention {
  /** Who wrote the message, from the viewer's side ("user" is the viewer). */
  from: "user" | "advocate";
  ts: string;
  seq: number | null;
}

export interface Citation {
  key: string;
  act: ActId | null;
  section: string;
  /** Null when the section is not in the reference library. */
  provision: Provision | null;
  mentions: Mention[];
}

export interface CitedMessage {
  from: "user" | "advocate";
  text: string;
  ts: string;
  seq: number | null;
}

/**
 * Citations for a conversation, most recently mentioned first. A section with no Act named is read as the Indian
 * Penal Code when that is the only library Act containing it (the usual shorthand), and otherwise stays unattributed.
 */
export function collectCitations(messages: CitedMessage[]): Citation[] {
  const byKey = new Map<string, Citation>();
  for (const message of messages) {
    for (const mention of extractMentions(message.text)) {
      const act = mention.act ?? (findProvision("IPC", mention.section) ? "IPC" : null);
      const key = act ? keyOf(act, mention.section) : `?:${mention.section}`;
      const existing = byKey.get(key);
      const entry: Mention = { from: message.from, ts: message.ts, seq: message.seq };
      if (existing) existing.mentions.push(entry);
      else
        byKey.set(key, {
          key,
          act,
          section: mention.section,
          provision: act ? findProvision(act, mention.section) : null,
          mentions: [entry],
        });
    }
  }
  for (const [key, loose] of [...byKey]) {
    if (!key.startsWith("?:")) continue;
    const owner = [...byKey.values()].find((c) => c.act !== null && c.section === loose.section);
    if (!owner) continue;
    owner.mentions.push(...loose.mentions);
    owner.mentions.sort((a, b) => a.ts.localeCompare(b.ts));
    byKey.delete(key);
  }
  const last = (c: Citation) => c.mentions[c.mentions.length - 1]?.ts ?? "";
  return [...byKey.values()].sort((a, b) => last(b).localeCompare(last(a)));
}
