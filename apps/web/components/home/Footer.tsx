import { useTranslations } from "next-intl";
import { TransitionLink as Link } from "@/lib/navigation/view-transition";

export function Footer() {
  const t = useTranslations("Footer");
  const links = [
    { href: "/terms", label: t("terms") },
    { href: "/privacy", label: t("privacy") },
    { href: "/legal/grievance", label: t("grievance") },
    { href: "/saransh", label: t("documents") },
    { href: "/advocate", label: t("forAdvocates") },
  ] as const;

  return (
    <footer className="border-t border-hairline">
      <div className="mx-auto max-w-page px-4 py-12 md:px-6">
        <p className="max-w-prose text-caption text-ink-2">{t("disclaimer")}</p>
        <p className="mt-2 text-caption text-ink-2">{t("scope")}</p>
        <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <nav aria-label={t("links")}>
            <ul className="-ml-1 flex flex-wrap gap-x-4">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-11 items-center px-1 text-caption text-ink underline-offset-4 hover:underline"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <p className="text-caption text-ink-2">
            {t("copyright", { year: new Date().getFullYear() })}
          </p>
        </div>
      </div>
    </footer>
  );
}
