"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/lib/text";

const TOKENS = [
  { name: "canvas", swatch: "bg-canvas" },
  { name: "surface", swatch: "bg-surface" },
  { name: "ink", swatch: "bg-ink" },
  { name: "ink-2", swatch: "bg-ink-2" },
  { name: "hairline", swatch: "bg-hairline" },
  { name: "trust", swatch: "bg-trust" },
  { name: "trust-press", swatch: "bg-trust-press" },
  { name: "indigo", swatch: "bg-indigo" },
  { name: "ok", swatch: "bg-ok" },
  { name: "warn", swatch: "bg-warn" },
  { name: "danger", swatch: "bg-danger" },
] as const;

/** Token values are read from the live stylesheet, so this page can never drift from globals.css. */
export function TokenSwatches() {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    setValues(
      Object.fromEntries(
        TOKENS.map((token) => [token.name, style.getPropertyValue(`--color-${token.name}`).trim()]),
      ),
    );
  }, []);
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {TOKENS.map((token) => {
        const cssVariable = `--color-${token.name}`;
        return (
          <li key={token.name} className="rounded-card border border-hairline bg-surface p-3">
            <div className={cx("h-14 rounded-input border border-hairline", token.swatch)} />
            <p className="mt-2 text-caption font-medium text-ink">{cssVariable}</p>
            <p className="text-caption text-ink-2 tabular">{values[token.name] ?? ""}</p>
          </li>
        );
      })}
    </ul>
  );
}

export function SheetDemo() {
  const t = useTranslations("Styleguide");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t("openSheet")}
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("sheetTitle")}
        description={t("sheetBody")}
      >
        <Button size="lg" fullWidth onClick={() => setOpen(false)}>
          {t("primary")}
        </Button>
      </Sheet>
    </>
  );
}

export function ToastDemo() {
  const t = useTranslations("Styleguide");
  const toast = useToast();
  return (
    <Button variant="secondary" onClick={() => toast.show(t("toastMessage"), "success")}>
      {t("showToast")}
    </Button>
  );
}
