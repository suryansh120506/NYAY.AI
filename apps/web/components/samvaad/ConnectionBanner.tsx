"use client";

import { useTranslations } from "next-intl";
import { isActivePhase } from "@/lib/samvaad/reducer";
import { useRoomStore } from "@/lib/samvaad/store";

/** "Reconnecting…" with a shimmer line (skeletons only, brief §3.1). The room keeps accepting messages meanwhile. */
export function ConnectionBanner() {
  const t = useTranslations("Samvaad");
  const connection = useRoomStore((s) => s.connection);
  const phase = useRoomStore((s) => s.phase);
  if (connection !== "reconnecting" || !isActivePhase(phase)) return null;
  return (
    <div role="status" className="relative overflow-hidden bg-ink/5">
      <p className="mx-auto max-w-page px-4 py-2 text-center text-caption text-ink">
        {t("reconnecting")}
      </p>
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 skeleton rounded-none" />
    </div>
  );
}
