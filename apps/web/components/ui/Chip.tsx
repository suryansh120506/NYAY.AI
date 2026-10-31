import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "@/lib/text";

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Toggle chips expose aria-pressed; plain action chips (e.g. a follow-up answer) leave it undefined. */
  selected?: boolean | undefined;
}

/** Shared chip look, also used by link chips (e.g. server-rendered category filters). */
export function chipClasses(selected: boolean | undefined, className?: string): string {
  return cx(
    "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-input border px-4 text-callout font-medium transition-colors duration-200 ease-apple select-none disabled:opacity-50",
    selected
      ? "border-ink bg-ink text-surface"
      : "border-hairline bg-surface text-ink hover:bg-ink/2",
    className,
  );
}

/** Tappable pill: follow-up answers, category filters, top-up amounts. Hit target is 44 px. */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={chipClasses(selected, className)}
      {...rest}
    />
  );
});

/** Non-interactive label: practice areas, categories on cards. */
export function Tag({
  children,
  className,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  tone?: "neutral" | "indigo";
}) {
  return (
    <span
      className={cx(
        "inline-flex h-7 items-center rounded-input px-3 text-caption font-medium",
        // Outlined: ink-2 on a tinted fill drops below 4.5:1 on the canvas (WCAG 1.4.3).
        tone === "indigo" ? "bg-indigo/8 text-indigo" : "border border-hairline text-ink-2",
        className,
      )}
    >
      {children}
    </span>
  );
}
