"use client";

import { useMutation } from "@tanstack/react-query";
import { useId, useRef, useState, type DragEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { FieldError } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { getSaranshClient } from "@/lib/api/saransh";
import { ApiError } from "@/lib/api/types";
import { limits } from "@/lib/config";
import type { PendingDocument } from "@/lib/saransh/pending";
import { cx } from "@/lib/text";

type UploadError = "tooLarge" | "badType" | "dailyCap" | "consentRequired" | "failed";

function validate(file: File): UploadError | null {
  if (!(limits.saranshMimeTypes as readonly string[]).includes(file.type)) return "badType";
  if (file.size > limits.saranshMaxBytes) return "tooLarge";
  return null;
}

/**
 * Drag-drop, file picker and camera capture (mobile), behind an explicit consent record (brief §1.3 Saransh,
 * DPDP). Upload returns 202 + document id; the summary is polled by the caller.
 */
export function SaranshUploader({
  sessionId,
  onUploaded,
}: {
  sessionId?: string | undefined;
  onUploaded: (doc: PendingDocument) => void;
}) {
  const t = useTranslations("Saransh");
  const locale = useLocale() === "hi" ? "hi" : "en";
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [consent, setConsent] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<UploadError | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) =>
      getSaranshClient().upload(file, { consent: true, locale, sessionId }),
    onSuccess: (result, file) => onUploaded({ id: result.document_id, fileName: file.name }),
    onError: (err) => {
      if (err instanceof ApiError) {
        const map: Partial<Record<ApiError["code"], UploadError>> = {
          file_too_large: "tooLarge",
          unsupported_type: "badType",
          daily_cap: "dailyCap",
          consent_required: "consentRequired",
        };
        setError(map[err.code] ?? "failed");
      } else {
        setError("failed");
      }
    },
  });

  function pick(file: File | undefined) {
    if (!file) return;
    if (!consent) {
      setError("consentRequired");
      return;
    }
    const problem = validate(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    upload.mutate(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    pick(event.dataTransfer.files[0]);
  }

  if (upload.isPending && upload.variables) {
    return (
      <SkeletonRegion
        label={t("uploading", { name: upload.variables.name })}
        className="rounded-card bg-canvas p-5"
      >
        <div className="flex items-center gap-3">
          <Icon name="document" size={22} className="shrink-0 text-ink-2" />
          <p className="truncate text-callout text-ink">
            {t("uploading", { name: upload.variables.name })}
          </p>
        </div>
        <Skeleton rounded="control" className="mt-4 h-1.5 w-full" />
      </SkeletonRegion>
    );
  }

  return (
    <div>
      <Checkbox
        checked={consent}
        onChange={(e) => {
          setConsent(e.target.checked);
          if (e.target.checked && error === "consentRequired") setError(null);
        }}
        label={t("consent")}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        aria-describedby={error ? errorId : undefined}
        className={cx(
          "mt-4 flex flex-col items-center rounded-card border border-dashed px-5 py-8 text-center transition-colors duration-200 ease-apple",
          dragging ? "border-trust bg-trust/5" : "border-ink/15 bg-canvas",
          !consent && "opacity-60",
        )}
      >
        <Icon name="upload" size={28} className="text-ink-2" />
        <p className="mt-3 text-callout text-ink">
          {dragging ? t("dropzoneActive") : t("dropzone")}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button
            variant="secondary"
            onClick={() => fileInput.current?.click()}
            aria-disabled={!consent}
          >
            <Icon name="document" size={18} />
            {t("choose")}
          </Button>
          <Button
            variant="secondary"
            className="md:hidden"
            onClick={() => cameraInput.current?.click()}
            aria-disabled={!consent}
          >
            <Icon name="camera" size={18} />
            {t("camera")}
          </Button>
        </div>
        <p className="mt-4 text-caption text-ink-2">{t("formats")}</p>
        <input
          ref={fileInput}
          type="file"
          accept={limits.saranshMimeTypes.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/jpeg,image/png"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {error ? <FieldError id={errorId}>{t(error)}</FieldError> : null}
    </div>
  );
}
