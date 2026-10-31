import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdvocateDesk } from "@/components/advocate/AdvocateDesk";
import { PageShell } from "@/components/home/PageShell";
import { asLocale } from "@/lib/i18n/locale";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: "Meta" });
  return { title: t("advocateDesk"), robots: { index: false } };
}

export default async function AdvocateDeskPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(asLocale(locale));
  return (
    <PageShell>
      <AdvocateDesk />
    </PageShell>
  );
}
