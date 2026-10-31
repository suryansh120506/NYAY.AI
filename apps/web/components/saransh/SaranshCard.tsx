"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/Icon";
import { ModuleLabel } from "@/components/ui/ModuleLabel";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { Tag } from "@/components/ui/Chip";
import type { SaranshDocument } from "@/lib/api/types";
import { LOW_CONFIDENCE } from "@/lib/saransh/useSaranshDocument";
import { cx } from "@/lib/text";

/**
 * Exactly three plain bullets plus the mandatory "AI summary. Please verify with your advocate." line
 * (brief §1.3 Saransh, rule 9). Shape-accurate skeleton while the job runs.
 */
export function SaranshCard({
  document,
  loading,
  className,
}: {
  document: SaranshDocument | undefined;
  loading: boolean;
  className?: string;
}) {
  const t = useTranslations("Saransh");
  const common = useTranslations("Common");

  if (loading || !document || document.status === "processing" || document.status === "uploaded") {
    return (
      <SkeletonRegion
        label={t("processing")}
        className={cx("rounded-card bg-surface p-5", className)}
      >
        <ModuleLabel module="saransh" />
        <Skeleton className="mt-3 h-5 w-2/3" />
        <ul className="mt-4 flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-start gap-3">
              <Skeleton rounded="circle" className="mt-1.5 h-2 w-2 shrink-0" />
              <Skeleton className={cx("h-4", i === 2 ? "w-3/5" : "w-full")} />
            </li>
          ))}
        </ul>
        <Skeleton className="mt-5 h-3 w-1/2" />
      </SkeletonRegion>
    );
  }

  if (document.status === "failed" || !document.result) {
    return (
      <div className={cx("rounded-card bg-surface p-5", className)}>
        <ModuleLabel module="saransh" />
        <p className="mt-3 flex items-start gap-2 text-callout text-ink" role="alert">
          <Icon name="warning" size={18} className="mt-0.5 shrink-0 text-warn" />
          {t("failed")}
        </p>
      </div>
    );
  }

  const { result } = document;
  const lowConfidence = result.confidence < LOW_CONFIDENCE;

  return (
    <section
      aria-labelledby={`saransh-${document.id}`}
      className={cx("rounded-card bg-surface p-5", className)}
      lang={result.language}
    >
      <div className="flex items-center justify-between gap-3">
        <ModuleLabel module="saransh" />
        {document.is_demo ? <Tag>{common("demo")}</Tag> : null}
      </div>
      <h3
        id={`saransh-${document.id}`}
        className="mt-2 truncate text-callout font-semibold text-ink"
      >
        {t("summaryTitle", { name: document.file_name })}
      </h3>
      <ul className="mt-3 flex flex-col gap-2.5">
        {result.bullets.map((bullet) => (
          <li key={bullet} className="flex items-start gap-3 text-callout text-ink">
            <span
              aria-hidden="true"
              className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-round bg-ink-2"
            />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
      {lowConfidence ? (
        <p className="mt-4 flex items-start gap-2 text-caption text-warn">
          <Icon name="warning" size={16} className="mt-0.5 shrink-0" />
          {t("lowConfidence")}
        </p>
      ) : null}
      <p className="mt-4 flex items-start gap-1.5 text-caption text-ink-2">
        <Icon name="info" size={16} className="mt-px shrink-0" />
        <span>{t("disclaimer")}</span>
      </p>
      {document.is_demo ? (
        <p className="mt-1 pl-[22px] text-caption text-ink-2">{t("demoSummary")}</p>
      ) : null}
    </section>
  );
}
