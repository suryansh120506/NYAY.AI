import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { HeroBackdrop } from "@/components/home/HeroBackdrop";
import { HeroSearch } from "@/components/home/HeroSearch";
import { PageShell } from "@/components/home/PageShell";
import { TrustRow } from "@/components/home/TrustRow";
import { NewsFeed } from "@/components/news/NewsFeed";
import { NewsFeedSkeleton } from "@/components/news/NewsFeedSkeleton";
import { alternatesFor } from "@/lib/i18n/alternates";
import { asLocale } from "@/lib/i18n/locale";

// News is cached for 300 s (brief §1.3 News); the page re-renders on the same cadence.
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: alternatesFor(asLocale(locale), "/") };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(asLocale(locale));
  const t = await getTranslations("Hero");
  const news = await getTranslations("News");
  const common = await getTranslations("Common");

  return (
    <PageShell>
      <section className="relative isolate flex min-h-[calc(88dvh-56px)] flex-col justify-center overflow-hidden px-4 py-section-sm text-center md:px-6">
        <HeroBackdrop />
        <h1 className="mx-auto max-w-[14ch] text-hero font-semibold text-ink">{t("title")}</h1>
        <p className="mx-auto mt-5 max-w-[34rem] text-body text-ink-2 md:text-headline md:leading-snug">
          {t("subtitle")}
        </p>
        <div className="mt-10 md:mt-12">
          <HeroSearch />
        </div>
        <div className="mt-14 md:mt-16">
          <TrustRow />
        </div>
      </section>

      <section
        aria-labelledby="news-title"
        className="mx-auto max-w-page px-4 pb-section-sm md:px-6 md:pb-section"
      >
        <h2 id="news-title" className="text-display font-semibold text-ink">
          {news("title")}
        </h2>
        <Suspense fallback={<NewsFeedSkeleton withHeader={false} label={common("loading")} />}>
          <NewsFeed />
        </Suspense>
      </section>
    </PageShell>
  );
}
