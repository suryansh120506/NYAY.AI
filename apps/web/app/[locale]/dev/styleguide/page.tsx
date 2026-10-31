import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SheetDemo, TokenSwatches, ToastDemo } from "@/components/dev/StyleguideDemos";
import { PageShell } from "@/components/home/PageShell";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Chip, Tag } from "@/components/ui/Chip";
import { Money } from "@/components/ui/Money";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { asLocale } from "@/lib/i18n/locale";

// Dev only (brief §4 step 1.2). Demo builds can opt in with NEXT_PUBLIC_ENABLE_STYLEGUIDE=true.
const enabled =
  process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_ENABLE_STYLEGUIDE === "true";

export const metadata: Metadata = { robots: { index: false } };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-hairline py-10">
      <h2 className="text-headline font-semibold text-ink">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default async function StyleguidePage({ params }: { params: Promise<{ locale: string }> }) {
  if (!enabled) notFound();
  const { locale } = await params;
  setRequestLocale(asLocale(locale));
  const t = await getTranslations("Styleguide");

  return (
    <PageShell>
      <div className="mx-auto max-w-page px-4 py-12 md:px-6">
        <h1 className="text-display font-semibold text-ink">{t("title")}</h1>
        <p className="mt-2 text-body text-ink-2">{t("intro")}</p>

        <Section title={t("colors")}>
          <TokenSwatches />
        </Section>

        <Section title={t("type")}>
          <div className="flex flex-col gap-4">
            <p className="text-hero font-semibold">{t("title")}</p>
            <p className="text-figure font-semibold tabular">
              <Money paise={123_450} />
            </p>
            <p className="text-display font-semibold">{t("sample")}</p>
            <p className="text-headline font-semibold">{t("sample")}</p>
            <p className="text-body">{t("sample")}</p>
            <p className="text-body" lang="hi">
              {t("sampleHi")}
            </p>
            <p className="text-callout text-ink-2">{t("sample")}</p>
            <p className="text-caption text-ink-2">{t("sample")}</p>
          </div>
        </Section>

        <Section title={t("buttons")}>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg">{t("primary")}</Button>
            <Button variant="secondary">{t("secondary")}</Button>
            <Button variant="tinted">{t("tinted")}</Button>
            <Button variant="text">{t("text")}</Button>
            <Button disabled>{t("disabled")}</Button>
          </div>
        </Section>

        <Section title={t("chips")}>
          <div className="flex flex-wrap items-center gap-2">
            <Chip>{t("chip")}</Chip>
            <Chip selected>{t("chipSelected")}</Chip>
            <Tag>{t("chip")}</Tag>
            <Tag tone="indigo">{t("chip")}</Tag>
          </div>
        </Section>

        <Section title={t("avatars")}>
          <div className="flex items-center gap-3">
            <Avatar name="Demo Aarti Verma" size="sm" />
            <Avatar name="Demo Rohan Srivastava" size="md" />
            <Avatar name="Demo Sana Khan" size="lg" />
          </div>
        </Section>

        <Section title={t("money")}>
          <ul className="flex flex-col gap-1 text-body">
            <li>
              <Money paise={9_000} />
            </li>
            <li>
              <Money paise={123_450} />
            </li>
            <li>
              <Money paise={12_345_650} />
            </li>
            <li>
              <Money paise={-21_540} />
            </li>
            <li>
              <Money paise={20_000} signed trimZeroPaise />
            </li>
          </ul>
        </Section>

        <Section title={t("skeletons")}>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-card border border-hairline bg-surface p-5">
              <div className="flex items-center gap-3">
                <Skeleton rounded="circle" className="h-11 w-11" />
                <Skeleton className="h-4 w-40" />
              </div>
              <SkeletonText lines={3} className="mt-4" />
            </div>
            <Skeleton rounded="card" className="h-40" />
          </div>
        </Section>

        <Section title={t("sheet")}>
          <SheetDemo />
        </Section>

        <Section title={t("toast")}>
          <ToastDemo />
        </Section>
      </div>
    </PageShell>
  );
}
