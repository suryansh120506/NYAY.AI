"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cx } from "@/lib/text";
import { Icon } from "./Icon";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** false = cannot be closed with Escape, the scrim or a close button (e.g. the session summary). */
  dismissible?: boolean;
  className?: string;
  /** Extra hook for tests and analytics. */
  testId?: string;
}

const CLOSE_ANIMATION_MS = 260;

/**
 * Bottom sheet on phones, centred card from md up. Built on the native modal <dialog>: the platform provides the
 * focus trap, the inert background and Escape. Content stays mounted through the close transition, then unmounts,
 * so each opening starts fresh.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  dismissible = true,
  className,
  testId,
}: SheetProps) {
  const t = useTranslations("Common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [mounted, setMounted] = useState(open);

  if (open && !mounted) setMounted(true);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      // React's autoFocus runs before showModal(), which then moves focus to the first focusable element.
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      const timer = window.setTimeout(() => {
        setMounted(false);
        // Only hand focus back if the person has not already moved it somewhere else during the close animation.
        const active = document.activeElement;
        if (!active || active === document.body || dialog.contains(active))
          restoreFocusRef.current?.focus();
      }, CLOSE_ANIMATION_MS);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open, mounted]);

  if (!mounted) return null;

  return (
    <dialog
      ref={dialogRef}
      data-testid={testId}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cx("sheet", className)}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClose={() => {
        // Some browsers force-close on a repeated Escape; reopen if the owner still wants the sheet.
        if (open && !dismissible) dialogRef.current?.showModal();
      }}
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="px-6 pt-6 pb-[max(24px,env(safe-area-inset-bottom))] md:px-8 md:pt-8 md:pb-8">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="pt-1.5 text-headline font-semibold">
            {title}
          </h2>
          {dismissible ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("close")}
              className="-mt-1 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-input text-ink-2 transition-colors duration-200 ease-apple hover:bg-ink/5 hover:text-ink"
            >
              <Icon name="close" size={20} />
            </button>
          ) : null}
        </div>
        {description ? (
          <div id={descriptionId} className="mt-2 text-callout text-ink-2">
            {description}
          </div>
        ) : null}
        <div className="mt-6">{children}</div>
      </div>
    </dialog>
  );
}
