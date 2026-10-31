"use client";

import { useRef, useState, type DragEvent } from "react";
import { useTranslations } from "next-intl";
import { FileUp, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { FieldError } from "@/components/ui/Field";
import { m, SPRING } from "@/components/motion";
import { limits } from "@/lib/config";
import { cx } from "@/lib/text";

export type DropError = "type" | "size" | "consent" | null;

/** Validates the file the way the upload endpoint will: type first, then size. */
export function validateFile(file: {
  type: string;
  size: number;
}): Exclude<DropError, "consent" | null> | null {
  if (!(limits.saranshMimeTypes as readonly string[]).includes(file.type)) return "type";
  if (file.size > limits.saranshMaxBytes) return "size";
  return null;
}

/**
 * The upload surface for legal documents (FIR, notice, contract). Drag a file in or choose one; a consent box must
 * be ticked first, as for every document we process. The border and icon respond while a file is dragged over.
 */
export function Dropzone({
  onFile,
  onSample,
}: {
  onFile: (file: File) => void;
  onSample: () => void;
}) {
  const t = useTranslations("Analysis");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<DropError>(null);

  function accept(file: File | undefined) {
    if (!file) return;
    if (!consent) return setError("consent");
    const problem = validateFile(file);
    if (problem) return setError(problem);
    setError(null);
    onFile(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files[0]);
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <m.div
        data-testid="dropzone"
        data-dragging={dragging}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        animate={{ scale: dragging ? 1.015 : 1 }}
        transition={SPRING}
        className={cx(
          "relative flex flex-col items-center rounded-card border border-dashed bg-glass px-6 py-14 text-center shadow-glass backdrop-blur-md transition-colors duration-150",
          dragging ? "border-trust bg-trust/10" : "border-glass-edge",
        )}
      >
        {(
          [
            "top-3 left-3 border-t border-l",
            "top-3 right-3 border-t border-r",
            "bottom-3 left-3 border-b border-l",
            "bottom-3 right-3 border-b border-r",
          ] as const
        ).map((position) => (
          <span
            key={position}
            aria-hidden="true"
            className={cx(
              "absolute h-3.5 w-3.5 transition-colors duration-150",
              position,
              dragging ? "border-trust" : "border-ink-2/50",
            )}
          />
        ))}
        <m.span
          animate={{ y: dragging ? -4 : 0 }}
          transition={SPRING}
          className="inline-flex h-14 w-14 items-center justify-center rounded-card border border-glass-edge bg-glass text-trust"
        >
          <FileUp size={26} aria-hidden="true" />
        </m.span>
        <p className="mt-5 text-headline font-semibold text-ink">
          {dragging ? t("dropActive") : t("dropTitle")}
        </p>
        <p className="mt-1 text-callout text-ink-2">{t("dropHint")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={() => inputRef.current?.click()}>{t("choose")}</Button>
          <Button variant="secondary" onClick={onSample} data-testid="use-sample">
            {t("useSample")}
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={limits.saranshMimeTypes.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-label={t("choose")}
          data-testid="file-input"
          onChange={(event) => {
            accept(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
        <p className="mt-6 text-caption text-ink-2">{t("formats")}</p>
      </m.div>

      <div className="mt-5">
        <Checkbox
          label={t("consent")}
          checked={consent}
          onChange={(event) => {
            setConsent(event.currentTarget.checked);
            if (event.currentTarget.checked && error === "consent") setError(null);
          }}
        />
        {error ? (
          <FieldError>
            {error === "consent"
              ? t("consentRequired")
              : error === "type"
                ? t("badType")
                : t("tooLarge")}
          </FieldError>
        ) : null}
      </div>

      <p className="mt-5 flex items-center justify-center gap-1.5 text-caption text-ink-2">
        <Lock size={13} aria-hidden="true" />
        {t("secure")}
      </p>
    </div>
  );
}
