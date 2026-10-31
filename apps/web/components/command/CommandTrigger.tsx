"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { openCommandPalette } from "./CommandPalette";

/** The nav's way into the command palette, with the platform's shortcut shown once we know the platform. */
export function CommandTrigger() {
  const t = useTranslations("Command");
  const [shortcut, setShortcut] = useState<string | null>(null);

  useEffect(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    setShortcut(mac ? t("shortcutMac") : t("shortcutOther"));
  }, [t]);

  return (
    <button
      type="button"
      onClick={openCommandPalette}
      data-testid="command-trigger"
      aria-label={t("open")}
      aria-keyshortcuts="Meta+K Control+K"
      className="inline-flex h-11 items-center gap-2 rounded-input px-2.5 text-callout text-ink-2 transition-colors duration-150 hover:bg-ink/5 hover:text-ink"
    >
      <Search size={17} aria-hidden="true" />
      {shortcut ? (
        <kbd className="hidden rounded-md border border-hairline px-1.5 py-0.5 font-mono text-caption sm:inline">
          {shortcut}
        </kbd>
      ) : null}
    </button>
  );
}
