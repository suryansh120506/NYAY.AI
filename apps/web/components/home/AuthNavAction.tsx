"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { buttonClasses } from "@/components/ui/Button";
import { Link } from "@/lib/i18n/navigation";

/** Text-only "Sign in"; becomes a quiet "Wallet" link once signed in. */
export function AuthNavAction() {
  const t = useTranslations("Nav");
  const { session, requireAuth } = useAuth();

  if (session) {
    return (
      <Link
        href="/wallet"
        className={buttonClasses({ variant: "text", className: "text-callout" })}
      >
        {t("wallet")}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void requireAuth("generic")}
      className={buttonClasses({ variant: "text", className: "text-callout" })}
    >
      {t("signIn")}
    </button>
  );
}
