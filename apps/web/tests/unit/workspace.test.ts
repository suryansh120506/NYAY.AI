import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import { PROVISIONS, findProvision } from "@/lib/legal/bare-acts";
import { collectCitations, extractMentions } from "@/lib/legal/citations";
import { bentoTiles, type Tile } from "@/lib/news/bento";
import { meshBackground, meshFor, seededRandom, seedOf } from "@/lib/news/mesh";
import { isFlagged, POINTS, riskScore, riskTier, tally } from "@/lib/saransh/analysis";
import { SAMPLE_CLAUSES, SAMPLE_PAGES } from "@/lib/saransh/sample";

describe("news bento", () => {
  const AREA: Record<Tile, number> = { feature: 8, small: 2, half: 3, wide: 6 };

  it("never leaves a hole: the tiles always fill whole rows of the six-column grid", () => {
    for (let n = 0; n <= 24; n += 1) {
      const tiles = bentoTiles(n);
      expect(tiles).toHaveLength(n);
      expect(tiles.reduce((sum, tile) => sum + AREA[tile], 0) % 6).toBe(0);
    }
  });

  it("starts every group of five with the featured tile", () => {
    expect(bentoTiles(5)).toEqual(["feature", "small", "small", "half", "half"]);
    expect(bentoTiles(12).filter((t) => t === "feature")).toHaveLength(2);
    expect(bentoTiles(1)).toEqual(["wide"]);
  });
});

describe("news mesh art", () => {
  const TITLE =
    "Supreme Court registry explains the new steps for filing urgent mentioning requests";

  it("is a pure function of the headline: same story, same picture", () => {
    expect(seedOf("a headline")).toBe(seedOf("a headline"));
    expect(seedOf("a headline")).not.toBe(seedOf("another headline"));
    expect(meshFor(TITLE, "supreme_court")).toEqual(meshFor(TITLE, "supreme_court"));
    expect(meshBackground(meshFor(TITLE, "supreme_court"))).not.toEqual(
      meshBackground(meshFor("A different headline entirely", "supreme_court")),
    );
  });

  it("gives each court its own deep colour family", () => {
    expect(meshFor(TITLE, "supreme_court").family).toBe("navy");
    expect(meshFor(TITLE, "allahabad_hc").family).toBe("slate");
    expect(meshFor(TITLE, "delhi_hc").family).toBe("crimson");
    expect(["navy", "slate"]).toContain(meshFor(TITLE, "legislation").family);
  });

  it("builds five blobs inside the tile, spread over its height", () => {
    const { blobs } = meshFor(TITLE, "delhi_hc");
    expect(blobs).toHaveLength(5);
    for (const blob of blobs) {
      expect(blob.x).toBeGreaterThanOrEqual(0);
      expect(blob.x).toBeLessThanOrEqual(100);
      expect(blob.y).toBeGreaterThanOrEqual(0);
      expect(blob.y).toBeLessThanOrEqual(100);
      expect(blob.alpha).toBeGreaterThan(30);
      expect(blob.alpha).toBeLessThan(95);
    }
  });

  it("uses only design tokens for colour, never a literal", () => {
    const { backgroundColor, backgroundImage } = meshBackground(meshFor(TITLE, "supreme_court"));
    expect(backgroundColor).toBe("var(--color-mesh-navy-base)");
    expect(backgroundImage).toMatch(/var\(--color-mesh-navy-[abc]\)/);
    expect(backgroundImage).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it("the generator is repeatable across seeds", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("section mentions", () => {
  const sections = (text: string) =>
    extractMentions(text).map((m) => `${m.act ?? "?"}:${m.section}`);

  it("finds sections written the ways people write them", () => {
    expect(sections("Is Section 420 IPC applicable?")).toEqual(["IPC:420"]);
    expect(sections("they filed u/s 406 of the Indian Penal Code")).toEqual(["IPC:406"]);
    expect(sections("sec. 498a, ipc")).toEqual(["IPC:498A"]);
    expect(sections("धारा 420 के तहत")).toEqual(["?:420"]);
    expect(sections("Under 379 IPC it is theft")).toEqual(["IPC:379"]);
  });

  it("reads a list of sections and attaches the Act to all of them", () => {
    expect(sections("Sections 420 and 406 IPC were added")).toEqual(["IPC:420", "IPC:406"]);
    expect(sections("sections 85, 86 of the BNS")).toEqual(["BNS:85", "BNS:86"]);
  });

  it("ignores numbers that are not sections", () => {
    expect(sections("My flat is room 420 and costs 4200 a month")).toEqual([]);
    expect(sections("Section of the road was closed")).toEqual([]);
  });

  it("counts each section once per message", () => {
    expect(sections("Section 420 IPC, yes section 420 again")).toEqual(["IPC:420"]);
  });
});

describe("citations", () => {
  const at = (minute: number) => `2026-10-16T10:0${minute}:00.000Z`;

  it("gives a full card for library sections and a plain one for the rest", () => {
    const result = collectCitations([
      { from: "user", text: "He cheated me, Section 420?", ts: at(1), seq: 1 },
      { from: "advocate", text: "Also look at Section 304 and 498A", ts: at(2), seq: 2 },
    ]);
    const byKey = Object.fromEntries(result.map((c) => [c.key, c]));
    expect(byKey["IPC:420"]?.provision?.title).toMatch(/Cheating/);
    expect(byKey["IPC:498A"]?.provision).not.toBeNull();
    expect(byKey["?:304"]?.provision).toBeNull();
  });

  it("lists the most recently mentioned section first and keeps every mention", () => {
    const result = collectCitations([
      { from: "user", text: "Section 420", ts: at(1), seq: 1 },
      { from: "advocate", text: "Section 406 IPC", ts: at(2), seq: 2 },
      { from: "advocate", text: "Back to section 420 IPC", ts: at(3), seq: 3 },
    ]);
    expect(result.map((c) => c.key)).toEqual(["IPC:420", "IPC:406"]);
    expect(result[0]?.mentions.map((m) => m.from)).toEqual(["user", "advocate"]);
  });

  it("returns nothing for a conversation without sections", () => {
    expect(collectCitations([{ from: "user", text: "Hello", ts: at(1), seq: 1 }])).toEqual([]);
  });
});

describe("reference library", () => {
  it("is well formed: unique keys, text present, replaced Acts say what replaced them", () => {
    const keys = PROVISIONS.map((p) => `${p.act}:${p.section}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const provision of PROVISIONS) {
      expect(provision.text.length).toBeGreaterThan(0);
      expect(provision.text.join(" ")).not.toMatch(/—/);
      if (provision.act === "IPC") expect(provision.replaced?.by).toBe("BNS");
    }
    expect(findProvision("IPC", "420")?.text[0]).toMatch(/seven years/);
  });
});

describe("document analysis", () => {
  const levels = SAMPLE_CLAUSES.map((c) => c.level);

  it("scores flagged clauses: 22 per high, 7 per review, capped at 100", () => {
    expect(POINTS).toEqual({ high: 22, review: 7, standard: 0 });
    expect(riskScore([])).toBe(0);
    expect(riskScore(["standard", "standard"])).toBe(0);
    expect(riskScore(["high", "review"])).toBe(29);
    expect(riskScore(Array(10).fill("high"))).toBe(100);
  });

  it("maps scores to tiers", () => {
    expect([0, 29, 30, 59, 60, 100].map(riskTier)).toEqual([
      "low",
      "low",
      "moderate",
      "moderate",
      "high",
      "high",
    ]);
  });

  it("the sample lease has three high-risk, two review and five standard clauses", () => {
    expect(tally(levels)).toEqual({ high: 3, review: 2, standard: 5 });
    expect(riskScore(levels)).toBe(80);
  });

  it("places every clause exactly once, in order, on a real page", () => {
    expect(SAMPLE_CLAUSES.map((c) => c.number)).toEqual(SAMPLE_CLAUSES.map((_, i) => i + 1));
    const placed = SAMPLE_PAGES.flatMap((p) => p.blocks.filter((b) => b.type === "clause"));
    expect(placed).toHaveLength(SAMPLE_CLAUSES.length);
    for (const clause of SAMPLE_CLAUSES)
      expect(clause.page).toBeLessThanOrEqual(SAMPLE_PAGES.length);
  });

  it("every flagged clause has a reason and a question in both languages", () => {
    for (const messages of [en, hi]) {
      const clauses = messages.Analysis.clauses as Record<string, Record<string, string>>;
      for (const clause of SAMPLE_CLAUSES) {
        expect(clauses[clause.id]?.title, clause.id).toBeTruthy();
        if (isFlagged(clause.id)) {
          expect(clauses[clause.id]?.why, clause.id).toBeTruthy();
          expect(clauses[clause.id]?.ask, clause.id).toBeTruthy();
        }
      }
    }
    // Only high and review clauses are flagged.
    expect(
      SAMPLE_CLAUSES.filter((c) => isFlagged(c.id))
        .map((c) => c.level)
        .sort(),
    ).toEqual(["high", "high", "high", "review", "review"]);
  });
});
