import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/home/PageShell";
import { alternatesFor } from "@/lib/i18n/alternates";
import { asLocale } from "@/lib/i18n/locale";
import { routing } from "@/lib/i18n/routing";

// Terms and Privacy live at /terms and /privacy. The Grievance Officer's name and contact details must come from the
// operating entity. TODO(human): publish them here (A25, A71).
const DOCS = ["grievance"] as const;
type Doc = (typeof DOCS)[number];

type Props = { params: Promise<{ locale: string; doc: string }> };

// Only the documents listed above exist; anything else is a hard 404 before streaming starts.
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => DOCS.map((doc) => ({ locale, doc })));
}

function asDoc(value: string): Doc | null {
  return DOCS.find((doc) => doc === value) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, doc } = await params;
  const key = asDoc(doc);
  if (!key) return {};
  const t = await getTranslations({ locale: asLocale(locale), namespace: "Legal" });
  return { title: t(key), alternates: alternatesFor(asLocale(locale), `/legal/${key}`) };
}

export default async function LegalPage({ params }: Props) {
  const { locale, doc } = await params;
  setRequestLocale(asLocale(locale));
  const key = asDoc(doc);
  if (!key) notFound();
  const t = await getTranslations("Legal");
  return (
    <PageShell>
      <article className="mx-auto max-w-prose px-4 py-section-sm">
        <h1 className="text-display font-semibold text-ink">{t(key)}</h1>
        <p className="mt-4 text-body text-ink-2">{t("placeholder")}</p>
      </article>
    </PageShell>
  );
}
