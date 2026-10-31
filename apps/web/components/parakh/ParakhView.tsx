"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { HeroSearch } from "@/components/home/HeroSearch";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { ModuleLabel } from "@/components/ui/ModuleLabel";
import { SkeletonRegion } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { TopUpSheet } from "@/components/wallet/TopUpSheet";
import { getParakhClient } from "@/lib/api/parakh";
import { getSamvaadClient } from "@/lib/api/samvaad";
import {
  ApiError,
  type AdvocateMatch,
  type CityOption,
  type MatchResponse,
  type MatchTier,
} from "@/lib/api/types";
import { limits } from "@/lib/config";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@/lib/i18n/navigation";
import { useTransitionNavigate } from "@/lib/navigation/view-transition";
import { formatPaise } from "@/lib/money";
import { recallDocument, type PendingDocument } from "@/lib/saransh/pending";
import { AdvocateCard, AdvocateCardSkeleton } from "./AdvocateCard";

type CityKey = keyof IntlMessages["Cities"];

/**
 * The conversational Parakh view (brief §3.2): the search bar moves to the top, then a skeleton while matching,
 * at most one follow-up question as chips, then up to three advocates. Sign-in appears only on Connect.
 */
export function ParakhView({ query, documentId }: { query: string; documentId: string | null }) {
  const t = useTranslations("Parakh");
  const locale = useLocale() === "hi" ? "hi" : "en";
  const router = useRouter();
  const navigate = useTransitionNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const errors = useTranslations("Errors");
  const { session, ready, requireAuth } = useAuth();

  const [document, setDocument] = useState<PendingDocument | null>(null);
  const [tier, setTier] = useState<MatchTier | null>(null);
  const [city, setCity] = useState<CityOption | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [topUp, setTopUp] = useState<{
    advocate: AdvocateMatch;
    required: number;
    shortfall: number;
  } | null>(null);
  const [openSession, setOpenSession] = useState<string | null>(null);

  useEffect(() => setDocument(recallDocument(documentId)), [documentId]);

  // Tier is fixed once auth state is known, so signing in mid-flow doesn't reshuffle the results.
  useEffect(() => {
    if (ready && tier === null) setTier(session?.user.is_premium ? "premium" : "standard");
  }, [ready, session, tier]);

  const first = useQuery({
    queryKey: ["parakh", query, locale, tier],
    queryFn: () => getParakhClient().match({ query_text: query, locale, tier: tier ?? "standard" }),
    enabled: tier !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 0,
  });

  const needsCity = first.data?.follow_up?.kind === "location";
  const refined = useQuery({
    queryKey: ["parakh", query, locale, tier, city?.district],
    queryFn: () =>
      getParakhClient().match({
        query_text: query,
        locale,
        tier: tier ?? "standard",
        ...(city ? { state: city.state, district: city.district } : {}),
      }),
    enabled: needsCity && city !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 0,
  });

  async function connect(advocate: AdvocateMatch, matchId: string) {
    if (!(await requireAuth("connect"))) return;
    setConnecting(advocate.advocate_id);
    setOpenSession(null);
    try {
      const session = await getSamvaadClient().reserve({
        advocate_id: advocate.advocate_id,
        match_id: matchId,
        document_id: document?.id,
      });
      // The room reads this session from the cache, so it paints immediately and the avatar can glide across.
      queryClient.setQueryData(["session", session.id], session);
      navigate(`/samvaad/${session.id}`);
    } catch (error) {
      setConnecting(null);
      if (error instanceof ApiError && error.code === "insufficient_funds") {
        const required = Number(error.details.required_paise ?? 0);
        const available = Number(error.details.available_paise ?? 0);
        setTopUp({ advocate, required, shortfall: Math.max(0, required - available) });
      } else if (error instanceof ApiError && error.code === "session_exists") {
        setOpenSession(String(error.details.session_id ?? ""));
      } else {
        toast.show(errors("title"), "error");
      }
    }
  }

  const results: MatchResponse | undefined = needsCity ? refined.data : first.data;
  const searching =
    tier === null || first.isPending || (needsCity && city !== null && refined.isPending);

  return (
    <div className="mx-auto max-w-prose px-4 pt-6 pb-section-sm md:pt-10">
      <HeroSearch
        variant="compact"
        initialQuery={query}
        initialDocument={document}
        onSearch={(q, doc) =>
          router.replace({ pathname: "/parakh", query: doc ? { q, doc: doc.id } : { q } })
        }
      />
      {document ? (
        <p className="mt-3 flex items-center gap-1.5 text-caption text-ink-2">
          <Icon name="document" size={16} />
          {t("attachedDocument", { name: document.fileName })}
        </p>
      ) : null}

      <div className="mt-10" aria-live="polite">
        {first.isError ? (
          <ErrorBlock message={t("error")} onRetry={() => void first.refetch()} />
        ) : null}

        {first.data?.follow_up ? (
          <CityQuestion
            followUp={first.data.follow_up}
            selected={city}
            busy={refined.isFetching}
            onSelect={setCity}
          />
        ) : null}

        {refined.isError ? (
          <ErrorBlock message={t("error")} onRetry={() => void refined.refetch()} />
        ) : null}

        {searching && !first.isError ? <ResultsSkeleton label={t("searching")} /> : null}

        {results && !searching ? (
          <Results
            response={results}
            city={results.location ?? city}
            showLabel={!needsCity}
            connecting={connecting}
            onConnect={(advocate) => void connect(advocate, results.match_id)}
          />
        ) : null}

        {openSession ? (
          <div
            className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface p-4"
            role="status"
          >
            <p className="text-callout text-ink">{t("sessionExists")}</p>
            <ButtonLink href={`/samvaad/${openSession}`} variant="text">
              {t("returnToSession")}
            </ButtonLink>
          </div>
        ) : null}
      </div>

      {topUp ? (
        <TopUpSheet
          open
          onClose={() => setTopUp(null)}
          defaultAmount={coveringAmount(topUp.shortfall)}
          title={t("insufficientTitle")}
          description={t("insufficientBody", {
            name: topUp.advocate.display_name,
            amount: formatPaise(topUp.required),
          })}
          onPaid={() => {
            const advocate = topUp.advocate;
            setTopUp(null);
            if (results) void connect(advocate, results.match_id);
          }}
        />
      ) : null}
    </div>
  );
}

/** The smallest top-up chip that covers the shortfall (so one payment is enough), else the largest. */
function coveringAmount(shortfall: number): number {
  const chips = [...limits.topupChipsPaise].sort((a, b) => a - b);
  return chips.find((chip) => chip >= shortfall) ?? chips[chips.length - 1] ?? shortfall;
}

function CityQuestion({
  followUp,
  selected,
  busy,
  onSelect,
}: {
  followUp: NonNullable<MatchResponse["follow_up"]>;
  selected: CityOption | null;
  busy: boolean;
  onSelect: (city: CityOption) => void;
}) {
  const t = useTranslations("Parakh");
  const cities = useTranslations("Cities");
  const [showMore, setShowMore] = useState(() =>
    followUp.more.some((c) => c.district === selected?.district),
  );
  const options = showMore ? [...followUp.primary, ...followUp.more] : followUp.primary;

  return (
    <section aria-labelledby="parakh-follow-up">
      <ModuleLabel module="parakh" />
      <h2 id="parakh-follow-up" className="mt-2 text-headline font-semibold text-ink">
        {t("followUpCity")}
      </h2>
      <div role="group" aria-labelledby="parakh-follow-up" className="mt-4 flex flex-wrap gap-2">
        {options.map((option) => (
          <Chip
            key={option.district}
            selected={selected?.district === option.district}
            disabled={busy}
            onClick={() => onSelect(option)}
          >
            {cities(option.district as CityKey)}
          </Chip>
        ))}
        {!showMore ? (
          <Chip onClick={() => setShowMore(true)} disabled={busy}>
            {t("otherCity")}
          </Chip>
        ) : null}
      </div>
      {showMore ? <p className="mt-3 text-caption text-ink-2">{t("scopeNote")}</p> : null}
    </section>
  );
}

function Results({
  response,
  city,
  showLabel,
  connecting,
  onConnect,
}: {
  response: MatchResponse;
  city: CityOption | null;
  showLabel: boolean;
  connecting: string | null;
  onConnect: (advocate: AdvocateMatch) => void;
}) {
  const t = useTranslations("Parakh");
  const areas = useTranslations("PracticeAreas");
  const cities = useTranslations("Cities");
  const locale = useLocale();

  const cityName = city ? cities(city.district as CityKey) : "";
  const area = response.intent.practice_area;
  const areaName = area ? areas(area) : "";
  const heading = area
    ? t("resultsHeading", {
        count: response.results.length,
        area: locale === "en" ? areaName.toLocaleLowerCase("en") : areaName,
        city: cityName,
      })
    : t("resultsHeadingGeneral", { count: response.results.length, city: cityName });

  return (
    <section aria-labelledby="parakh-results" className={showLabel ? "" : "mt-10"}>
      {showLabel ? <ModuleLabel module="parakh" className="mb-2" /> : null}
      {response.results.length === 0 ? (
        <p id="parakh-results" className="text-body text-ink">
          {t("noResults", { city: cityName })}
        </p>
      ) : (
        <>
          <h2 id="parakh-results" className="text-headline font-semibold text-ink">
            {heading}
          </h2>
          <ul className="mt-5 flex flex-col gap-4">
            {response.results.map((advocate) => (
              <li key={advocate.advocate_id}>
                <AdvocateCard
                  advocate={advocate}
                  connecting={connecting === advocate.advocate_id}
                  disabled={connecting !== null}
                  onConnect={() => onConnect(advocate)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-6 flex items-start gap-1.5 text-caption text-ink-2">
        <Icon name="info" size={16} className="mt-px shrink-0" />
        <span>{t("disclaimer")}</span>
      </p>
    </section>
  );
}

function ResultsSkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label} className="mt-10 first:mt-0">
      <div className="h-6 w-2/3 skeleton rounded-md" aria-hidden="true" />
      <div className="mt-5 flex flex-col gap-4">
        <AdvocateCardSkeleton />
        <AdvocateCardSkeleton />
        <AdvocateCardSkeleton />
      </div>
    </SkeletonRegion>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  const common = useTranslations("Common");
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface p-5"
    >
      <p className="flex items-center gap-2 text-callout text-ink">
        <Icon name="warning" size={18} className="text-warn" />
        {message}
      </p>
      <Button variant="text" onClick={onRetry}>
        {common("retry")}
      </Button>
    </div>
  );
}
