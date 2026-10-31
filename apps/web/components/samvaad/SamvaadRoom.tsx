"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { clockRate, setMinuteMsOverride } from "@/lib/api/mock/samvaad-server";
import { getSamvaadClient } from "@/lib/api/samvaad";
import { ApiError, type SessionInfo } from "@/lib/api/types";
import { publicConfig } from "@/lib/config";
import { useRouter } from "@/lib/i18n/navigation";
import { perMinuteCost } from "@/lib/money";
import { isActivePhase, type RoomPhase } from "@/lib/samvaad/reducer";
import { useRoomStore } from "@/lib/samvaad/store";
import { transportFactory } from "@/lib/ws/factory";
import { useSamvaadSocket } from "@/lib/ws/useSamvaadSocket";
import { CitationPanel } from "@/components/workspace/CitationPanel";
import { useCitations } from "@/lib/samvaad/useCitations";
import { AdvocateRoom } from "./AdvocateRoom";
import { Composer } from "./Composer";
import { ConnectionBanner } from "./ConnectionBanner";
import { DevControls } from "./DevControls";
import { EndSessionSheet } from "./EndSessionSheet";
import { LowBalanceSheet } from "./LowBalanceSheet";
import { MessageList } from "./MessageList";
import { PreflightCard, type StartChoices } from "./PreflightCard";
import { RoomHeader } from "./RoomHeader";
import { TerminatedSheet } from "./SessionSummary";

function initialPhase(session: SessionInfo): RoomPhase {
  if (session.state === "SETTLED" || session.state === "CANCELLED") return "summary";
  if (session.state === "LIVE" || session.state === "ENDING") return "live";
  return "preflight";
}

/**
 * One URL for both chairs: the client's room (price, wallet, consent) or the advocate's (minutes and earnings),
 * chosen by the `viewer` the API reports for the signed-in account.
 */
export function SamvaadRoom({ sessionId }: { sessionId: string }) {
  const { ready, session: user } = useAuth();
  const sessionQuery = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => getSamvaadClient().get(sessionId),
    enabled: ready && user !== null,
    retry: (count, error) =>
      !(error instanceof ApiError && error.code === "not_found") && count < 2,
  });
  if (sessionQuery.data?.viewer === "advocate") return <AdvocateRoom session={sessionQuery.data} />;
  return <ClientRoom sessionId={sessionId} />;
}

/**
 * Orchestrates the client's consultation screen and owns its state machine
 * (preflight → connecting → live → low_balance → ending → summary) via the Zustand room store and useSamvaadSocket.
 */
function ClientRoom({ sessionId }: { sessionId: string }) {
  const t = useTranslations("Samvaad");
  const auth = useTranslations("Auth");
  const errors = useTranslations("Errors");
  const common = useTranslations("Common");
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { ready, session: user, requireAuth } = useAuth();
  const client = getSamvaadClient();

  const phase = useRoomStore((s) => s.phase);
  const storeSessionId = useRoomStore((s) => s.sessionId);
  const terminatedReason = useRoomStore((s) => s.terminatedReason);
  const items = useRoomStore((s) => s.items);

  const [starting, setStarting] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [citesOpen, setCitesOpen] = useState(false);
  const citations = useCitations();
  const w = useTranslations("Workspace");

  // Demo only: ?mockMinuteMs= shortens billed minutes (docs/ASSUMPTIONS.md A23).
  useEffect(() => {
    if (!publicConfig.useMocks) return;
    const value = Number(new URLSearchParams(window.location.search).get("mockMinuteMs"));
    if (Number.isFinite(value) && value >= 500) setMinuteMsOverride(value);
  }, []);

  const sessionQuery = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => client.get(sessionId),
    enabled: ready && user !== null,
    retry: (count, error) =>
      !(error instanceof ApiError && error.code === "not_found") && count < 2,
  });
  const session = sessionQuery.data;

  useEffect(() => {
    if (!session || useRoomStore.getState().sessionId === sessionId) return;
    useRoomStore.getState().reset(sessionId, {
      costPerMinute: perMinuteCost(session),
      clockRate: publicConfig.useMocks ? clockRate() : 1,
      phase: initialPhase(session),
    });
  }, [session, sessionId]);

  const roomReady = storeSessionId === sessionId && session !== undefined;
  const sessionOpen =
    session !== undefined && (session.state === "RESERVED" || session.state === "LIVE");
  const { send, retry, sendTyping } = useSamvaadSocket({
    sessionId,
    enabled: roomReady && sessionOpen && phase !== "summary",
    client,
    factory: transportFactory,
  });

  // Once it ends: settle the summary from the server and refresh the wallet.
  useEffect(() => {
    if (phase !== "summary" || !roomReady) return;
    setSummaryOpen(true);
    void queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
    void queryClient.invalidateQueries({ queryKey: ["wallet"] });
  }, [phase, roomReady, queryClient, sessionId]);

  async function start(choices: StartChoices) {
    setStarting(true);
    try {
      await client.start(sessionId, {
        chat_storage_consent: true,
        keep_transcript: choices.keepTranscript,
        share_summary: choices.shareSummary,
      });
      if (useRoomStore.getState().phase === "preflight")
        useRoomStore.getState().setPhase("connecting");
    } catch {
      toast.show(errors("title"), "error");
    } finally {
      setStarting(false);
    }
  }

  async function end() {
    setConfirmEnd(false);
    useRoomStore.getState().setLowBalanceOpen(false);
    useRoomStore.getState().setPhase("ending");
    try {
      await client.end(sessionId);
      // If the socket was down, the terminated event never arrived: apply it locally.
      if (useRoomStore.getState().phase === "ending") {
        useRoomStore.getState().apply({ type: "session.terminated", reason: "user_ended" });
      }
    } catch {
      toast.show(errors("title"), "error");
      useRoomStore.getState().setPhase("live");
    }
  }

  async function back() {
    if (isActivePhase(phase)) {
      setConfirmEnd(true);
      return;
    }
    if (phase === "preflight" || phase === "connecting") {
      // Leaving before the clock starts cancels the reservation and releases the hold.
      await client.end(sessionId).catch(() => undefined);
      await queryClient.invalidateQueries({ queryKey: ["wallet"] });
    }
    router.back();
  }

  async function continueWithAdvocate() {
    if (!session) return;
    const next = await client.reserve({ advocate_id: session.advocate.id });
    router.push(`/samvaad/${next.id}`);
  }

  // ------------------------------------------------------------------------------------------------ states
  if (ready && !user) {
    return (
      <CenteredMessage
        text={auth("title")}
        action={
          <Button size="lg" onClick={() => void requireAuth("generic")}>
            {auth("sendCode")}
          </Button>
        }
      />
    );
  }

  if (sessionQuery.isError) {
    const notFound =
      sessionQuery.error instanceof ApiError && sessionQuery.error.code === "not_found";
    return (
      <CenteredMessage
        text={notFound ? t("notFound") : errors("title")}
        action={
          notFound ? (
            <ButtonLink href="/" size="lg">
              {t("backHome")}
            </ButtonLink>
          ) : (
            <Button size="lg" onClick={() => void sessionQuery.refetch()}>
              {common("retry")}
            </Button>
          )
        }
      />
    );
  }

  if (!session || !roomReady) return <RoomSkeleton />;

  const name = session.advocate.display_name;
  const composerEnabled = phase === "live" || phase === "low_balance";
  const disabledReason =
    phase === "connecting"
      ? t("composerWaiting", { name })
      : phase === "ending" || phase === "summary"
        ? t("composerEnded")
        : null;

  return (
    <div data-theme="night" className="flex h-dvh flex-col bg-canvas text-ink">
      <RoomHeader
        session={session}
        onBack={() => void back()}
        onEnd={() => setConfirmEnd(true)}
        citationCount={citations.length}
        onOpenCitations={() => setCitesOpen(true)}
      />
      <ConnectionBanner />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <main id="main" className="relative flex min-h-0 flex-1 flex-col">
            {phase === "preflight" ? (
              <div className="flex-1 overflow-y-auto">
                <PreflightCard
                  session={session}
                  starting={starting}
                  onStart={(choices) => void start(choices)}
                />
              </div>
            ) : phase === "connecting" && items.length === 0 ? (
              <Waiting name={name} />
            ) : (
              <MessageList advocateName={name} onRetry={retry} />
            )}
          </main>

          {phase !== "preflight" ? (
            <div className="border-t border-glass-edge bg-canvas/75 px-3 pt-2 pb-[max(10px,env(safe-area-inset-bottom))] backdrop-blur-md">
              <div className="mx-auto max-w-[720px]">
                <Composer
                  enabled={composerEnabled}
                  disabledReason={disabledReason}
                  advocateName={name}
                  onSend={send}
                  onTyping={sendTyping}
                />
                {phase === "summary" && !summaryOpen ? (
                  <div className="mt-1 text-center">
                    <Button variant="text" onClick={() => setSummaryOpen(true)}>
                      {t("viewSummary")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        {phase !== "preflight" ? (
          <aside className="hidden w-[26rem] shrink-0 border-l border-hairline bg-ink/2 lg:block xl:w-[30rem]">
            <CitationPanel citations={citations} otherName={name} />
          </aside>
        ) : null}
      </div>

      <Sheet
        open={citesOpen}
        onClose={() => setCitesOpen(false)}
        title={w("title")}
        description={w("subtitle")}
        testId="citations-sheet"
      >
        <CitationPanel citations={citations} otherName={name} embedded className="max-h-[60dvh]" />
      </Sheet>

      <LowBalanceSheet onEnd={() => void end()} />
      <EndSessionSheet
        open={confirmEnd}
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => void end()}
      />
      <TerminatedSheet
        open={phase === "summary" && summaryOpen}
        onClose={() => setSummaryOpen(false)}
        reason={terminatedReason ?? session.end_reason}
        session={session}
        settling={
          sessionQuery.isFetching || session.state === "LIVE" || session.state === "RESERVED"
        }
        onContinue={continueWithAdvocate}
      />
      {publicConfig.useMocks && isActivePhase(phase) ? <DevControls sessionId={sessionId} /> : null}
    </div>
  );
}

function Waiting({ name }: { name: string }) {
  const t = useTranslations("Samvaad");
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center px-6 text-center"
      role="status"
    >
      <Avatar name={name} size="lg" />
      <p className="mt-5 max-w-sm text-body text-ink">{t("waiting", { name })}</p>
      <p className="mt-1 text-caption text-ink-2">{t("waitingHint")}</p>
      <Skeleton rounded="control" className="mt-6 h-1.5 w-40" />
    </div>
  );
}

function CenteredMessage({ text, action }: { text: string; action: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <p className="max-w-sm text-headline text-ink">{text}</p>
      {action}
    </div>
  );
}

function RoomSkeleton() {
  return (
    <div className="flex h-dvh flex-col" aria-busy="true">
      <div
        className="flex h-16 items-center gap-3 border-b border-hairline px-4"
        aria-hidden="true"
      >
        <Skeleton rounded="circle" className="h-11 w-11" />
        <div className="flex-1">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-20" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-prose flex-1 px-4 py-8" aria-hidden="true">
        <Skeleton className="h-8 w-56" />
        <Skeleton rounded="card" className="mt-6 h-24 w-full" />
        <Skeleton rounded="card" className="mt-4 h-40 w-full" />
        <Skeleton rounded="card" className="mt-8 h-48 w-full" />
      </div>
    </div>
  );
}
