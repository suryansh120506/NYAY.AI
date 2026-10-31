import { hasLocale } from "next-intl";
import { routing, type Locale } from "./routing";

/** Route params arrive as string; the [locale] layout has already 404'd anything unsupported. */
export function asLocale(value: string): Locale {
  return hasLocale(routing.locales, value) ? value : routing.defaultLocale;
}
