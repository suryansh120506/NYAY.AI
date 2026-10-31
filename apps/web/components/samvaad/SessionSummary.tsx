"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { TopUpPanel } from "@/components/wallet/TopUpPanel";
import { getSamvaadClient, getSessionCheckout, getSessionWalletClient } from "@/lib/api/samvaad";
import type { SessionInfo } from "@/lib/api/types";
import { limits } from "@/lib/config";
import { formatPaise } from "@/lib/money";
import { formatClock } from "@/lib/samvaad/reducer";
import type { TerminationReason } from "@/lib/ws/types";
import { cx } from "@/lib/text";

const TAGS = ["tag_clear", "tag_patient", "tag_quick", "tag_language"] as const;

/**
 * Shown when the session ends for any reason (brief §3.3): minutes used, itemised total, the unused hold returned
 * to the wallet, an optional rating, and "Top up and continue" when the balance ran out.
 */
export function TerminatedSheet({
  open,
  onClose,
  reason,
  session,
  settling,
  onContinue,
}: {
  open: boolean;
  onClose: () => void;
  reason: TerminationReason | null;
  session: SessionInfo;
  settling: boolean;
  onContinue: () => Promise<void>;
}) {
  const t = useTranslations("Samvaad");
  const name = session.advocate.display_name;
  const reasonText =
    reason === "wallet_empty"
      ? t("reason_wallet_empty")
      : reason === "advocate_ended"
        ? t("reason_advocate_ended", { name })
        : reason === "timeout"
          ? t("reason_timeout")
          : t("reason_user_ended");

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("summaryTitle")}
      description={reasonText}
      testId="summary-sheet"
    >
      <SessionSummary session={session} settling={settling} />
      <Rating sessionId={session.id} />
      <div className="mt-6 flex flex-col gap-2">
        {reason === "wallet_empty" ? (
          <TopUpAndContinue onContinue={onContinue} />
        ) : (
          <ButtonLink href="/" size="lg" fullWidth>
            {t("backHome")}
          </ButtonLink>
        )}
      </div>
    </Sheet>
  );
}

export function SessionSummary({ session, settling }: { session: SessionInfo; settling: boolean }) {
  const t = useTranslations("Samvaad");
  const n = session.billed_minutes;
  const refund = Math.max(0, session.held_paise - session.consumed_paise);
  // Billing is prorated to the second (A60): each part is the per-minute rate × time used, rounded down.
  const used = session.used_seconds ?? n * 60;
  const part = (ratePaise: number) => Math.floor((ratePaise * used) / 60);
  const rows = [
    { label: t("timeUsed"), value: formatClock(used) },
    { label: t("lineAdvocateFee"), value: formatPaise(part(session.adv_rate_paise)) },
    { label: t("linePlatformFee"), value: formatPaise(part(session.plat_rate_paise)) },
    { label: t("lineGstFee"), value: formatPaise(part(session.gst_rate_paise)) },
  ];

  if (settling) {
    return (
      <div className="rounded-card bg-canvas px-5 py-2" aria-busy="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center justify-between py-3" aria-hidden="true">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <dl className="rounded-card bg-canvas px-5" data-testid="session-summary">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-center justify-between gap-4 border-b border-hairline py-3"
        >
          <dt className="text-callout text-ink-2">{row.label}</dt>
          <dd className="text-callout text-ink tabular">{row.value}</dd>
        </div>
      ))}
      <div className="flex items-center justify-between gap-4 border-b border-hairline py-3">
        <dt className="text-callout font-semibold text-ink">{t("lineTotal")}</dt>
        <dd className="text-callout font-semibold text-ink tabular">
          {formatPaise(session.consumed_paise)}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-4 py-3">
        <dt className="flex items-center gap-1.5 text-callout text-ok">
          <Icon name="check" size={16} />
          {t("lineRefund")}
        </dt>
        <dd className="text-callout font-medium text-ok tabular">{formatPaise(refund)}</dd>
      </div>
      <p className="pb-3 text-caption text-ink-2">{t("proratedNote")}</p>
    </dl>
  );
}

function Rating({ sessionId }: { sessionId: string }) {
  const t = useTranslations("Samvaad");
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  if (state === "sent") {
    return <p className="mt-6 text-center text-callout text-ink-2">{t("ratingThanks")}</p>;
  }

  return (
    <section className="mt-6" aria-labelledby="rating-title">
      <h3 id="rating-title" className="text-callout font-semibold text-ink">
        {t("rateTitle")}
        <span className="font-normal text-ink-2">
          <span aria-hidden="true">{" · "}</span>
          {t("rateOptional")}
        </span>
      </h3>
      <div role="radiogroup" aria-labelledby="rating-title" className="mt-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={t("rateStar", { count: value })}
            onClick={() => setRating(value)}
            className={cx(
              "inline-flex h-11 w-11 items-center justify-center rounded-input transition-colors duration-200 ease-apple hover:bg-ink/5",
              value <= rating ? "text-trust" : "text-ink-2",
            )}
          >
            <Icon name="star" size={24} filled={value <= rating} />
          </button>
        ))}
      </div>
      {rating > 0 ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {TAGS.map((tag) => (
              <Chip
                key={tag}
                selected={tags.includes(tag)}
                onClick={() =>
                  setTags((current) =>
                    current.includes(tag) ? current.filter((x) => x !== tag) : [...current, tag],
                  )
                }
              >
                {t(tag)}
              </Chip>
            ))}
          </div>
          <Button
            variant="secondary"
            className="mt-3"
            disabled={state === "sending"}
            onClick={async () => {
              setState("sending");
              try {
                await getSamvaadClient().rate(sessionId, { rating, tags });
                setState("sent");
              } catch {
                setState("idle");
              }
            }}
          >
            {t("submitRating")}
          </Button>
        </>
      ) : null}
    </section>
  );
}

function TopUpAndContinue({ onContinue }: { onContinue: () => Promise<void> }) {
  const t = useTranslations("Samvaad");
  const toast = useToast();
  const errors = useTranslations("Errors");
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button size="lg" fullWidth onClick={() => setOpen(true)}>
        {t("topUpContinue")}
      </Button>
    );
  }
  return (
    <TopUpPanel
      amounts={limits.topupChipsPaise}
      defaultAmount={limits.topupChipsPaise[1]}
      clients={{ wallet: getSessionWalletClient(), checkout: getSessionCheckout() }}
      onPaid={() => {
        onContinue().catch(() => toast.show(errors("title"), "error"));
      }}
    />
  );
}
