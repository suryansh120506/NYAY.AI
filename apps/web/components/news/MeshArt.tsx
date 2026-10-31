import type { NewsCategory } from "@/lib/api/types";
import { meshBackground, meshFor } from "@/lib/news/mesh";
import { cx } from "@/lib/text";

/**
 * Generated artwork for a story (see lib/news/mesh.ts): a deep-colour mesh with fine grain, a faint measuring grid and
 * a lit top edge. Pure CSS and server-rendered, so it paints with the page and never shifts layout. It is positioned by
 * its caller (for example `absolute inset-0` inside a sized, relative box).
 */
export function MeshArt({
  title,
  category,
  className,
}: {
  title: string;
  category: NewsCategory;
  className?: string;
}) {
  const mesh = meshFor(title, category);
  return (
    <div
      aria-hidden="true"
      data-mesh={mesh.family}
      style={meshBackground(mesh)}
      className={cx("isolate overflow-hidden", className)}
    >
      <div className="absolute inset-0 mesh-grid" />
      <div className="absolute inset-0 mesh-grain opacity-35 mix-blend-overlay" />
      <div className="absolute inset-x-0 top-0 h-1/2 mesh-sheen" />
    </div>
  );
}
