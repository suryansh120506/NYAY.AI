"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Icon } from "@/components/ui/Icon";
import type { TimelineItem } from "@/lib/samvaad/reducer";
import { useRoomStore } from "@/lib/samvaad/store";
import { MessageBubble } from "./MessageBubble";

function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/**
 * Virtualised message log (react-virtuoso). Sticks to the bottom unless the person has scrolled up, in which case a
 * "New messages" pill appears. role="log" + aria-live="polite" (brief §3.1 accessibility).
 */
export function MessageList({
  advocateName,
  onRetry,
}: {
  advocateName: string;
  onRetry: (clientMsgId: string) => void;
}) {
  const t = useTranslations("Samvaad");
  const format = useFormatter();
  const items = useRoomStore((s) => s.items);
  const typing = useRoomStore((s) => s.advocateTyping);
  const virtuoso = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(false);
  const seenCount = useRef(items.length);

  const lastOwnKey = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item && item.kind === "message" && item.from === "user") return item.key;
    }
    return null;
  }, [items]);

  useEffect(() => {
    if (items.length > seenCount.current && !atBottom) {
      const last = items[items.length - 1];
      // Your own new message always scrolls into view; others raise the pill.
      if (last?.kind === "message" && last.from === "user") {
        virtuoso.current?.scrollToIndex({ index: items.length - 1, behavior: "smooth" });
      } else {
        setUnseen(true);
      }
    }
    seenCount.current = items.length;
  }, [items, atBottom]);

  useEffect(() => {
    if (atBottom) setUnseen(false);
  }, [atBottom]);

  const daySeparator = (item: TimelineItem, previous: TimelineItem | undefined) => {
    if (previous && sameDay(previous.ts, item.ts)) return null;
    const label = sameDay(item.ts, new Date().toISOString())
      ? t("today")
      : format.dateTime(new Date(item.ts), { day: "numeric", month: "short" });
    return <p className="py-3 text-center text-caption font-medium text-ink-2">{label}</p>;
  };

  return (
    <div className="relative min-h-0 flex-1">
      <Virtuoso
        ref={virtuoso}
        data={items}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={t("logLabel", { name: advocateName })}
        className="h-full"
        initialTopMostItemIndex={Math.max(0, items.length - 1)}
        followOutput={(isAtBottom) => (isAtBottom ? "smooth" : false)}
        atBottomStateChange={setAtBottom}
        atBottomThreshold={48}
        computeItemKey={(_, item) => item.key}
        increaseViewportBy={{ top: 400, bottom: 200 }}
        components={{
          Header: () => <div className="h-4" />,
          Footer: () =>
            typing ? (
              <div className="mx-auto max-w-[720px] px-4 pt-1 pb-4" aria-hidden="true">
                <div className="inline-flex items-center gap-1 rounded-card rounded-bl-[6px] border border-hairline bg-surface px-4 py-3">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-pulse rounded-round bg-ink-2 motion-reduce:animate-none"
                      style={{ animationDelay: `${i * 160}ms` }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-4" />
            ),
        }}
        itemContent={(index, item) => (
          <div className="mx-auto max-w-[720px] px-4 py-1">
            {daySeparator(item, items[index - 1])}
            {item.kind === "system" ? (
              <p className="py-2 text-center text-caption text-ink-2">
                {item.event === "billing_started"
                  ? t("billingStarted", { name: advocateName })
                  : item.event === "low_balance"
                    ? t("lowBalanceLine")
                    : t("sessionEndedLine")}
              </p>
            ) : (
              <MessageBubble
                message={item}
                showStatus={item.key === lastOwnKey}
                onRetry={onRetry}
              />
            )}
          </div>
        )}
      />
      {unseen ? (
        <button
          type="button"
          onClick={() =>
            virtuoso.current?.scrollToIndex({ index: items.length - 1, behavior: "smooth" })
          }
          className="absolute bottom-4 left-1/2 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-input bg-ink px-4 text-callout font-medium text-surface"
        >
          <Icon name="arrow-down" size={16} />
          {t("newMessages")}
        </button>
      ) : null}
    </div>
  );
}
