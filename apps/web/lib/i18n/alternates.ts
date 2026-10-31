import type { Metadata } from "next";
import type { Locale } from "./routing";

/** Canonical + hreflang for a localized page; absolute via metadataBase in the [locale] layout. */
export function alternatesFor(locale: Locale, path: string): NonNullable<Metadata["alternates"]> {
  const suffix = path === "/" ? "" : path;
  return {
    canonical: `/${locale}${suffix}`,
    languages: { en: `/en${suffix}`, hi: `/hi${suffix}`, "x-default": `/en${suffix}` },
  };
}
