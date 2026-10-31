import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/home/PageShell";
import { WalletView } from "@/components/wallet/WalletView";
import { asLocale } from "@/lib/i18n/locale";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: "Meta" });
  return { title: t("wallet"), robots: { index: false } };
}

export default async function WalletPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(asLocale(locale));
  return (
    <PageShell>
      <WalletView />
    </PageShell>
  );
}
