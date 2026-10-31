import { useLocale, useTranslations } from "next-intl";
import type { LegalDocument } from "@/lib/legal/types";

/**
 * A long-form legal text: numbered sections, plain typography, no decoration. The text itself is published in
 * English (the controlling language); Hindi pages carry a short notice saying so.
 */
export function LegalDocumentView({ title, document }: { title: string; document: LegalDocument }) {
  const t = useTranslations("Legal");
  const locale = useLocale();

  return (
    <article className="mx-auto max-w-prose px-4 pt-8 pb-section-sm md:pt-12">
      <div
        aria-hidden="true"
        className="fixed inset-x-0 top-0 z-50 scroll-progress h-0.5 bg-trust"
      />
      <h1 className="text-display font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-caption text-ink-2">{t("version", { version: document.version })}</p>
      {locale !== "en" ? (
        <p className="mt-4 rounded-card border border-hairline bg-surface p-4 text-callout text-ink">
          {t("englishNotice")}
        </p>
      ) : null}
      <p lang="en" className="mt-6 text-body text-ink">
        {document.intro}
      </p>

      <nav aria-label={t("contents")} className="mt-8">
        <h2 className="text-callout font-semibold text-ink">{t("contents")}</h2>
        <ul className="mt-2 flex flex-col">
          {document.sections.map((section) => (
            <li key={section.id}>
              <a
                lang="en"
                href={`#${section.id}`}
                className="inline-flex min-h-11 items-center text-callout text-trust underline-offset-4 hover:underline"
              >
                {section.heading}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div lang="en" className="mt-4">
        {document.sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-heading`}
            className="scroll-mt-6 border-t border-hairline py-8"
          >
            <h2 id={`${section.id}-heading`} className="text-headline font-semibold text-ink">
              {section.heading}
            </h2>
            <div className="mt-3 flex flex-col gap-3">
              {section.body.map((block, index) =>
                typeof block === "string" ? (
                  <p key={index} className="text-body text-ink">
                    {block}
                  </p>
                ) : (
                  <ul key={index} className="flex list-disc flex-col gap-2 pl-6 text-body text-ink">
                    {block.list.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
