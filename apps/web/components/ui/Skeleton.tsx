import type { ReactNode } from "react";
import { cx } from "@/lib/text";

type Rounded = "input" | "card" | "control" | "circle" | "text";

const ROUNDED: Record<Rounded, string> = {
  input: "rounded-input",
  card: "rounded-card",
  control: "rounded-input",
  circle: "rounded-round",
  text: "rounded-md",
};

/** Shape-accurate placeholder (brief §3.1: no spinners anywhere). Decorative; wrap groups in <SkeletonRegion>. */
export function Skeleton({
  className,
  rounded = "text",
}: {
  className?: string;
  rounded?: Rounded;
}) {
  return <div aria-hidden="true" className={cx("skeleton", ROUNDED[rounded], className)} />;
}

/** Announces a loading region once to screen readers while its skeletons are on screen. */
export function SkeletonRegion({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/**
 * Wrapper for route-level loading.tsx. Next.js renders loading.tsx before the [locale] layout has set the request
 * locale, so these files must never call next-intl (docs/ASSUMPTIONS.md A29): the skeleton is purely visual and
 * the page announces itself when it arrives.
 */
export function RouteSkeleton({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div aria-busy="true" className={className}>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/** A paragraph of text lines; the last line is shorter, like real copy. */
export function SkeletonText({
  lines = 3,
  className,
  lineClassName = "h-4",
}: {
  lines?: number;
  className?: string;
  lineClassName?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-2.5", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx(lineClassName, i === lines - 1 ? "w-3/5" : "w-full")} />
      ))}
    </div>
  );
}
