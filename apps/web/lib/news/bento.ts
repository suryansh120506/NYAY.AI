/**
 * Bento layout for the news grid: a repeating group of five tiles (one featured tile spanning two rows, two small
 * tiles beside it, then two half-width tiles). A short last group is rebalanced so the grid never ends with a hole.
 */
export type Tile = "feature" | "small" | "half" | "wide";

const CYCLE: readonly Tile[] = ["feature", "small", "small", "half", "half"];

export function bentoTiles(count: number): Tile[] {
  const tiles: Tile[] = [];
  const full = Math.floor(count / CYCLE.length);
  for (let i = 0; i < full; i += 1) tiles.push(...CYCLE);
  switch (count % CYCLE.length) {
    case 1:
      tiles.push("wide");
      break;
    case 2:
      tiles.push("half", "half");
      break;
    case 3:
      tiles.push("small", "small", "small");
      break;
    case 4:
      tiles.push("half", "half", "half", "half");
      break;
  }
  return tiles;
}

/** Tailwind classes per tile: one column on phones, two from `sm`, a six-column bento from `lg`. */
export const TILE_CLASSES: Record<Tile, string> = {
  feature: "sm:col-span-2 lg:col-span-4 lg:row-span-2",
  small: "lg:col-span-2",
  half: "lg:col-span-3",
  wide: "sm:col-span-2 lg:col-span-6",
};
