import type { ReactNode } from "react";
import { cx } from "@/lib/text";
import { Icon } from "./Icon";

/** Shared look for single-line inputs: white surface, hairline border, 14 px radius, ≥ 56 px tall. */
export const fieldClasses =
  "flex min-h-14 w-full items-center rounded-input border border-hairline bg-surface text-body transition-[border-color,box-shadow] duration-200 ease-apple focus-within:border-trust focus-within:ring-4 focus-within:ring-trust/15";

export const bareInputClasses =
  "h-14 w-full min-w-0 bg-transparent px-4 text-body text-ink outline-none placeholder:text-ink-2 focus-visible:outline-none";

export function FieldLabel({
  htmlFor,
  children,
  className,
}: {
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cx("mb-2 block text-callout font-medium text-ink", className)}
    >
      {children}
    </label>
  );
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-2 flex items-start gap-1.5 text-callout text-danger">
      <Icon name="warning" size={18} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
