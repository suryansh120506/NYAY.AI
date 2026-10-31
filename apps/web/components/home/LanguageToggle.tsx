"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/lib/i18n/navigation";
import { routing, type Locale } from "@/lib/i18n/routing";
import { cx } from "@/lib/text";

/** EN | हिं. Keeps the current path and query when switching. */
export function LanguageToggle() {
  const t = useTranslations("Language");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div role="group" aria-label={t("label")} className="flex items-center">
      {routing.locales.map((target: Locale) => {
        const active = target === locale;
        return (
          <Link
            key={target}
            href={pathname}
            locale={target}
            lang={target}
            hrefLang={target}
            aria-current={active ? "true" : undefined}
            aria-label={t(target === "en" ? "enFull" : "hiFull")}
            onClick={(event) => {
              if (active) {
                event.preventDefault();
                return;
              }
              const search = window.location.search;
              if (search) {
                event.preventDefault();
                router.replace(`${pathname}${search}`, { locale: target });
              }
            }}
            className="group inline-flex h-11 min-w-11 items-center justify-center"
          >
            <span
              className={cx(
                "rounded-input px-2.5 py-1 text-caption font-semibold transition-colors duration-200 ease-apple",
                active ? "bg-ink/8 text-ink" : "text-ink-2 group-hover:text-ink",
                // On English pages the "हिं" label alone would download the Devanagari web font; system fonts suffice.
                target === "hi" && locale !== "hi" && "font-system",
              )}
            >
              {t(target)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
