import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Footer } from "./Footer";
import { Nav } from "./Nav";

/** Nav → content → footer, with a skip link for keyboard users. */
export function PageShell({ children, footer = true }: { children: ReactNode; footer?: boolean }) {
  const t = useTranslations("Common");
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-input bg-surface px-4 py-3 text-callout font-medium text-trust focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t("skipToContent")}
      </a>
      <Nav />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      {footer ? <Footer /> : null}
    </>
  );
}
