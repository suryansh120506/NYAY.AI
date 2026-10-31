"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/Icon";
import type { ChatMessage } from "@/lib/samvaad/reducer";
import { cx, detectLang } from "@/lib/text";

/**
 * Own messages: trust-blue with white text; the advocate's: white with a hairline. Radius 20 with a 6 px tail
 * corner, max 72 % wide, selectable text. Status under the last own message; failed ones offer "Tap to retry".
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  showStatus,
  onRetry,
}: {
  message: ChatMessage;
  showStatus: boolean;
  onRetry: (clientMsgId: string) => void;
}) {
  const t = useTranslations("Samvaad");
  const own = message.from === "user";
  const failed = message.status === "failed";
  const lang = detectLang(message.text, "en");

  return (
    <div className={cx("flex flex-col", own ? "items-end" : "items-start")}>
      <div
        lang={lang}
        className={cx(
          "max-w-[72%] rounded-card px-4 py-2.5 text-body break-words whitespace-pre-wrap select-text",
          own
            ? "rounded-br-[4px] bg-trust text-surface shadow-hairline"
            : "rounded-bl-[4px] border border-glass-edge bg-glass text-ink",
          failed && "opacity-60",
        )}
      >
        {message.text}
      </div>
      {own && failed && message.clientMsgId ? (
        <button
          type="button"
          onClick={() => onRetry(message.clientMsgId ?? "")}
          className="mt-1 inline-flex min-h-11 items-center gap-1 px-1 text-caption font-medium text-danger"
        >
          <Icon name="warning" size={14} />
          {t("failed")}
        </button>
      ) : own && showStatus ? (
        <p className="mt-1 px-1 text-caption text-ink-2" data-testid="message-status">
          {message.status === "sending" ? t("sending") : t("sent")}
        </p>
      ) : null}
    </div>
  );
});
