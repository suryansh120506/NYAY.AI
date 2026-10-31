import { useTranslations } from "next-intl";

/** Three quiet, icon-less statements (brief §3.2). */
export function TrustRow() {
  const t = useTranslations("Trust");
  const items = [t("verified"), t("payPerMinute"), t("private")];
  return (
    <ul
      aria-label={t("label")}
      className="flex flex-col items-center gap-2 text-callout text-ink-2 md:flex-row md:justify-center md:gap-0"
    >
      {items.map((item, index) => (
        <li key={item} className="flex items-center">
          {index > 0 ? (
            <span aria-hidden="true" className="mx-4 hidden md:inline">
              {"·"}
            </span>
          ) : null}
          {item}
        </li>
      ))}
    </ul>
  );
}
