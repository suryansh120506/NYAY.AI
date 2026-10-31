"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, FileText, ZoomIn, ZoomOut } from "lucide-react";
import type { Clause, Level } from "@/lib/saransh/analysis";
import type { SamplePage } from "@/lib/saransh/sample";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/text";

const PAPER_LEVEL: Record<Level, string> = {
  high: "border-paper-risk-edge bg-paper-risk",
  review: "border-paper-review-edge bg-paper-review",
  standard: "border-paper-ok-edge bg-paper-ok",
};

const ZOOM_STEPS = [0.85, 1, 1.15, 1.3] as const;

function ToolbarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  // aria-disabled (not disabled) keeps the button focusable, so its tooltip still explains it at the edges.
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) onClick();
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-input text-ink transition-colors duration-150 hover:bg-ink/5 aria-disabled:text-ink-2 aria-disabled:opacity-50"
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * A mock PDF viewer: a white page with the document's text, a toolbar (page and zoom) and every clause highlighted by
 * level (red high risk, amber review, green standard). Clicking a clause selects it in the analysis panel.
 */
export function PdfViewer({
  fileName,
  pages,
  clauses,
  selectedId,
  onSelect,
  page,
  onPage,
}: {
  fileName: string;
  pages: readonly SamplePage[];
  clauses: readonly Clause[];
  selectedId: string | null;
  onSelect: (id: Clause["id"]) => void;
  page: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations("Analysis");
  const [zoomIndex, setZoomIndex] = useState(1);
  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;
  const paperRef = useRef<HTMLElement>(null);
  const current = pages[page - 1];

  // Bring the selected clause into view (instantly: pages here stay still).
  useEffect(() => {
    if (!selectedId) return;
    paperRef.current
      ?.querySelector<HTMLElement>(`[data-clause="${selectedId}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [selectedId, page]);

  return (
    <section
      aria-label={t("viewerLabel")}
      data-testid="pdf-viewer"
      className="flex h-full min-h-0 flex-col terminal-grid"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-glass-edge bg-canvas/70 px-4 py-2.5 backdrop-blur-md">
        <p className="flex min-w-0 items-center gap-2 text-callout text-ink">
          <FileText size={16} aria-hidden="true" className="shrink-0 text-ink-2" />
          <span className="truncate">{fileName}</span>
        </p>
        <div className="flex items-center gap-1">
          <ToolbarButton
            label={t("prevPage")}
            onClick={() => onPage(page - 1)}
            disabled={page <= 1}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </ToolbarButton>
          <span
            className="min-w-24 text-center font-mono text-caption text-ink-2 tabular"
            data-testid="page-indicator"
          >
            {t("pageOf", { page, total: pages.length })}
          </span>
          <ToolbarButton
            label={t("nextPage")}
            onClick={() => onPage(page + 1)}
            disabled={page >= pages.length}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </ToolbarButton>
          <span className="mx-1 h-5 w-px bg-hairline" aria-hidden="true" />
          <ToolbarButton
            label={t("zoomOut")}
            onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
            disabled={zoomIndex === 0}
          >
            <ZoomOut size={18} aria-hidden="true" />
          </ToolbarButton>
          <span className="w-11 text-center font-mono text-caption text-ink-2 tabular">
            {Math.round(zoom * 100)}%
          </span>
          <ToolbarButton
            label={t("zoomIn")}
            onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
          >
            <ZoomIn size={18} aria-hidden="true" />
          </ToolbarButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-6 md:px-8">
        <article
          ref={paperRef}
          lang="en"
          style={{ fontSize: `${14 * zoom}px` }}
          className="mx-auto min-h-[44em] w-full max-w-[46em] rounded-md bg-paper px-[3em] py-[3em] font-serif text-paper-ink shadow-deep"
        >
          {current?.blocks.map((block, index) => {
            if (block.type === "title")
              return (
                <h2 key={index} className="text-[1.45em] leading-tight font-semibold">
                  {block.text}
                </h2>
              );
            if (block.type === "heading")
              return (
                <h3 key={index} className="mt-[1.4em] mb-[0.5em] text-[1em] font-semibold">
                  {block.text}
                </h3>
              );
            if (block.type === "para")
              return (
                <p key={index} className="mt-[0.9em] leading-relaxed">
                  {block.text}
                </p>
              );
            const clause = clauses.find((c) => c.id === block.id);
            if (!clause) return null;
            const selected = selectedId === clause.id;
            return (
              <button
                key={index}
                type="button"
                data-clause={clause.id}
                data-level={clause.level}
                aria-pressed={selected}
                onClick={() => onSelect(clause.id)}
                className={cx(
                  "my-[0.45em] block w-full rounded-sm border-l-4 px-[0.9em] py-[0.6em] text-left leading-relaxed text-paper-ink transition-shadow duration-150",
                  PAPER_LEVEL[clause.level],
                  selected && "ring-2 ring-trust ring-offset-2 ring-offset-paper",
                )}
              >
                <span className="font-semibold">
                  {t("clauseNumber", { number: clause.number })}
                </span>
                {clause.text}
              </button>
            );
          })}
          <p className="mt-[2.5em] text-center text-[0.8em] text-paper-ink">
            {page} / {pages.length}
          </p>
        </article>
      </div>
    </section>
  );
}
