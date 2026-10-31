"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EnsureQueryClient } from "@/components/providers/QueryProvider";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import type { PendingDocument } from "@/lib/saransh/pending";
import { LOW_CONFIDENCE, useSaranshDocument } from "@/lib/saransh/useSaranshDocument";
import { SaranshCard } from "./SaranshCard";
import { SaranshUploader } from "./SaranshUploader";

interface SaranshSheetProps {
  open: boolean;
  onClose: () => void;
  onDone: (doc: PendingDocument) => void;
  /** Attach straight to an existing (reserved) session from the pre-flight card. */
  sessionId?: string | undefined;
}

/** Upload → skeleton → three-bullet summary, all before the paid clock starts (brief §1.3 Saransh). */
export function SaranshSheet({ open, onClose, onDone, sessionId }: SaranshSheetProps) {
  const t = useTranslations("Saransh");
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("title")}
      description={t("subtitle")}
      testId="saransh-sheet"
    >
      <EnsureQueryClient>
        <SaranshFlow onDone={onDone} onSkip={onClose} sessionId={sessionId} />
      </EnsureQueryClient>
    </Sheet>
  );
}

function SaranshFlow({
  onDone,
  onSkip,
  sessionId,
}: {
  onDone: (doc: PendingDocument) => void;
  onSkip: () => void;
  sessionId?: string | undefined;
}) {
  const t = useTranslations("Saransh");
  const [uploaded, setUploaded] = useState<PendingDocument | null>(null);
  const query = useSaranshDocument(uploaded?.id ?? null);

  if (!uploaded) return <SaranshUploader sessionId={sessionId} onUploaded={setUploaded} />;

  const document = query.data;
  const ready = document?.status === "ready" && document.result !== null;
  const failed = document?.status === "failed";
  const lowConfidence = ready && (document.result?.confidence ?? 1) < LOW_CONFIDENCE;

  return (
    <div>
      <SaranshCard
        document={document}
        loading={query.isPending}
        className="border border-hairline"
      />
      <div className="mt-6 flex flex-col gap-2">
        {ready ? (
          <Button size="lg" fullWidth onClick={() => onDone(uploaded)}>
            {t("useSummary")}
          </Button>
        ) : null}
        {failed ? (
          <Button size="lg" fullWidth onClick={() => setUploaded(null)}>
            {t("replace")}
          </Button>
        ) : null}
        {failed || lowConfidence ? (
          <Button variant="quiet" fullWidth onClick={onSkip}>
            {t("continueWithout")}
          </Button>
        ) : null}
        {ready && !lowConfidence ? (
          <Button variant="quiet" fullWidth onClick={() => setUploaded(null)}>
            {t("replace")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
