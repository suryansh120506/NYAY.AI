"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CircleAlert, CircleCheck, Info, MessageSquareText, TriangleAlert } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { AnimatePresence, m, SPRING_SOFT } from "@/components/motion";
import {
  isFlagged,
  riskScore,
  riskTier,
  tally,
  type Clause,
  type Level,
} from "@/lib/saransh/analysis";
import { cx } from "@/lib/text";
import { RiskDial } from "./RiskDial";

const LEVEL_STYLE: Record<Level, { bar: string; text: string; glow: string; edge: string }> = {
  high: {
    bar: "bg-danger",
    text: "text-danger",
    glow: "shadow-glow-danger",
    edge: "border-danger/50",
  },
  review: { bar: "bg-warn", text: "text-warn", glow: "shadow-glow-warn", edge: "border-warn/50" },
  standard: { bar: "bg-ok", text: "text-ok", glow: "shadow-glow-ok", edge: "border-ok/50" },
};

const LEVEL_ICON = { high: TriangleAlert, review: CircleAlert, standard: CircleCheck } as const;
const LEVELS: readonly Level[] = ["high", "review", "standard"];

function LevelTag({ level }: { level: Level }) {
  const t = useTranslations("Analysis");
  const Icon = LEVEL_ICON[level];
  return (
    <span
      className={cx(
        "inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 eyebrow",
        LEVEL_STYLE[level].text,
        LEVEL_STYLE[level].edge,
      )}
    >
      <Icon size={11} aria-hidden="true" />
      {t(`level_${level}`)}
    </span>
  );
}

function ClauseDetail({ clause }: { clause: Clause }) {
  const t = useTranslations("Analysis");
  return (
    <div className="flex flex-col gap-4 px-4 pb-4 pl-6">
      <blockquote
        lang="en"
        className="border-l border-glass-edge pl-3 font-serif text-callout text-ink-2"
      >
        {clause.text}
      </blockquote>
      <div>
        <p className="flex items-center gap-1.5 eyebrow text-ink-2">
          <Info size={12} aria-hidden="true" />
          {t("whyTitle")}
        </p>
        <p className="mt-1.5 text-callout text-ink">
          {isFlagged(clause.id) ? t(`clauses.${clause.id}.why`) : t("standardWhy")}
        </p>
      </div>
      <div>
        <p className="flex items-center gap-1.5 eyebrow text-ink-2">
          <MessageSquareText size={12} aria-hidden="true" />
          {t("askTitle")}
        </p>
        <p className="mt-1.5 text-callout text-ink">
          {isFlagged(clause.id) ? t(`clauses.${clause.id}.ask`) : t("standardAsk")}
        </p>
      </div>
    </div>
  );
}

/**
 * The right-hand side of the analyzer, laid out like an instrument panel: a segmented risk gauge, three count cells
 * (sharp red, amber and green with a glow when selected), and the clause list in tabular type. Selecting a clause
 * here highlights it in the document.
 */
export function AnalysisPanel({
  clauses,
  selectedId,
  onSelect,
}: {
  clauses: readonly Clause[];
  selectedId: string | null;
  onSelect: (id: Clause["id"]) => void;
}) {
  const t = useTranslations("Analysis");
  const [filter, setFilter] = useState<Level | "all">("all");
  const levels = clauses.map((c) => c.level);
  const score = riskScore(levels);
  const counts = tally(levels);
  const visible = filter === "all" ? clauses : clauses.filter((c) => c.level === filter);

  return (
    <section
      aria-label={t("panelLabel")}
      data-testid="analysis-panel"
      className="flex h-full min-h-0 flex-col"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-glass-edge px-5 py-5">
          <h2 className="eyebrow text-ink-2">{t("scoreTitle")}</h2>
          <div className="mt-4">
            <RiskDial score={score} tier={riskTier(score)} />
          </div>
          <p className="mt-5 text-caption text-ink-2">{t("scoreHow")}</p>
        </div>

        <div className="grid grid-cols-3 divide-x divide-glass-edge border-b border-glass-edge">
          {LEVELS.map((level) => {
            const Icon = LEVEL_ICON[level];
            const active = filter === level;
            return (
              <button
                key={level}
                type="button"
                aria-pressed={active}
                data-testid={`filter-${level}`}
                onClick={() => setFilter(active ? "all" : level)}
                className={cx(
                  "relative flex flex-col items-start gap-1.5 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-ink/5",
                  active && "bg-ink/5",
                )}
              >
                <span
                  className={cx(
                    "absolute inset-x-0 top-0 h-0.5 transition-opacity duration-150",
                    LEVEL_STYLE[level].bar,
                    active ? "opacity-100" : "opacity-40",
                  )}
                  aria-hidden="true"
                />
                <span
                  className={cx("inline-flex items-center gap-1 eyebrow", LEVEL_STYLE[level].text)}
                >
                  <Icon size={12} aria-hidden="true" />
                  {t(`level_${level}`)}
                </span>
                <span className="font-mono text-display font-semibold text-ink tabular">
                  {counts[level]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="px-5 pt-5 pb-2">
          <h2 className="eyebrow text-ink-2">{t("clausesTitle")}</h2>
        </div>
        {visible.length === 0 ? (
          <p className="px-5 pb-6 text-callout text-ink-2">{t("empty")}</p>
        ) : (
          <ol className="flex flex-col pb-4" data-testid="clause-list">
            {visible.map((clause) => {
              const open = selectedId === clause.id;
              const style = LEVEL_STYLE[clause.level];
              return (
                <li
                  key={clause.id}
                  className={cx("border-t border-glass-edge first:border-t-0", open && "bg-ink/5")}
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    data-clause-item={clause.id}
                    data-level={clause.level}
                    onClick={() => onSelect(clause.id)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-ink/5"
                  >
                    <span
                      className={cx(
                        "mt-0.5 h-10 w-0.5 shrink-0",
                        style.bar,
                        open && clause.level !== "standard" && style.glow,
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-callout font-semibold text-ink">
                          {t("clauseHeading", {
                            number: String(clause.number).padStart(2, "0"),
                            title: t(`clauses.${clause.id}.title`),
                          })}
                        </span>
                        <LevelTag level={clause.level} />
                      </span>
                      <span className="mt-1 block font-mono text-caption text-ink-2 tabular">
                        {t("pageShort", { page: clause.page })}
                      </span>
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {open ? (
                      <m.div
                        key="detail"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={SPRING_SOFT}
                        className="overflow-hidden"
                      >
                        <ClauseDetail clause={clause} />
                      </m.div>
                    ) : null}
                  </AnimatePresence>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="border-t border-glass-edge bg-canvas/60 px-5 py-4 backdrop-blur-md">
        <p className="text-caption text-ink-2">{t("disclaimer")}</p>
        <ButtonLink href="/" size="lg" fullWidth className="mt-3">
          {t("cta")}
        </ButtonLink>
      </div>
    </section>
  );
}
