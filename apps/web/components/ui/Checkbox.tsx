import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "@/lib/text";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  hint?: ReactNode;
}

/** Native checkbox with the whole row as the hit target (≥ 44 px). Used for every consent record. */
export function Checkbox({ label, hint, className, id, ...rest }: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <div className={cx("flex min-h-11 items-start gap-3 py-1", className)}>
      <input
        id={inputId}
        type="checkbox"
        aria-describedby={hintId}
        className="mt-[3px] h-5 w-5 shrink-0 accent-trust"
        {...rest}
      />
      <label htmlFor={inputId} className="text-callout text-ink">
        {label}
        {hint ? (
          <span id={hintId} className="mt-0.5 block text-caption text-ink-2">
            {hint}
          </span>
        ) : null}
      </label>
    </div>
  );
}
