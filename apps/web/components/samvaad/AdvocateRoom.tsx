"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { SaranshCard } from "@/components/saransh/SaranshCard";
import { getSamvaadClient } from "@/lib/api/samvaad";
import type { SessionInfo } from "@/lib/api/types";
import { useRouter } from "@/lib/i18n/navigation";
import { formatPaise, perMinuteCost } from "@/lib/money";
import { elapsedSeconds, formatClock, isActivePhase, type RoomPhase } from "@/lib/samvaad/reducer";
import { useRoomStore } from "@/lib/samvaad/store";
import { useNow } from "@/lib/samvaad/useNow";
import { useSaranshDocument } from "@/lib/saransh/useSaranshDocument";
import { cx } from "@/lib/text";
import { transportFactory } from "@/lib/ws/factory";
import { counterpartView } from "@/lib/ws/perspective";
import { useSamvaadSocket } from "@/lib/ws/useSamvaadSocket";
import { CitationPanel } from "@/components/workspace/CitationPanel";
import { CitationsButton } from "@/components/workspace/CitationsButton";
import { useCitations } from "@/lib/samvaad/useCitations";
import { Composer } from "./Composer";
import { ConnectionBanner } from "./ConnectionBanner";
import { EndSessionSheet } from "./EndSessionSheet";
import { MessageList } from "./MessageList";

const advocateFactory = counterpartView(transportFactory);

function initialPhase(session: SessionInfo): RoomPhase {
  if (session.state === "SETTLED" || session.state === "CANCELLED") return "summary";
  if (session.state === "LIVE" || session.state === "ENDING") return "live";
  return "connecting";
}

/**
 * The advocate's side of a consultation: the same realtime room seen from the other chair. No wallet, no price
 * sheet: the advocate sees the elapsed time and what they have earned (their full rate; the platform fee is
 * charged to the client separately, brief §0).
 */
export function AdvocateRoom({ session }: { session: SessionInfo }) {
  const t = useTranslations("AdvocateDesk");
  const samvaad = useTranslations("Samvaad");
  const errors = useTranslations("Errors");
  const common = useTranslations("Common");
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const client = getSamvaadClient();
  const sessionId = session.id;
  const clientName = session.client_name ?? t("client");

  const phase = useRoomStore((s) => s.phase);
  const storeSessionId = useRoomStore((s) => s.sessionId);
  const online = useRoomStore((s) => s.advocateOnline); // the client, after the perspective flip
  const typing = useRoomStore((s) => s.advocateTyping);
  const startedAt = useRoomStore((s) => s.startedAt);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [citesOpen, setCitesOpen] = useState(false);
  const citations = useCitations();
  const w = useTranslations("Workspace");

  useEffect(() => {
    if (useRoomStore.getState().sessionId === sessionId) return;
    useRoomStore.getState().reset(sessionId, {
      costPerMinute: perMinuteCost(session),
      clockRate: 1,
      phase: initialPhase(session),
    });
  }, [session, sessionId]);

  const roomReady = storeSessionId === sessionId;
  const open = session.state === "RESERVED" || session.state === "LIVE";
  const { send, retry, sendTyping } = useSamvaadSocket({
    sessionId,
    enabled: roomReady && open && phase !== "summary",
    client,
    factory: advocateFactory,
  });

  useEffect(() => {
    if (phase !== "summary" || !roomReady) return;
    setSummaryOpen(true);
    void queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
    void queryClient.invalidateQueries({ queryKey: ["advocate"] });
  }, [phase, roomReady, queryClient, sessionId]);

  const active = isActivePhase(phase);
  const now = useNow(active && startedAt !== null, 1_000);
  const elapsed = elapsedSeconds(startedAt, 1, now);
  const earnedSoFar = Math.floor((session.adv_rate_paise * elapsed) / 60);
  const doc = useSaranshDocument(session.summary_shared ? session.document_id : null);

  async function end() {
    setConfirmEnd(false);
    useRoomStore.getState().setPhase("ending");
    try {
      await client.end(sessionId);
      if (useRoomStore.getState().phase === "ending") {
        useRoomStore.getState().apply({ type: "session.terminated", reason: "advocate_ended" });
      }
    } catch {
      toast.show(errors("title"), "error");
      useRoomStore.getState().setPhase("live");
    }
  }

  const composerEnabled = phase === "live" || phase === "low_balance";
  const disabledReason =
    phase === "connecting"
      ? t("roomWaiting", { name: clientName })
      : phase === "ending" || phase === "summary"
        ? samvaad("composerEnded")
        : null;
  const used = session.used_seconds ?? elapsed;

  return (
    <div data-theme="night" className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-30 border-b border-glass-edge bg-canvas/75 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-page items-center gap-2 px-2 md:gap-3 md:px-4">
          <button
            type="button"
            onClick={() => (active ? setConfirmEnd(true) : router.push("/advocate"))}
            aria-label={common("back")}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-input text-trust hover:bg-ink/5"
          >
            <Icon name="chevron-left" size={24} />
          </button>
          <span className="relative shrink-0">
            <Avatar name={clientName} size="md" />
            <span
              aria-hidden="true"
              className={cx(
                "absolute right-0 bottom-0 h-3 w-3 rounded-round border-2 border-canvas",
                online ? "bg-ok" : "bg-ink-2/50",
              )}
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-callout font-semibold text-ink">{clientName}</p>
            <p className="truncate text-caption text-ink-2" aria-live="polite">
              {typing
                ? samvaad("typing", { name: clientName })
                : online
                  ? samvaad("online")
                  : samvaad("offline")}
            </p>
          </div>
          <CitationsButton count={citations.length} onClick={() => setCitesOpen(true)} />
          {active && startedAt ? (
            <div className="flex shrink-0 items-center gap-3">
              <p role="timer" aria-live="off" className="text-callout font-medium text-ink tabular">
                {formatClock(elapsed)}
              </p>
              <p
                className="hidden h-8 items-center rounded-input bg-ink/5 px-3 text-caption font-medium text-ink tabular md:inline-flex"
                data-testid="earned-chip"
              >
                {t("earnedChip", { amount: formatPaise(earnedSoFar, { trimZeroPaise: true }) })}
              </p>
              <Button variant="danger" onClick={() => setConfirmEnd(true)}>
                {samvaad("endSession")}
              </Button>
            </div>
          ) : null}
        </div>
      </header>
      <ConnectionBanner />

      {session.summary_shared && session.document_id ? (
        <div className="border-b border-hairline bg-surface px-4 py-2 text-center">
          <Button variant="text" onClick={() => setDocOpen(true)}>
            <Icon name="document" size={16} />
            {t("viewDocument")}
          </Button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <main id="main" className="relative flex min-h-0 flex-1 flex-col">
            {phase === "connecting" && useRoomStore.getState().items.length === 0 ? (
              <div
                className="flex flex-1 flex-col items-center justify-center px-6 text-center"
                role="status"
              >
                <Avatar name={clientName} size="lg" />
                <p className="mt-5 max-w-sm text-body text-ink">
                  {t("roomWaiting", { name: clientName })}
                </p>
                <p className="mt-1 text-caption text-ink-2">{t("roomWaitingHint")}</p>
              </div>
            ) : (
              <MessageList advocateName={clientName} onRetry={retry} />
            )}
          </main>

          <div className="border-t border-glass-edge bg-canvas/75 px-3 pt-2 pb-[max(10px,env(safe-area-inset-bottom))] backdrop-blur-md">
            <div className="mx-auto max-w-[720px]">
              <Composer
                enabled={composerEnabled}
                disabledReason={disabledReason}
                advocateName={clientName}
                onSend={send}
                onTyping={sendTyping}
              />
              {phase === "summary" && !summaryOpen ? (
                <div className="mt-1 text-center">
                  <Button variant="text" onClick={() => setSummaryOpen(true)}>
                    {samvaad("viewSummary")}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <aside className="hidden w-[26rem] shrink-0 border-l border-hairline bg-ink/2 lg:block xl:w-[30rem]">
          <CitationPanel citations={citations} otherName={clientName} />
        </aside>
      </div>

      <Sheet
        open={citesOpen}
        onClose={() => setCitesOpen(false)}
        title={w("title")}
        description={w("subtitle")}
        testId="citations-sheet"
      >
        <CitationPanel
          citations={citations}
          otherName={clientName}
          embedded
          className="max-h-[60dvh]"
        />
      </Sheet>

      <EndSessionSheet
        open={confirmEnd}
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => void end()}
      />
      <Sheet
        open={phase === "summary" && summaryOpen}
        onClose={() => setSummaryOpen(false)}
        title={t("endedTitle")}
        description={t("endedBody", {
          time: formatClock(used),
          amount: formatPaise(Math.floor((session.adv_rate_paise * used) / 60)),
        })}
        testId="advocate-summary"
      >
        <ButtonLink href="/advocate" size="lg" fullWidth>
          {t("backToDesk")}
        </ButtonLink>
      </Sheet>
      <Sheet open={docOpen} onClose={() => setDocOpen(false)} title={t("viewDocument")}>
        <SaranshCard document={doc.data} loading={doc.isLoading} />
      </Sheet>
    </div>
  );
}
