"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { BookOpenText, Check, Copy, ExternalLink, History, Scale } from "lucide-react";
import { AnimatePresence, m, MotionProvider, SPRING } from "@/components/motion";
import { ACT_NAMES, INDIA_CODE_URL } from "@/lib/legal/bare-acts";
import type { Citation } from "@/lib/legal/citations";
import { cx } from "@/lib/text";
import { Backdrop } from "./Backdrop";

function useMentionLine(otherName: string) {
  const t = useTranslations("Workspace");
  const format = useFormatter();
  return (citation: Citation) => {
    const last = citation.mentions[citation.mentions.length - 1];
    if (!last) return "";
    const who = last.from === "user" ? t("mentionedByYou") : t("mentionedBy", { name: otherName });
    const time = format.dateTime(new Date(last.ts), { hour: "2-digit", minute: "2-digit" });
    const count = citation.mentions.length;
    return count > 1 ? `${who} · ${time} · ${t("mentionedCount", { count })}` : `${who} · ${time}`;
  };
}

function CopyButton({ text }: { text: string }) {
  const t = useTranslations("Workspace");
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_600);
        } catch {
          setCopied(false);
        }
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-input border border-glass-edge bg-glass px-3 text-caption font-medium text-ink transition-colors duration-150 hover:bg-ink/10"
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span aria-live="polite">{copied ? t("copied") : t("copy")}</span>
    </button>
  );
}

function SourceLink() {
  const t = useTranslations("Workspace");
  return (
    <a
      href={INDIA_CODE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-8 items-center gap-1.5 rounded-input px-3 text-caption font-medium text-trust transition-colors duration-150 hover:bg-trust/10"
    >
      {t("openSource")}
      <ExternalLink size={14} aria-hidden="true" />
      <span className="sr-only">{t("opensInNewTab")}</span>
    </a>
  );
}

/** A frosted card: translucent fill, blur, a one-pixel edge and a lit top edge (see --shadow-glass). */
function CitationCard({ citation, mentionLine }: { citation: Citation; mentionLine: string }) {
  const t = useTranslations("Workspace");
  const { provision } = citation;
  const headingId = `citation-${citation.key.replace(/[^A-Za-z0-9]/g, "-")}`;
  const bare = provision?.text.join("\n\n") ?? "";

  return (
    <article
      aria-labelledby={headingId}
      data-testid="citation-card"
      data-citation={citation.key}
      className="@container overflow-hidden rounded-card border border-glass-edge bg-glass shadow-glass backdrop-blur-md"
    >
      <header className="flex flex-col-reverse items-start justify-between gap-2 border-b border-glass-edge px-4 py-3.5 @sm:flex-row @sm:gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 eyebrow text-trust">
            <Scale size={13} aria-hidden="true" />
            <span>{citation.act ? ACT_NAMES[citation.act] : t("actUnknown")}</span>
          </p>
          <h3 id={headingId} className="mt-1.5 text-headline font-semibold text-ink tabular">
            {t("section", { section: citation.section })}
          </h3>
          <p lang="en" className="mt-0.5 text-callout text-ink-2">
            {provision ? provision.title : t("notInLibraryTitle")}
          </p>
        </div>
        {provision?.replaced ? (
          <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-warn/40 bg-warn/10 px-2 text-caption font-medium text-warn">
            <History size={13} aria-hidden="true" />
            {t("replacedBadge", { date: provision.replaced.on })}
          </span>
        ) : null}
      </header>

      {provision ? (
        <>
          <blockquote
            lang="en"
            className="mx-4 my-4 flex flex-col gap-3 border-l-2 border-trust pl-4 font-serif text-body text-ink"
          >
            {provision.text.map((paragraph) => (
              <p key={paragraph.slice(0, 24)}>{paragraph}</p>
            ))}
          </blockquote>
          {provision.replaced ? (
            <p className="mx-4 mb-4 rounded-input border border-glass-edge bg-ink/5 px-3 py-2.5 text-caption text-ink-2">
              {t("replacedNote", {
                act: ACT_NAMES[provision.replaced.by],
                date: provision.replaced.on,
                section: provision.replaced.section,
              })}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mx-4 my-4 text-callout text-ink-2">{t("notInLibraryBody")}</p>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-glass-edge px-3 py-2.5">
        <p className="px-1 text-caption text-ink-2">{mentionLine}</p>
        <div className="flex items-center gap-1">
          {provision ? (
            <CopyButton text={`${t("section", { section: citation.section })}\n\n${bare}`} />
          ) : null}
          <SourceLink />
        </div>
      </footer>
    </article>
  );
}

function Empty() {
  const t = useTranslations("Workspace");
  return (
    <div
      data-testid="citation-empty"
      className="flex flex-col items-center rounded-card border border-dashed border-glass-edge bg-glass px-6 py-12 text-center backdrop-blur-md"
    >
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-input border border-glass-edge text-ink-2">
        <BookOpenText size={20} aria-hidden="true" />
      </span>
      <p className="mt-4 max-w-xs text-callout text-ink">{t("empty")}</p>
      <p className="mt-1 text-caption text-ink-2">{t("emptyHint")}</p>
    </div>
  );
}

/**
 * The right-hand side of the workspace: a frosted card with the Bare Act text for every section of law mentioned in
 * the conversation, newest first, over a soft glow-and-grid backdrop. Cards slide in when a section is first
 * mentioned (and respect reduced motion).
 */
export function CitationPanel({
  citations,
  otherName,
  className,
  embedded = false,
}: {
  citations: Citation[];
  otherName: string;
  className?: string;
  /** Inside a sheet, which already has a title. */
  embedded?: boolean;
}) {
  const t = useTranslations("Workspace");
  const mentionLine = useMentionLine(otherName);
  return (
    <MotionProvider>
      <section
        aria-label={t("panelLabel")}
        data-testid="citation-panel"
        className={cx("relative isolate flex h-full min-h-0 flex-col", className)}
      >
        <Backdrop />
        {embedded ? null : (
          <header className="flex items-center justify-between gap-3 border-b border-glass-edge bg-canvas/60 px-5 py-4 backdrop-blur-md">
            <div>
              <h2 className="eyebrow text-ink">{t("title")}</h2>
              <p className="mt-1 text-caption text-ink-2">{t("subtitle")}</p>
            </div>
            <span
              data-testid="citation-count"
              className="inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-glass-edge bg-glass px-2 font-mono text-caption font-medium text-ink tabular"
            >
              {citations.length}
            </span>
          </header>
        )}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
          aria-live="polite"
          aria-relevant="additions"
        >
          {citations.length === 0 ? (
            <Empty />
          ) : (
            <ol className="flex flex-col gap-4">
              <AnimatePresence initial={false}>
                {citations.map((citation) => (
                  <m.li
                    key={citation.key}
                    initial={{ opacity: 0, y: 14, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={SPRING}
                  >
                    <CitationCard citation={citation} mentionLine={mentionLine(citation)} />
                  </m.li>
                ))}
              </AnimatePresence>
            </ol>
          )}
        </div>
        <p className="border-t border-glass-edge bg-canvas/60 px-5 py-3 text-caption text-ink-2 backdrop-blur-md">
          {t("verifyNote")}
        </p>
      </section>
    </MotionProvider>
  );
}
