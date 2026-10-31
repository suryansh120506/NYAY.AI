import Link from "next/link";
import { getTranslations } from "next-intl/server";
import "./globals.css";

// Requests outside any locale (rare: the middleware prefixes every page route). Explicit locale, own document.
export default async function RootNotFound() {
  const t = await getTranslations({ locale: "en", namespace: "Errors" });
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 text-center text-ink">
        <h1 className="text-display font-semibold">{t("notFoundTitle")}</h1>
        <p className="mt-3 text-body text-ink-2">{t("notFoundBody")}</p>
        <Link
          href="/en"
          className="mt-8 text-callout font-medium text-trust underline-offset-4 hover:underline"
        >
          {t("home")}
        </Link>
      </body>
    </html>
  );
}
