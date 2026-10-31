"use client";

import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/Avatar";
import { avatarTransitionName } from "@/lib/navigation/view-transition";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Tooltip } from "@/components/ui/Tooltip";
import type { SessionInfo } from "@/lib/api/types";
import { isActivePhase } from "@/lib/samvaad/reducer";
import { useRoomStore } from "@/lib/samvaad/store";
import { cx } from "@/lib/text";
import { CitationsButton } from "@/components/workspace/CitationsButton";
import { SessionClock, WalletChip } from "./SessionMeters";

/**
 * Back (with end-session confirmation while live), the advocate's identity and presence, and the live meters.
 * Phones get a second slim row for the wallet chip and "End session" so nothing is squeezed.
 */
export function RoomHeader({
  session,
  onBack,
  onEnd,
  citationCount = 0,
  onOpenCitations,
}: {
  session: SessionInfo;
  onBack: () => void;
  onEnd: () => void;
  citationCount?: number;
  onOpenCitations?: () => void;
}) {
  const t = useTranslations("Samvaad");
  const common = useTranslations("Common");
  const online = useRoomStore((s) => s.advocateOnline);
  const typing = useRoomStore((s) => s.advocateTyping);
  const phase = useRoomStore((s) => s.phase);
  const active = isActivePhase(phase);
  const name = session.advocate.display_name;

  return (
    <header className="sticky top-0 z-30 border-b border-glass-edge bg-canvas/75 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-page items-center gap-2 px-2 md:gap-3 md:px-4">
        <button
          type="button"
          onClick={onBack}
          aria-label={common("back")}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-input text-trust hover:bg-ink/5"
        >
          <Icon name="chevron-left" size={24} />
        </button>
        <span className="relative shrink-0">
          <Avatar
            name={name}
            size="md"
            transitionName={avatarTransitionName(session.advocate.id)}
          />
          <span
            aria-hidden="true"
            className={cx(
              "absolute right-0 bottom-0 h-3 w-3 rounded-round border-2 border-canvas",
              online ? "bg-ok" : "bg-ink-2/50",
            )}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-callout font-semibold text-ink">
            <span className="truncate">{name}</span>
            <Icon name="seal" size={16} className="shrink-0 text-ok" />
            <span className="sr-only">{common("verified")}</span>
          </p>
          <p className="truncate text-caption text-ink-2" aria-live="polite">
            {typing ? t("typing", { name }) : online ? t("online") : t("offline")}
          </p>
        </div>
        {onOpenCitations && phase !== "preflight" ? (
          <CitationsButton count={citationCount} onClick={onOpenCitations} />
        ) : null}
        {active ? (
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden md:inline-flex">
              <Tooltip label={t("audioSoon")}>
                <button
                  type="button"
                  aria-disabled="true"
                  aria-label={t("audio")}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-input text-ink-2 opacity-60"
                >
                  <Icon name="phone" size={20} />
                </button>
              </Tooltip>
            </span>
            <SessionClock />
            <div className="hidden md:block">
              <WalletChip />
            </div>
            <div className="hidden md:block">
              <Button variant="danger" onClick={onEnd}>
                {t("endSession")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      {active ? (
        <div className="flex h-11 items-center justify-between border-t border-hairline px-4 md:hidden">
          <WalletChip />
          <Button variant="danger" onClick={onEnd}>
            {t("endSession")}
          </Button>
        </div>
      ) : null}
    </header>
  );
}
