"use client";

import { useTranslations } from "next-intl";
import type { CourtRef } from "@/lib/api/types";

type CourtKey = keyof IntlMessages["Courts"];
type LanguageKey = keyof IntlMessages["Languages"];

/** Localised court name by code, falling back to the API's English name for courts the UI doesn't know yet. */
export function useCourtName() {
  const t = useTranslations("Courts");
  return (court: CourtRef): string => {
    const key = court.code as CourtKey;
    return t.has(key) ? t(key) : court.name;
  };
}

export function useLanguageName() {
  const t = useTranslations("Languages");
  return (code: string): string => {
    const key = code as LanguageKey;
    return t.has(key) ? t(key) : code;
  };
}
