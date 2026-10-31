"use client";

import { BookOpenText } from "lucide-react";
import { useTranslations } from "next-intl";

/** Phones and tablets have no side panel: this header button opens the citations in a sheet instead. */
export function CitationsButton({ count, onClick }: { count: number; onClick: () => void }) {
  const t = useTranslations("Workspace");
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="citations-button"
      aria-label={t("openPanel", { count })}
      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-input px-3 text-callout font-medium text-ink transition-colors duration-150 hover:bg-ink/5 lg:hidden"
    >
      <BookOpenText size={18} aria-hidden="true" />
      <span className="tabular">{count}</span>
    </button>
  );
}
