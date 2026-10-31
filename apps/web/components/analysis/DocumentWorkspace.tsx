"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Check, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Chip";
import { m, MotionProvider, SPRING_SOFT } from "@/components/motion";
import { Backdrop } from "@/components/workspace/Backdrop";
import { Link } from "@/lib/i18n/navigation";
import { SAMPLE_CLAUSES, SAMPLE_FILE_NAME, SAMPLE_PAGES } from "@/lib/saransh/sample";
import type { ClauseId } from "@/lib/saransh/analysis";
import { cx } from "@/lib/text";
import { AnalysisPanel } from "./AnalysisPanel";
import { Dropzone } from "./Dropzone";
import { PdfViewer } from "./PdfViewer";

type Stage =
  | { name: "idle" }
  | { name: "uploading"; file: string; progress: number }
  | { name: "analyzing"; file: string; step: number }
  | { name: "ready"; file: string };

const STEPS = ["stepRead", "stepClauses", "stepScore"] as const;
const FIRST_FLAGGED =
  SAMPLE_CLAUSES.find((c) => c.level === "high")?.id ?? SAMPLE_CLAUSES[0]?.id ?? null;

/**
 * Document analysis workspace (night theme): drop a document, watch it upload and get analysed, then read it beside
 * its clause-by-clause analysis. PREVIEW: the file is not read yet, so the analysis shown is for a fictional sample
 * lease, and the screen says so. Wiring this to real documents needs clause extraction and a decision on whether to
 * show a score at all (docs/ASSUMPTIONS.md A75).
 */
export function DocumentWorkspace() {
  const t = useTranslations("Analysis");
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [selectedId, setSelectedId] = useState<ClauseId | null>(FIRST_FLAGGED);
  const [page, setPage] = useState(1);

  // Upload progress, then three analysis steps, then the result. All timers are cleaned up on every change.
  useEffect(() => {
    if (stage.name === "uploading") {
      const timer = window.setTimeout(() => {
        if (stage.progress >= 100) setStage({ name: "analyzing", file: stage.file, step: 0 });
        else setStage({ ...stage, progress: Math.min(100, stage.progress + 20) });
      }, 180);
      return () => window.clearTimeout(timer);
    }
    if (stage.name === "analyzing") {
      const timer = window.setTimeout(() => {
        if (stage.step >= STEPS.length - 1) setStage({ name: "ready", file: stage.file });
        else setStage({ ...stage, step: stage.step + 1 });
      }, 650);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [stage]);

  const start = (file: string) => {
    setSelectedId(FIRST_FLAGGED);
    setPage(SAMPLE_CLAUSES.find((c) => c.id === FIRST_FLAGGED)?.page ?? 1);
    setStage({ name: "uploading", file, progress: 0 });
  };

  const select = (id: ClauseId) => {
    setSelectedId(id);
    const clause = SAMPLE_CLAUSES.find((c) => c.id === id);
    if (clause) setPage(clause.page);
  };

  return (
    <MotionProvider>
      <div
        data-theme="night"
        className="relative isolate flex min-h-dvh flex-col bg-canvas text-ink lg:h-dvh"
      >
        <Backdrop />
        <header className="border-b border-glass-edge bg-canvas/70 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-[110rem] items-center gap-3 px-3 md:px-5">
            <Link
              href="/"
              aria-label={t("back")}
              className="inline-flex h-10 w-10 items-center justify-center rounded-input text-ink transition-colors duration-150 hover:bg-ink/5"
            >
              <ArrowLeft size={18} aria-hidden="true" />
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-2 eyebrow text-ink">
                {t("title")}
                <Lock size={13} aria-hidden="true" className="text-ink-2" />
              </h1>
            </div>
            {stage.name === "ready" ? (
              <>
                <Tag>{t("demo")}</Tag>
                <Button variant="secondary" onClick={() => setStage({ name: "idle" })}>
                  {t("replace")}
                </Button>
              </>
            ) : null}
          </div>
        </header>

        {stage.name === "idle" ? (
          <main id="main" className="flex flex-1 flex-col justify-center px-4 py-12">
            <div className="mx-auto mb-8 max-w-xl text-center">
              <p className="text-display font-semibold text-ink">{t("heading")}</p>
              <p className="mt-2 text-body text-ink-2">{t("subtitle")}</p>
            </div>
            <Dropzone
              onFile={(file) => start(file.name)}
              onSample={() => start(SAMPLE_FILE_NAME)}
            />
          </main>
        ) : null}

        {stage.name === "uploading" || stage.name === "analyzing" ? (
          <main id="main" className="flex flex-1 items-center justify-center px-4 py-12">
            <ProgressCard stage={stage} />
          </main>
        ) : null}

        {stage.name === "ready" ? (
          <main id="main" className="flex min-h-0 flex-1 flex-col">
            <p
              data-testid="preview-note"
              className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-caption text-ink"
            >
              {t("previewNote")}
            </p>
            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_27rem]">
              <div className="min-h-[32rem] min-w-0 lg:min-h-0">
                <PdfViewer
                  fileName={stage.file}
                  pages={SAMPLE_PAGES}
                  clauses={SAMPLE_CLAUSES}
                  selectedId={selectedId}
                  onSelect={select}
                  page={page}
                  onPage={(next) => setPage(Math.min(SAMPLE_PAGES.length, Math.max(1, next)))}
                />
              </div>
              <div className="min-h-0 border-t border-glass-edge bg-canvas/50 backdrop-blur-md lg:border-t-0 lg:border-l">
                <AnalysisPanel clauses={SAMPLE_CLAUSES} selectedId={selectedId} onSelect={select} />
              </div>
            </div>
          </main>
        ) : null}
      </div>
    </MotionProvider>
  );
}

function ProgressCard({ stage }: { stage: Extract<Stage, { name: "uploading" | "analyzing" }> }) {
  const t = useTranslations("Analysis");
  const uploading = stage.name === "uploading";
  return (
    <div
      role="status"
      data-testid="progress-card"
      className="w-full max-w-md rounded-card border border-glass-edge bg-glass p-6 shadow-glass backdrop-blur-md"
    >
      <p className="truncate text-callout font-semibold text-ink">
        {uploading ? t("uploading", { name: stage.file }) : t("analyzing", { name: stage.file })}
      </p>
      <div className="mt-4 h-1.5 overflow-hidden rounded-sm bg-ink/10" aria-hidden="true">
        <m.div
          className="h-full rounded-sm bg-trust"
          animate={{ width: uploading ? `${stage.progress}%` : "100%" }}
          transition={SPRING_SOFT}
        />
      </div>
      {!uploading ? (
        <ol className="mt-5 flex flex-col gap-2.5">
          {STEPS.map((key, index) => {
            const done = index < stage.step;
            const active = index === stage.step;
            return (
              <li
                key={key}
                className={cx(
                  "flex items-center gap-2.5 text-callout",
                  done || active ? "text-ink" : "text-ink-2",
                )}
              >
                <span
                  className={cx(
                    "inline-flex h-5 w-5 items-center justify-center rounded-sm border text-trust",
                    done ? "border-trust bg-trust/10" : "border-hairline",
                  )}
                  aria-hidden="true"
                >
                  {done ? (
                    <Check size={13} />
                  ) : active ? (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-sm bg-trust motion-reduce:animate-none" />
                  ) : null}
                </span>
                {t(key)}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
