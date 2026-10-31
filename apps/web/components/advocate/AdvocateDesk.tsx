"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { FieldError, FieldLabel, fieldClasses } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tag } from "@/components/ui/Chip";
import { useToast } from "@/components/ui/Toast";
import { getAdvocateClient } from "@/lib/api/advocate";
import { ApiError, type AdvocateMe, type AdvocateSession } from "@/lib/api/types";
import { formatPaise, parseRupeesInput } from "@/lib/money";
import { formatClock } from "@/lib/samvaad/reducer";

const OPEN = new Set(["RESERVED", "LIVE", "ENDING"]);

/**
 * The advocate's desk: incoming requests (polled from Postgres every 10 s: no Redis cost), availability, their own
 * per-minute rate and what the platform owes them. Earnings are 100 % of the advocate's rate (brief §0).
 */
export function AdvocateDesk() {
  const t = useTranslations("AdvocateDesk");
  const nav = useTranslations("Nav");
  const { ready, session, requireAuth } = useAuth();
  const signedIn = ready && session !== null;
  const isAdvocate = session?.user.role === "advocate";
  const advocate = getAdvocateClient();

  const me = useQuery({
    queryKey: ["advocate", "me"],
    queryFn: () => advocate.me(),
    enabled: signedIn && isAdvocate,
  });
  const sessions = useQuery({
    queryKey: ["advocate", "sessions"],
    queryFn: () => advocate.sessions(),
    enabled: signedIn && isAdvocate,
    refetchInterval: 10_000,
  });
  const earnings = useQuery({
    queryKey: ["advocate", "earnings"],
    queryFn: () => advocate.earnings(),
    enabled: signedIn && isAdvocate,
  });

  if (ready && !session) {
    return (
      <Shell title={t("title")}>
        <div className="mt-8 rounded-card border border-hairline bg-surface p-6 text-center">
          <p className="text-body text-ink">{t("signInPrompt")}</p>
          <Button size="lg" className="mt-5" onClick={() => void requireAuth("generic")}>
            {nav("signIn")}
          </Button>
        </div>
      </Shell>
    );
  }
  if (signedIn && !isAdvocate) {
    return (
      <Shell title={t("title")}>
        <p className="mt-8 rounded-card border border-hairline bg-surface p-6 text-body text-ink">
          {t("notAdvocate")}
        </p>
      </Shell>
    );
  }

  const all = sessions.data ?? [];
  const requests = all.filter((s) => OPEN.has(s.state));
  const recent = all.filter((s) => !OPEN.has(s.state));

  return (
    <Shell title={t("title")}>
      {me.data && me.data.verification_status !== "verified" ? (
        <p className="mt-6 rounded-card border border-warn/40 bg-surface p-4 text-callout text-warn">
          {t("pendingVerification")}
        </p>
      ) : null}

      <section aria-labelledby="requests-title" className="mt-8">
        <h2 id="requests-title" className="text-headline font-semibold text-ink">
          {t("requests")}
        </h2>
        {sessions.isLoading ? (
          <Skeleton rounded="card" className="mt-4 h-24 w-full" />
        ) : requests.length === 0 ? (
          <p className="mt-3 text-callout text-ink-2">{t("noRequests")}</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3" data-testid="advocate-requests">
            {requests.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </ul>
        )}
      </section>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <Availability />
        <RateEditor />
      </div>

      <section
        aria-labelledby="earnings-title"
        className="mt-10 rounded-card border border-hairline bg-surface p-6"
      >
        <h2 id="earnings-title" className="text-callout text-ink-2">
          {t("payable")}
        </h2>
        {earnings.data ? (
          <>
            <p
              className="mt-1 text-figure font-semibold text-ink tabular"
              data-testid="advocate-payable"
            >
              {formatPaise(earnings.data.payable_paise)}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-callout">
              <div>
                <dt className="text-ink-2">{t("today")}</dt>
                <dd className="font-medium text-ink tabular">
                  {formatPaise(earnings.data.today_paise)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-2">{t("week")}</dt>
                <dd className="font-medium text-ink tabular">
                  {formatPaise(earnings.data.last_7_days_paise)}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-caption text-ink-2">
              {t("sessionsWeek", { count: earnings.data.sessions_last_7_days })} · {t("payoutNote")}
            </p>
          </>
        ) : (
          <Skeleton className="mt-2 h-10 w-40" />
        )}
      </section>

      <section aria-labelledby="recent-title" className="mt-10">
        <h2 id="recent-title" className="text-headline font-semibold text-ink">
          {t("recent")}
        </h2>
        {recent.length === 0 ? (
          <p className="mt-3 text-callout text-ink-2">{t("noRecent")}</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {recent.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-prose px-4 pt-8 pb-section-sm md:pt-12">
      <h1 className="text-display font-semibold text-ink">{title}</h1>
      {children}
    </div>
  );
}

function SessionRow({ session }: { session: AdvocateSession }) {
  const t = useTranslations("AdvocateDesk");
  const format = useFormatter();
  const open = OPEN.has(session.state);
  const used = session.used_seconds ?? session.billed_minutes * 60;
  return (
    <li className="flex items-center gap-4 rounded-card border border-hairline bg-surface p-4">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-callout font-semibold text-ink">
          <span className="truncate">{session.client_name}</span>
          <Tag>{t(`state_${session.state}`)}</Tag>
          {session.summary_shared ? <Tag>{t("summaryShared")}</Tag> : null}
        </p>
        <p className="mt-1 text-caption text-ink-2">
          {open
            ? session.state === "RESERVED"
              ? session.client_ready
                ? t("clientReady")
                : t("clientReviewing")
              : t("liveFor", { time: formatClock(used) })
            : t("endedLine", {
                when: format.relativeTime(new Date(session.ended_at ?? session.requested_at)),
                time: formatClock(used),
                amount: formatPaise(session.earned_paise),
              })}
        </p>
      </div>
      {open ? (
        <ButtonLink
          href={`/samvaad/${session.id}`}
          variant={session.client_ready ? "primary" : "secondary"}
        >
          {session.state === "RESERVED" ? t("join") : t("rejoin")}
        </ButtonLink>
      ) : null}
    </li>
  );
}

function Availability() {
  const t = useTranslations("AdvocateDesk");
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["advocate", "me"], queryFn: () => getAdvocateClient().me() });
  const mutation = useMutation({
    mutationFn: (value: boolean) => getAdvocateClient().setAvailability(value),
    // Optimistic: show the new state immediately, roll back if the server says no.
    onMutate: async (value: boolean) => {
      await queryClient.cancelQueries({ queryKey: ["advocate", "me"] });
      const previous = queryClient.getQueryData<AdvocateMe>(["advocate", "me"]);
      if (previous)
        queryClient.setQueryData(["advocate", "me"], { ...previous, is_available: value });
      return { previous };
    },
    onError: (_error, _value, context) => {
      if (context?.previous) queryClient.setQueryData(["advocate", "me"], context.previous);
    },
    onSuccess: (data) => queryClient.setQueryData(["advocate", "me"], data),
  });
  return (
    <section className="rounded-card border border-hairline bg-surface p-6">
      <h2 className="text-callout font-semibold text-ink">{t("availabilityTitle")}</h2>
      {me.data ? (
        <Checkbox
          className="mt-3"
          label={t("availability")}
          hint={t("availabilityHint")}
          checked={me.data.is_available}
          disabled={mutation.isPending}
          onChange={(event) => mutation.mutate(event.currentTarget.checked)}
        />
      ) : (
        <Skeleton className="mt-3 h-6 w-48" />
      )}
    </section>
  );
}

function RateEditor() {
  const t = useTranslations("AdvocateDesk");
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ["advocate", "me"], queryFn: () => getAdvocateClient().me() });
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (paise: number) => getAdvocateClient().setRate(paise),
    onSuccess: (data) => {
      queryClient.setQueryData(["advocate", "me"], data);
      setValue(null);
      toast.show(t("rateSaved"), "success");
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.code === "invalid_amount" ? t("rateRange") : t("rateError"),
      ),
  });
  if (!me.data) {
    return <Skeleton rounded="card" className="h-40 w-full" />;
  }
  const current = value ?? String(me.data.rate_paise_per_min / 100);
  const range = {
    min: formatPaise(me.data.min_rate_paise, { trimZeroPaise: true }),
    max: formatPaise(me.data.max_rate_paise, { trimZeroPaise: true }),
  };
  return (
    <form
      className="rounded-card border border-hairline bg-surface p-6"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const paise = parseRupeesInput(current);
        if (paise === null || paise < me.data.min_rate_paise || paise > me.data.max_rate_paise) {
          setError(t("rateRange"));
          return;
        }
        mutation.mutate(paise);
      }}
    >
      <FieldLabel htmlFor="rate">{t("rateTitle")}</FieldLabel>
      <div className="mt-2 flex gap-2">
        <input
          id="rate"
          inputMode="decimal"
          className={fieldClasses}
          value={current}
          aria-describedby="rate-hint rate-error"
          aria-invalid={error !== null}
          onChange={(event) => setValue(event.currentTarget.value)}
        />
        <Button type="submit" variant="secondary" disabled={mutation.isPending}>
          {t("saveRate")}
        </Button>
      </div>
      <p id="rate-hint" className="mt-2 text-caption text-ink-2">
        {t("rateHint", range)}
      </p>
      {error ? <FieldError id="rate-error">{error}</FieldError> : null}
    </form>
  );
}
