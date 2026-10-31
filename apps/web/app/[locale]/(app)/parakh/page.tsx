import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageShell } from "@/components/home/PageShell";
import { ParakhView } from "@/components/parakh/ParakhView";
import { limits } from "@/lib/config";
import { redirect } from "@/lib/i18n/navigation";
import { asLocale } from "@/lib/i18n/locale";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: "Meta" });
  return { title: t("parakh"), robots: { index: false } };
}

export default async function ParakhPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  const locale = asLocale(raw);
  setRequestLocale(locale);
  const search = await searchParams;
  const query = typeof search.q === "string" ? search.q.trim().slice(0, limits.queryMaxLength) : "";
  const documentId =
    typeof search.doc === "string" && /^[\w-]{1,80}$/.test(search.doc) ? search.doc : null;
  if (query.length < 3) redirect({ href: "/", locale });

  return (
    <PageShell>
      {/* A new query remounts the conversation. */}
      <ParakhView key={`${query}|${documentId ?? ""}`} query={query} documentId={documentId} />
    </PageShell>
  );
}
