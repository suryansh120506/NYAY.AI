"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button, ButtonLink } from "./Button";

/** Calm message + retry for every route's error.tsx (brief §3.4). Never shows stack traces or raw errors. */
export function ErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Errors");
  const common = useTranslations("Common");

  useEffect(() => {
    // Only the digest: never log user content (brief rule 6).
    console.error("route error", error.digest ?? error.name);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-prose flex-col items-center justify-center px-4 py-section-sm text-center">
      <h1 className="text-display font-semibold">{t("title")}</h1>
      <p className="mt-3 text-body text-ink-2">{t("body")}</p>
      <div className="mt-8 flex flex-col items-center gap-2">
        <Button size="lg" onClick={reset}>
          {common("retry")}
        </Button>
        <ButtonLink href="/" variant="text">
          {t("home")}
        </ButtonLink>
      </div>
    </div>
  );
}
