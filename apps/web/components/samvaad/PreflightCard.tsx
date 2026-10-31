"use client";

import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useCourtName } from "@/components/parakh/useCourtName";
import { SaranshCard } from "@/components/saransh/SaranshCard";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Icon } from "@/components/ui/Icon";
import { ModuleLabel } from "@/components/ui/ModuleLabel";
import type { SessionInfo } from "@/lib/api/types";
import { formatPaise, minutesCovered, perMinuteCost } from "@/lib/money";
import { useSaranshDocument } from "@/lib/saransh/useSaranshDocument";
import { PriceBreakdown } from "./PriceBreakdown";

const SaranshSheet = dynamic(
  () => import("@/components/saransh/SaranshSheet").then((m) => m.SaranshSheet),
  {
    ssr: false,
  },
);

export interface StartChoices {
  keepTranscript: boolean;
  shareSummary: boolean;
}

/**
 * Everything the person needs before the paid clock starts (brief §3.3): who they are about to talk to, the free
 * Saransh summary, the itemised price, the wallet balance in minutes, an explicit chat-storage consent (DPDP), and
 * one primary button. Billing starts only after Start is tapped AND the advocate joins.
 */
export function PreflightCard({
  session,
  starting,
  onStart,
}: {
  session: SessionInfo;
  starting: boolean;
  onStart: (choices: StartChoices) => void;
}) {
  const t = useTranslations("Samvaad");
  const saransh = useTranslations("Saransh");
  const advocate = useTranslations("Advocate");
  const courtName = useCourtName();
  const format = useFormatter();
  const queryClient = useQueryClient();
  const documentQuery = useSaranshDocument(session.document_id);
  const [chatConsent, setChatConsent] = useState(false);
  const [keepTranscript, setKeepTranscript] = useState(false);
  const [shareSummary, setShareSummary] = useState(false);
  const [attach, setAttach] = useState({ open: false, loaded: false });

  const name = session.advocate.display_name;
  const cost = perMinuteCost(session);
  const balance = session.held_paise - session.consumed_paise + session.wallet_available_paise;
  const summaryReady = documentQuery.data?.status === "ready";

  return (
    <div className="mx-auto w-full max-w-prose px-4 py-8 md:py-12">
      <ModuleLabel module="samvaad" />
      <h1 className="mt-2 text-display font-semibold text-ink">{t("preflightTitle")}</h1>

      <div className="mt-6 flex items-center gap-4 rounded-card border border-hairline bg-surface p-5">
        <Avatar name={name} size="lg" />
        <div className="min-w-0">
          <p className="text-headline font-semibold text-ink">{name}</p>
          <p className="mt-0.5 flex items-start gap-1.5 text-callout text-ink-2">
            <Icon name="seal" size={18} className="mt-0.5 shrink-0 text-ok" />
            <span>
              {advocate("verifiedCourts", {
                courts: format.list(session.advocate.courts.slice(0, 2).map(courtName), {
                  type: "conjunction",
                }),
              })}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-4">
        {session.document_id ? (
          <>
            <SaranshCard
              document={documentQuery.data}
              loading={documentQuery.isPending}
              className="border border-hairline"
            />
            {summaryReady ? (
              <Checkbox
                className="mt-3"
                checked={shareSummary}
                onChange={(e) => setShareSummary(e.target.checked)}
                label={saransh("shareWithAdvocate", { name })}
              />
            ) : null}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setAttach({ open: true, loaded: true })}
            className="hover-fade flex w-full items-center gap-4 rounded-card border border-dashed border-ink/15 p-5 text-left"
          >
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-input bg-ink/5 text-ink-2">
              <Icon name="paperclip" size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-callout font-medium text-ink">
                {saransh("attachRow")}
              </span>
              <span className="block text-caption text-ink-2">{saransh("attachRowHint")}</span>
            </span>
            <Icon name="chevron-right" size={18} className="shrink-0 text-ink-2" />
          </button>
        )}
      </div>

      <div className="mt-8">
        <PriceBreakdown rates={session} gstRateBps={session.gst_rate_bps} />
      </div>

      <div className="mt-6 flex items-center justify-between gap-4 rounded-card bg-surface px-5 py-4">
        <span className="flex items-center gap-2 text-callout text-ink-2">
          <Icon name="wallet" size={18} />
          {t("wallet")}
        </span>
        <span className="text-callout text-ink tabular">
          <span className="font-semibold">{formatPaise(balance)}</span>
          <span className="text-ink-2">
            {" · "}
            {t("approxMinutes", { count: minutesCovered(balance, cost) })}
          </span>
        </span>
      </div>

      <div className="mt-6">
        <Checkbox
          checked={chatConsent}
          onChange={(e) => setChatConsent(e.target.checked)}
          label={t("chatConsent")}
          required
        />
        <Checkbox
          checked={keepTranscript}
          onChange={(e) => setKeepTranscript(e.target.checked)}
          label={t("keepTranscript")}
          disabled={!chatConsent}
        />
      </div>

      <Button
        size="lg"
        fullWidth
        className="mt-6"
        disabled={!chatConsent || starting}
        onClick={() => onStart({ keepTranscript, shareSummary: summaryReady && shareSummary })}
      >
        {starting ? t("starting") : t("start")}
      </Button>
      <p className="mt-3 text-center text-caption text-ink-2">{t("billingNote", { name })}</p>

      {attach.loaded ? (
        <SaranshSheet
          open={attach.open}
          sessionId={session.id}
          onClose={() => setAttach((a) => ({ ...a, open: false }))}
          onDone={() => {
            setAttach((a) => ({ ...a, open: false }));
            void queryClient.invalidateQueries({ queryKey: ["session", session.id] });
          }}
        />
      ) : null}
    </div>
  );
}
