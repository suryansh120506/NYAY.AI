"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/Icon";
import {
  displayRemainingSeconds,
  elapsedSeconds,
  formatClock,
  isActivePhase,
} from "@/lib/samvaad/reducer";
import { useRoomStore } from "@/lib/samvaad/store";
import { useNow } from "@/lib/samvaad/useNow";
import { formatPaise } from "@/lib/money";
import { cx } from "@/lib/text";

const WARN_SECONDS = 120;
const DANGER_SECONDS = 60;

export type BalanceTone = "normal" | "warn" | "danger";

export function balanceTone(remaining: number | null): BalanceTone {
  if (remaining === null) return "normal";
  if (remaining <= DANGER_SECONDS) return "danger";
  if (remaining <= WARN_SECONDS) return "warn";
  return "normal";
}

/** mm:ss since billing started, interpolated locally between server ticks (display only). */
export function SessionClock() {
  const t = useTranslations("Samvaad");
  const startedAt = useRoomStore((s) => s.startedAt);
  const clockRate = useRoomStore((s) => s.clockRate);
  const phase = useRoomStore((s) => s.phase);
  const active = isActivePhase(phase) && startedAt !== null;
  const now = useNow(active, clockRate > 1 ? 250 : 1_000);
  if (!startedAt) return null;
  const time = formatClock(elapsedSeconds(startedAt, clockRate, now));
  return (
    <p
      role="timer"
      aria-live="off"
      aria-label={`${t("clockLabel")} ${time}`}
      className="text-callout font-medium text-ink tabular"
    >
      {time}
    </p>
  );
}

/**
 * "₹148 · ~4 min left". Balance comes only from the last `session.tick`; the minutes are counted down locally
 * between ticks. Warn at ≤ 2 min and danger at ≤ 1 min, with an icon and words as well as colour (WCAG 1.4.1).
 */
export function WalletChip() {
  const t = useTranslations("Samvaad");
  const balance = useRoomStore((s) => s.balancePaise);
  const remainingSeconds = useRoomStore((s) => s.remainingSeconds);
  const tickAt = useRoomStore((s) => s.tickAt);
  const clockRate = useRoomStore((s) => s.clockRate);
  const phase = useRoomStore((s) => s.phase);
  const active = isActivePhase(phase);
  const now = useNow(active, clockRate > 1 ? 250 : 1_000);

  if (balance === null) return null;
  const remaining = displayRemainingSeconds({ remainingSeconds, tickAt, clockRate }, now);
  const tone = balanceTone(remaining);
  const amount = formatPaise(balance, { trimZeroPaise: true });
  const label =
    remaining !== null && remaining < 60
      ? t("walletChipUnderMinute", { amount })
      : t("walletChip", { amount, minutes: Math.floor((remaining ?? 0) / 60) });

  return (
    <p
      data-testid="wallet-chip"
      data-tone={tone}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-input px-3 text-caption font-medium whitespace-nowrap tabular transition-colors duration-300 ease-apple",
        tone === "normal" && "border border-transparent bg-ink/5 text-ink",
        // Tinted fills would push warn/danger text below 4.5:1, so the chip turns white with a coloured edge.
        tone === "warn" && "border border-warn/40 bg-surface text-warn",
        tone === "danger" && "border border-danger/40 bg-surface text-danger",
      )}
    >
      <Icon name={tone === "normal" ? "wallet" : "warning"} size={16} className="shrink-0" />
      <span>{label}</span>
    </p>
  );
}
