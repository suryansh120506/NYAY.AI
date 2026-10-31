/**
 * Clause-level analysis shown beside a document. This is a preview built on a sample document (see sample.ts):
 * nothing here reads a visitor's own file yet.
 *
 * The score is deliberately simple and explained to the reader: each high-risk clause adds 22 points and each clause
 * to review adds 7, up to 100. It counts flagged clauses; it is not a prediction and not legal advice.
 */
export type Level = "high" | "review" | "standard";

export const POINTS: Record<Level, number> = { high: 22, review: 7, standard: 0 };

export type Tier = "low" | "moderate" | "high";

export function riskScore(levels: readonly Level[]): number {
  return Math.min(
    100,
    levels.reduce((sum, level) => sum + POINTS[level], 0),
  );
}

export function riskTier(score: number): Tier {
  if (score >= 60) return "high";
  if (score >= 30) return "moderate";
  return "low";
}

export function tally(levels: readonly Level[]): Record<Level, number> {
  const counts: Record<Level, number> = { high: 0, review: 0, standard: 0 };
  for (const level of levels) counts[level] += 1;
  return counts;
}

export type ClauseId =
  | "term"
  | "rent"
  | "revision"
  | "deposit"
  | "entry"
  | "repairs"
  | "termination"
  | "subletting"
  | "early"
  | "disputes";

/** Clauses that carry their own explanation and question in the messages; the rest use the generic wording. */
export type FlaggedId = "revision" | "deposit" | "entry" | "repairs" | "early";

const FLAGGED: ReadonlySet<ClauseId> = new Set([
  "revision",
  "deposit",
  "entry",
  "repairs",
  "early",
]);

export function isFlagged(id: ClauseId): id is FlaggedId {
  return FLAGGED.has(id);
}

export interface Clause {
  id: ClauseId;
  number: number;
  level: Level;
  /** 1-based page the clause is on. */
  page: number;
  /** The clause text exactly as it appears in the document. */
  text: string;
}
