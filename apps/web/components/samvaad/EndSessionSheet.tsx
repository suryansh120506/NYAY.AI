"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";

/** Confirmation before ending a live consultation. The safe choice ("Keep talking") is the primary one. */
export function EndSessionSheet({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("Samvaad");
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={t("endConfirmTitle")}
      description={t("endConfirmBody")}
      testId="end-sheet"
    >
      <div className="flex flex-col gap-2">
        <Button size="lg" fullWidth onClick={onCancel} data-autofocus>
          {t("keepTalking")}
        </Button>
        <Button variant="danger" fullWidth onClick={onConfirm}>
          {t("endSession")}
        </Button>
      </div>
    </Sheet>
  );
}
