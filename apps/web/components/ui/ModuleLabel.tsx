import { useTranslations } from "next-intl";
import { cx } from "@/lib/text";

type Module = "parakh" | "samvaad" | "saransh";

/** Hindi module name with a short subtitle (brief §0): "सारांश · Summary". The hidden ranking module never appears in the UI. */
export function ModuleLabel({ module, className }: { module: Module; className?: string }) {
  const t = useTranslations("Modules");
  return (
    <p className={cx("text-caption font-medium tracking-wide text-ink-2", className)}>
      <span lang="hi" className="text-indigo">
        {t(module)}
      </span>
      <span aria-hidden="true">{" · "}</span>
      <span>{t(`${module}Sub`)}</span>
    </p>
  );
}
