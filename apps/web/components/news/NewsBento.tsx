import { ArrowUpRight, Gavel, Landmark, Scale, ScrollText, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { NewsCategory, NewsItem } from "@/lib/api/types";
import { bentoTiles, TILE_CLASSES, type Tile } from "@/lib/news/bento";
import { cx } from "@/lib/text";
import { MeshArt } from "./MeshArt";
import { RelativeTime } from "./RelativeTime";

const CATEGORY_ICON: Record<NewsCategory, LucideIcon> = {
  supreme_court: Scale,
  allahabad_hc: Landmark,
  delhi_hc: Gavel,
  legislation: ScrollText,
};

/** A frosted chip on the artwork: translucent fill, hairline edge, blur. */
function CategoryBadge({ category }: { category: NewsCategory }) {
  const t = useTranslations("News");
  const Icon = CATEGORY_ICON[category];
  return (
    <span
      data-testid="news-badge"
      className="absolute top-3 left-3 inline-flex h-7 items-center gap-1.5 rounded-md border border-onmesh-edge bg-onmesh-glass px-2.5 text-caption font-medium text-onmesh backdrop-blur-md"
    >
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {t(category)}
    </span>
  );
}

function BentoCard({
  item,
  tile,
  serverNow,
  headingLevel,
}: {
  item: NewsItem;
  tile: Tile;
  serverNow: number;
  headingLevel: 2 | 3;
}) {
  const t = useTranslations("News");
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const feature = tile === "feature";
  const wide = tile === "wide";
  return (
    <a
      href={item.canonical_url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="news-card"
      data-tile={tile}
      className={cx(
        "group flex h-full overflow-hidden rounded-card border border-hairline bg-surface shadow-hairline",
        "transition-[translate,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-ink/20 hover:shadow-lift",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        wide ? "flex-col md:flex-row" : "flex-col",
      )}
    >
      <div
        className={cx(
          "relative shrink-0 overflow-hidden bg-ink",
          feature ? "aspect-[16/10] lg:aspect-auto lg:min-h-72 lg:flex-1" : "aspect-[16/10]",
          wide && "md:aspect-auto md:min-h-48 md:w-5/12",
        )}
      >
        <MeshArt
          title={item.title}
          category={item.category}
          className="absolute inset-0 transition-transform duration-500 ease-out group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
        <CategoryBadge category={item.category} />
      </div>
      <div className={cx("flex flex-col p-4 md:p-5", wide && "md:flex-1", feature && "lg:p-6")}>
        <p className="text-caption text-ink-2">
          <span className="font-medium text-ink">{item.source}</span>
          <span aria-hidden="true">{" · "}</span>
          <RelativeTime iso={item.published_at} serverNow={serverNow} />
        </p>
        <Heading
          className={cx(
            "mt-2 line-clamp-3 font-semibold text-ink",
            feature ? "text-headline @lg:text-display" : "text-headline",
          )}
        >
          {item.title}
        </Heading>
        {feature || wide ? (
          <p className="mt-2 line-clamp-3 text-callout text-ink-2">{item.excerpt}</p>
        ) : null}
        <span className="mt-auto inline-flex items-center gap-1 pt-4 text-callout font-medium text-trust">
          {t("readOn", { source: item.source })}
          <ArrowUpRight
            size={16}
            aria-hidden="true"
            className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
          />
        </span>
        <span className="sr-only">{t("opensInNewTab")}</span>
      </div>
    </a>
  );
}

/**
 * The "Legal updates" bento grid: one featured tile with a large generated mesh, then smaller tiles, each with a
 * frosted category badge, the publisher and the time. Always an external link to the publisher; we never copy
 * article text (brief §1.3 News). Heading level is 3 under the home page's h2 and 2 under the /updates h1.
 */
export function NewsBento({
  items,
  serverNow,
  headingLevel = 3,
}: {
  items: NewsItem[];
  serverNow: number;
  headingLevel?: 2 | 3;
}) {
  const tiles = bentoTiles(items.length);
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6" data-testid="news-bento">
      {items.map((item, index) => (
        <li
          key={item.id}
          className={cx("@container min-w-0", TILE_CLASSES[tiles[index] ?? "small"])}
        >
          <BentoCard
            item={item}
            tile={tiles[index] ?? "small"}
            serverNow={serverNow}
            headingLevel={headingLevel}
          />
        </li>
      ))}
    </ul>
  );
}
