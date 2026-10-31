"use client";

import { useTranslations } from "next-intl";
import { ButtonLink } from "@/components/ui/Button";

/**
 * Client component on purpose: Next.js renders not-found boundaries before the [locale] layout sets the request
 * locale, so server-side next-intl calls here would resolve the wrong language (docs/ASSUMPTIONS.md A29).
 */
export default function LocaleNotFound() {
  const t = useTranslations("Errors");
  return (
    <main className="mx-auto flex min-h-dvh max-w-prose flex-col items-center justify-center px-4 text-center">
      <h1 className="text-display font-semibold text-ink">{t("notFoundTitle")}</h1>
      <p className="mt-3 text-body text-ink-2">{t("notFoundBody")}</p>
      <ButtonLink href="/" size="lg" className="mt-8">
        {t("home")}
      </ButtonLink>
    </main>
  );
}
