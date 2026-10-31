import type { NewsCategory } from "@/lib/api/types";

/**
 * The picture for a news story is generated, not fetched: a mesh of soft colour blobs on a near-black base, derived
 * from a hash of the headline, so the same story always looks the same and no image host is involved.
 *
 * TODO(human): the feed carries no images, and showing a publisher's own picture needs a licence. When a licensed
 * source exists, render it in place of the mesh.
 */
export type Family = "navy" | "slate" | "crimson";
export type Tone = "a" | "b" | "c";

export interface Blob {
  /** Centre, in percent of the tile. */
  x: number;
  y: number;
  /** Radii, in percent. */
  rx: number;
  ry: number;
  tone: Tone;
  /** How much of the accent colour shows at the centre, in percent. */
  alpha: number;
}

export interface Mesh {
  family: Family;
  blobs: Blob[];
}

/** Courts get a family each (Supreme Court navy, Allahabad slate, Delhi crimson); legislation takes navy or slate. */
const FAMILY: Record<Exclude<NewsCategory, "legislation">, Family> = {
  supreme_court: "navy",
  allahabad_hc: "slate",
  delhi_hc: "crimson",
};

/** FNV-1a: a small, stable string hash. */
export function seedOf(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32: a tiny seeded generator, so the blobs are a pure function of the headline. */
export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TONES: readonly Tone[] = ["a", "b", "c", "a", "b"];

export function meshFor(title: string, category: NewsCategory): Mesh {
  const seed = seedOf(title);
  const random = seededRandom(seed);
  const family =
    category === "legislation" ? (seed % 2 === 0 ? "navy" : "slate") : FAMILY[category];
  const blobs = TONES.map((tone, index): Blob => {
    const bright = tone === "b";
    return {
      x: Math.round(random() * 100),
      // Spread the blobs over the height so the tile never ends up as one lit corner.
      y: Math.round(((index + random()) / TONES.length) * 100),
      rx: Math.round(44 + random() * 40),
      ry: Math.round(38 + random() * 36),
      tone,
      // The bright accent is kept softer so it reads as light in the mesh, not as a coloured shape.
      alpha: Math.round((bright ? 42 : 58) + random() * (bright ? 26 : 34)),
    };
  });
  return { family, blobs };
}

/** The CSS background layers for a mesh. Colours are the `--color-mesh-*` tokens; nothing is hard-coded here. */
export function meshBackground(mesh: Mesh): { backgroundColor: string; backgroundImage: string } {
  const layers = mesh.blobs.map(
    (b) =>
      `radial-gradient(${b.rx}% ${b.ry}% at ${b.x}% ${b.y}%, color-mix(in srgb, var(--color-mesh-${mesh.family}-${b.tone}) ${b.alpha}%, transparent), transparent 72%)`,
  );
  return {
    backgroundColor: `var(--color-mesh-${mesh.family}-base)`,
    backgroundImage: layers.join(", "),
  };
}
