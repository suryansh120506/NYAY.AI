import { formatPaise, type FormatPaiseOptions, type Paise } from "@/lib/money";
import { cx } from "@/lib/text";

/** Every price, balance and timer uses tabular numerals (brief §3.1). */
export function Money({
  paise,
  className,
  ...options
}: { paise: Paise; className?: string } & FormatPaiseOptions) {
  return <span className={cx("tabular", className)}>{formatPaise(paise, options)}</span>;
}
