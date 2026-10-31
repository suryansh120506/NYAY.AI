"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { m, useReducedMotion } from "@/components/motion";
import type { Tier } from "@/lib/saransh/analysis";
import { cx } from "@/lib/text";

const TONE: Record<Tier, { stroke: string; text: string }> = {
  high: { stroke: "stroke-danger", text: "text-danger" },
  moderate: { stroke: "stroke-warn", text: "text-warn" },
  low: { stroke: "stroke-ok", text: "text-ok" },
};

const TICKS = 48;
const CENTRE = { x: 60, y: 62 };
const OUTER = 53;

/** One tick of the gauge, from the left end of the half circle (i = 0) to the right end (i = TICKS). */
function tickAt(i: number) {
  const angle = Math.PI * (1 - i / TICKS);
  const major = i % 6 === 0;
  const inner = major ? 38 : 44;
  return {
    major,
    x1: CENTRE.x + inner * Math.cos(angle),
    y1: CENTRE.y - inner * Math.sin(angle),
    x2: CENTRE.x + OUTER * Math.cos(angle),
    y2: CENTRE.y - OUTER * Math.sin(angle),
  };
}

/**
 * A segmented instrument gauge: 49 ticks around a half circle, filled up to the score, in sharp red, amber or green with
 * a glow. The ticks light in sequence once (all at once under reduced motion). The tier is also written out with an
 * icon, so colour is never the only signal.
 */
export function RiskDial({ score, tier }: { score: number; tier: Tier }) {
  const t = useTranslations("Analysis");
  const reduce = useReducedMotion();
  const tone = TONE[tier];
  const Icon = tier === "low" ? ShieldCheck : ShieldAlert;
  const lit = Math.round((score / 100) * TICKS);
  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => ({ i, ...tickAt(i) }));
  return (
    <div
      className="flex flex-col items-center"
      data-testid="risk-dial"
      data-tier={tier}
      data-score={score}
    >
      <svg
        viewBox="0 0 120 70"
        role="img"
        aria-label={t("scoreLabel", { score })}
        className="w-full max-w-72"
      >
        <g className="stroke-ink/20" strokeLinecap="butt">
          {ticks
            .filter((tick) => tick.i > lit)
            .map((tick) => (
              <line
                key={tick.i}
                x1={tick.x1}
                y1={tick.y1}
                x2={tick.x2}
                y2={tick.y2}
                strokeWidth={tick.major ? 1.8 : 1.2}
              />
            ))}
        </g>
        <g
          className={cx(tone.stroke, tone.text)}
          strokeLinecap="butt"
          style={{ filter: "drop-shadow(0 0 4px currentColor)" }}
        >
          {ticks
            .filter((tick) => tick.i <= lit)
            .map((tick) => (
              <m.line
                key={tick.i}
                x1={tick.x1}
                y1={tick.y1}
                x2={tick.x2}
                y2={tick.y2}
                strokeWidth={tick.major ? 1.8 : 1.2}
                initial={{ opacity: reduce ? 1 : 0.1 }}
                animate={{ opacity: 1 }}
                transition={{ duration: reduce ? 0 : 0.18, delay: reduce ? 0 : tick.i * 0.014 }}
              />
            ))}
        </g>
      </svg>
      <p className="-mt-14 font-mono text-figure font-semibold text-ink tabular">
        {score}
        <span className="font-mono text-callout font-normal text-ink-2">{t("outOf")}</span>
      </p>
      <p className={cx("mt-2 inline-flex items-center gap-1.5 eyebrow", tone.text)}>
        <Icon size={14} aria-hidden="true" />
        {t(`tier_${tier}`)}
      </p>
    </div>
  );
}
