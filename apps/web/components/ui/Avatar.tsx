import { cx, initials } from "@/lib/text";

const SIZES = {
  sm: "h-8 w-8 text-caption",
  md: "h-11 w-11 text-callout",
  lg: "h-14 w-14 text-headline",
} as const;

/** Initials only: no photos in the MVP. Decorative because the name is always shown next to it. */
export function Avatar({
  name,
  size = "md",
  className,
  transitionName,
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
  /** view-transition-name, for avatars that move between pages. */
  transitionName?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={transitionName ? { viewTransitionName: transitionName } : undefined}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-round bg-indigo/8 font-semibold text-indigo select-none",
        SIZES[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
