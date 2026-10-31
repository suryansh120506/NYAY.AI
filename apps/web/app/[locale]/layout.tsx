import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppProviders } from "@/components/providers/AppProviders";
import { publicConfig } from "@/lib/config";
import { devanagari, inter } from "@/lib/fonts";
import { alternatesFor } from "@/lib/i18n/alternates";
import { routing } from "@/lib/i18n/routing";
import "../globals.css";

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    // The public origin comes from NEXT_PUBLIC_SITE_URL, so moving to a custom domain is a one-line .env change
    // (rebuild the web app afterwards). Every canonical, hreflang and social URL below is resolved against it.
    metadataBase: new URL(publicConfig.siteUrl),
    applicationName: "Nyay.ai",
    title: { default: t("title"), template: `%s | Nyay.ai` },
    description: t("description"),
    alternates: alternatesFor(locale, "/"),
    icons: {
      icon: [
        { url: "/icon.svg", type: "image/svg+xml" },
        { url: "/favicon.ico", sizes: "48x48" },
      ],
      apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    },
    manifest: "/manifest.webmanifest",
    openGraph: {
      type: "website",
      siteName: "Nyay.ai",
      title: t("title"),
      description: t("description"),
      url: `/${locale}`,
      locale: locale === "hi" ? "hi_IN" : "en_IN",
    },
    twitter: { card: "summary", title: t("title"), description: t("description") },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1A237E", // design-check-ignore: meta theme-color needs a literal
  colorScheme: "light",
};

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} className={`${inter.variable} ${devanagari.variable}`}>
      <body className="min-h-dvh bg-canvas text-ink">
        <NextIntlClientProvider>
          <AppProviders>{children}</AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
