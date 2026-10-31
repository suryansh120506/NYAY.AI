import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalDocumentView } from "@/components/legal/LegalDocumentView";
import { PageShell } from "@/components/home/PageShell";
import { alternatesFor } from "@/lib/i18n/alternates";
import { asLocale } from "@/lib/i18n/locale";
import { routing } from "@/lib/i18n/routing";
import { PRIVACY } from "@/lib/legal/privacy";

type Props = { params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: "Legal" });
  return { title: t("privacy"), alternates: alternatesFor(asLocale(locale), "/privacy") };
}

export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(asLocale(locale));
  const t = await getTranslations("Legal");
  return (
    <PageShell>
      <LegalDocumentView title={t("privacy")} document={PRIVACY} />
    </PageShell>
  );
}
