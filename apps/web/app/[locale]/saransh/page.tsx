import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DocumentWorkspace } from "@/components/analysis/DocumentWorkspace";
import { alternatesFor } from "@/lib/i18n/alternates";
import { asLocale } from "@/lib/i18n/locale";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: "Meta" });
  return { title: t("analysis"), alternates: alternatesFor(asLocale(locale), "/saransh") };
}

export default async function DocumentAnalysisPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(asLocale(locale));
  return <DocumentWorkspace />;
}
