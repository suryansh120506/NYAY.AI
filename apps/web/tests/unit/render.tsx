import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

/** Renders inside the same intl context the app provides (messages, locale, Asia/Kolkata time zone). */
export function renderWithIntl(
  ui: ReactElement,
  { locale = "en", ...options }: { locale?: "en" | "hi" } & RenderOptions = {},
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "en" ? en : hi}
        timeZone="Asia/Kolkata"
      >
        {children}
      </NextIntlClientProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}
