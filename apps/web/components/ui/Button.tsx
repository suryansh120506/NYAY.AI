import { forwardRef, type ButtonHTMLAttributes } from "react";
import { TransitionLink, type TransitionLinkProps } from "@/lib/navigation/view-transition";
import { cx } from "@/lib/text";

/**
 * primary: the one filled trust button per screen (brief §3.1).
 * tinted:  Apple-style tinted pill for repeated actions in lists (e.g. "Connect" on each advocate card), so a
 *          screen never shows more than one filled trust button (docs/ASSUMPTIONS.md A27).
 */
export type ButtonVariant = "primary" | "secondary" | "tinted" | "text" | "quiet" | "danger";
export type ButtonSize = "md" | "lg";

const BASE =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,color,opacity] duration-150 disabled:pointer-events-none";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-trust text-surface hover:bg-trust-press active:bg-trust-press disabled:bg-ink/10 disabled:text-ink-2",
  secondary: "border border-hairline bg-surface text-ink hover:bg-ink/2 disabled:text-ink-2",
  tinted: "bg-trust/10 text-trust hover:bg-trust/15 disabled:bg-ink/5 disabled:text-ink-2",
  text: "text-trust underline-offset-4 hover:underline disabled:text-ink-2",
  quiet: "text-ink-2 hover:text-ink disabled:opacity-60",
  danger: "text-danger underline-offset-4 hover:underline disabled:opacity-60",
};

const SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 rounded-input px-5 text-callout",
  lg: "min-h-14 rounded-input px-7 text-body",
};

const TEXT_SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 px-1 text-callout",
  lg: "min-h-11 px-1 text-body",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string | undefined;
} = {}): string {
  const textLike = variant === "text" || variant === "quiet" || variant === "danger";
  return cx(
    BASE,
    VARIANTS[variant],
    textLike ? TEXT_SIZES[size] : SIZES[size],
    fullWidth && "w-full",
    className,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, fullWidth, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    />
  );
});

type ButtonLinkProps = TransitionLinkProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
};

export function ButtonLink({ variant, size, fullWidth, className, ...rest }: ButtonLinkProps) {
  return (
    <TransitionLink className={buttonClasses({ variant, size, fullWidth, className })} {...rest} />
  );
}
