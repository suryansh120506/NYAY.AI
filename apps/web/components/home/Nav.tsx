import { useTranslations } from "next-intl";
import { CommandTrigger } from "@/components/command/CommandTrigger";
import { Link } from "@/lib/i18n/navigation";
import { AuthNavAction } from "./AuthNavAction";
import { LanguageToggle } from "./LanguageToggle";
import { NavBar } from "./NavBar";

/** Wordmark left; language toggle and sign-in right. Nothing else (brief §3.2). */
export function Nav() {
  const t = useTranslations("Nav");
  const brand = useTranslations("Common");
  return (
    <NavBar>
      <nav
        aria-label={t("label")}
        className="mx-auto flex h-14 max-w-page items-center justify-between px-4 md:px-6"
      >
        <Link
          href="/"
          aria-label={t("home")}
          className="-ml-1 inline-flex min-h-11 items-center px-1 text-headline font-semibold tracking-tight text-indigo"
        >
          {brand("brand")}
        </Link>
        <div className="flex items-center gap-1 md:gap-3">
          <CommandTrigger />
          <LanguageToggle />
          <AuthNavAction />
        </div>
      </nav>
    </NavBar>
  );
}
