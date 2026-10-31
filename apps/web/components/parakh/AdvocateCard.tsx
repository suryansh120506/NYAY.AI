"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/Avatar";
import { avatarTransitionName } from "@/lib/navigation/view-transition";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/Skeleton";
import type { AdvocateMatch } from "@/lib/api/types";
import { formatPaise } from "@/lib/money";
import { useCourtName, useLanguageName } from "./useCourtName";

/**
 * Factual fields only (brief §0 regulatory guardrails): name, verification, courts, languages, practice areas,
 * experience and the disclosed per-minute price. No ratings, rankings, win rates or superlatives, ever.
 */
export function AdvocateCard({
  advocate,
  onConnect,
  connecting,
  disabled,
}: {
  advocate: AdvocateMatch;
  onConnect: () => void;
  connecting: boolean;
  disabled: boolean;
}) {
  const t = useTranslations("Advocate");
  const areas = useTranslations("PracticeAreas");
  const parakh = useTranslations("Parakh");
  const format = useFormatter();
  const courtName = useCourtName();
  const languageName = useLanguageName();

  const courts = format.list(advocate.courts.slice(0, 2).map(courtName), { type: "conjunction" });
  const languages = format.list(advocate.languages.map(languageName), { type: "conjunction" });

  return (
    <article
      aria-labelledby={`adv-${advocate.advocate_id}`}
      className="rounded-card border border-hairline bg-surface p-5 md:p-6"
    >
      <div className="flex items-start gap-4">
        <Avatar
          name={advocate.display_name}
          size="lg"
          transitionName={avatarTransitionName(advocate.advocate_id)}
        />
        <div className="min-w-0 flex-1">
          <h3 id={`adv-${advocate.advocate_id}`} className="text-headline font-semibold text-ink">
            {advocate.display_name}
          </h3>
          <p className="mt-0.5 flex items-start gap-1.5 text-callout text-ink-2">
            <Icon name="seal" size={18} className="mt-0.5 shrink-0 text-ok" />
            <span>{t("verifiedCourts", { courts })}</span>
          </p>
          <p className="mt-1 text-callout text-ink-2">
            {t("languages", { languages })}
            <span aria-hidden="true">{" · "}</span>
            {t("experience", { years: advocate.years_experience })}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-caption text-ink-2">
            <span
              aria-hidden="true"
              className={
                advocate.available_now
                  ? "h-2 w-2 rounded-round bg-ok"
                  : "h-2 w-2 rounded-round bg-ink-2/40"
              }
            />
            {advocate.available_now ? t("availableNow") : t("availableSoon")}
          </p>
        </div>
      </div>

      <ul className="mt-4 flex flex-wrap gap-2" aria-label={t("practiceAreas")}>
        {advocate.practice_areas.slice(0, 3).map((area) => (
          <li key={area}>
            <Tag>{areas(area)}</Tag>
          </li>
        ))}
      </ul>

      {advocate.why ? (
        <div className="mt-4 rounded-input bg-indigo/5 p-4">
          <p className="flex items-center gap-2 text-caption font-semibold text-indigo">
            <span className="rounded-input bg-indigo px-2 py-0.5 text-surface">{t("premium")}</span>
            {t("why")}
          </p>
          <p className="mt-1.5 text-callout text-ink">{advocate.why}</p>
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-4 border-t border-hairline pt-4">
        <p className="min-w-0 text-callout text-ink-2 tabular">
          {t("price", {
            rate: formatPaise(advocate.rate_paise_per_min, { trimZeroPaise: true }),
            fee: formatPaise(advocate.platform_fee_paise_per_min, { trimZeroPaise: true }),
          })}
        </p>
        <Button
          variant="tinted"
          onClick={onConnect}
          disabled={disabled}
          aria-label={t("connectTo", { name: advocate.display_name })}
          className="shrink-0"
        >
          {connecting ? parakh("connecting") : t("connect")}
        </Button>
      </div>
    </article>
  );
}

export function AdvocateCardSkeleton() {
  return (
    <div className="rounded-card border border-hairline bg-surface p-5 md:p-6" aria-hidden="true">
      <div className="flex items-start gap-4">
        <Skeleton rounded="circle" className="h-14 w-14 shrink-0" />
        <div className="flex-1">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="mt-2.5 h-4 w-3/4" />
          <Skeleton className="mt-2 h-4 w-2/3" />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Skeleton rounded="control" className="h-7 w-24" />
        <Skeleton rounded="control" className="h-7 w-20" />
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-hairline pt-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton rounded="control" className="h-11 w-28" />
      </div>
    </div>
  );
}
