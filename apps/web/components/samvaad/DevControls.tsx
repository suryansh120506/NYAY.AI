"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { devControls } from "@/lib/api/mock/samvaad-server";

/** Offline demo only: drive the reconnect, failed-send and low-balance paths on demand. Never rendered with real APIs. */
export function DevControls({ sessionId }: { sessionId: string }) {
  const t = useTranslations("Samvaad");
  const panel = useRef<HTMLDetailsElement>(null);
  const actions = [
    { label: t("devDrop"), run: () => devControls.dropConnection(sessionId), id: "drop" },
    { label: t("devFailNext"), run: () => devControls.failNextMessage(sessionId), id: "fail" },
    { label: t("devLowBalance"), run: () => devControls.skipToLowBalance(sessionId), id: "low" },
  ];
  return (
    <details
      ref={panel}
      className="fixed top-28 left-3 z-20 rounded-card border border-hairline bg-surface text-caption md:top-20"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 font-medium text-ink-2 select-none">
        {t("devControls")}
      </summary>
      <div className="flex flex-col gap-1 px-2 pb-2">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            data-testid={`dev-${action.id}`}
            onClick={() => {
              action.run();
              // Close so the panel never covers the conversation on small screens.
              if (panel.current) panel.current.open = false;
            }}
            className="min-h-11 rounded-input px-3 text-left text-ink hover:bg-ink/5"
          >
            {action.label}
          </button>
        ))}
      </div>
    </details>
  );
}
