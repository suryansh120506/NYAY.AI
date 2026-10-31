"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { NEWS_CATEGORIES, type NewsCategory, type NewsItem } from "@/lib/api/types";
import { Link } from "@/lib/i18n/navigation";
import { NewsBento } from "./NewsBento";

const MAX_HOME_ITEMS = 5;

/** Category pills filter on the client, without a page reload (brief §3.2). One bento group: a featured story and four more. */
export function NewsFeedView({ items, serverNow }: { items: NewsItem[]; serverNow: number }) {
  const t = useTranslations("News");
  const [category, setCategory] = useState<NewsCategory | "all">("all");
  const visible = (
    category === "all" ? items : items.filter((item) => item.category === category)
  ).slice(0, MAX_HOME_ITEMS);

  return (
    <>
      <div
        role="group"
        aria-label={t("filterLabel")}
        className="-mx-4 mt-6 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
      >
        {(["all", ...NEWS_CATEGORIES] as const).map((key) => (
          <Chip
            key={key}
            selected={category === key}
            onClick={() => setCategory(key)}
            className="shrink-0"
          >
            {t(key)}
          </Chip>
        ))}
      </div>

      <div className="mt-8" aria-live="polite">
        {visible.length > 0 ? (
          <NewsBento items={visible} serverNow={serverNow} />
        ) : (
          <p className="py-12 text-center text-callout text-ink-2">{t("empty")}</p>
        )}
      </div>

      <div className="mt-8 text-center">
        <Link
          href={category === "all" ? "/updates" : { pathname: "/updates", query: { category } }}
          className="inline-flex min-h-11 items-center gap-1 text-callout font-medium text-trust underline-offset-4 hover:underline"
        >
          {t("viewAll")}
          <Icon name="chevron-right" size={16} />
        </Link>
      </div>
    </>
  );
}
