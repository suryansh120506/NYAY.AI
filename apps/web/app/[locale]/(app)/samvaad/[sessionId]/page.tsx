import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SamvaadRoom } from "@/components/samvaad/SamvaadRoom";
import { asLocale } from "@/lib/i18n/locale";

type Props = { params: Promise<{ locale: string; sessionId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: "Meta" });
  return { title: t("samvaad"), robots: { index: false } };
}

export default async function SamvaadPage({ params }: Props) {
  const { locale, sessionId } = await params;
  setRequestLocale(asLocale(locale));
  return <SamvaadRoom sessionId={decodeURIComponent(sessionId).slice(0, 120)} />;
}
