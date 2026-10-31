import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/home/PageShell";
import { MeshArt } from "@/components/news/MeshArt";
import { NewsBento } from "@/components/news/NewsBento";
import { chipClasses } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { getNewsClient } from "@/lib/api/news";
import { NEWS_CATEGORIES, type NewsCategory } from "@/lib/api/types";
import { publicConfig } from "@/lib/config";
import { Link } from "@/lib/i18n/navigation";
import { alternatesFor } from "@/lib/i18n/alternates";
import { asLocale } from "@/lib/i18n/locale";

const PAGE_SIZE = 12;

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: "Meta" });
  return { title: t("updates"), alternates: alternatesFor(asLocale(locale), "/updates") };
}

function parseCategory(value: unknown): NewsCategory | undefined {
  return NEWS_CATEGORIES.find((category) => category === value);
}

/** Paginated "Legal updates" (brief §3.2): same cards, server-rendered filters and pagination that work without JS. */
export default async function UpdatesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(asLocale(locale));
  const t = await getTranslations("Updates");
  const news = await getTranslations("News");
  const search = await searchParams;
  const category = parseCategory(search.category);
  const cursor =
    typeof search.cursor === "string" && /^\d{1,4}$/.test(search.cursor) ? search.cursor : null;
  const offset = cursor ? Number(cursor) : 0;
  const page = await getNewsClient().list({ category, limit: PAGE_SIZE, cursor });
  const serverNow = Date.now();

  const href = (next: { category?: NewsCategory | undefined; cursor?: number | undefined }) => {
    const query: Record<string, string> = {};
    if (next.category) query.category = next.category;
    if (next.cursor) query.cursor = String(next.cursor);
    return { pathname: "/updates" as const, query };
  };

  return (
    <PageShell>
      <div className="mx-auto max-w-page px-4 pt-10 pb-section-sm md:px-6 md:pt-16">
        <header className="relative isolate overflow-hidden rounded-card border border-hairline bg-ink">
          <MeshArt title={t("title")} category="supreme_court" className="absolute inset-0" />
          <div className="relative px-6 py-10 md:px-10 md:py-14">
            <p className="eyebrow text-onmesh">{t("eyebrow")}</p>
            <h1 className="mt-3 text-display font-semibold text-onmesh md:text-hero">
              {t("title")}
            </h1>
            <p className="mt-3 max-w-prose text-body text-onmesh">{t("subtitle")}</p>
          </div>
        </header>
        {publicConfig.useMocks ? (
          <p className="mt-2 text-caption text-ink-2">{news("fixtureNote")}</p>
        ) : null}

        <nav
          aria-label={news("filterLabel")}
          className="-mx-4 mt-6 [scrollbar-width:none] overflow-x-auto px-4 md:mx-0 md:px-0"
        >
          <ul className="flex gap-2">
            {([undefined, ...NEWS_CATEGORIES] as const).map((key) => (
              <li key={key ?? "all"} className="shrink-0">
                <Link
                  href={href({ category: key })}
                  aria-current={category === key ? "page" : undefined}
                  className={chipClasses(category === key)}
                >
                  {news(key ?? "all")}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {page.items.length === 0 ? (
          <p className="py-16 text-center text-callout text-ink-2">{news("empty")}</p>
        ) : (
          <div className="mt-8">
            <NewsBento items={page.items} serverNow={serverNow} headingLevel={2} />
          </div>
        )}

        <nav aria-label={t("pagination")} className="mt-10 flex items-center justify-between">
          {offset > 0 ? (
            <Link
              href={href({ category, cursor: Math.max(0, offset - PAGE_SIZE) })}
              className="inline-flex min-h-11 items-center gap-1 text-callout font-medium text-trust underline-offset-4 hover:underline"
            >
              <Icon name="chevron-left" size={16} />
              {t("newer")}
            </Link>
          ) : (
            <span />
          )}
          {page.next_cursor ? (
            <Link
              href={href({ category, cursor: Number(page.next_cursor) })}
              className="inline-flex min-h-11 items-center gap-1 text-callout font-medium text-trust underline-offset-4 hover:underline"
            >
              {t("older")}
              <Icon name="chevron-right" size={16} />
            </Link>
          ) : null}
        </nav>

        <p className="mt-10 text-caption text-ink-2">{t("attribution")}</p>
      </div>
    </PageShell>
  );
}
