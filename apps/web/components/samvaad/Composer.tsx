"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/Icon";
import { limits } from "@/lib/config";
import { tap } from "@/lib/haptics";
import { cx, detectLang } from "@/lib/text";

const MAX_LINES = 6;
const TYPING_IDLE_MS = 3_000;

/**
 * Auto-growing white pill. Enter sends, Shift+Enter adds a line, IME composition is respected (Hindi keyboards).
 * Never blocked by the network: sending is optimistic (brief §3.1). Disabled with an explanation when not live.
 */
export function Composer({
  enabled,
  disabledReason,
  advocateName,
  onSend,
  onTyping,
}: {
  enabled: boolean;
  disabledReason: string | null;
  advocateName: string;
  onSend: (text: string) => void;
  onTyping: (on: boolean) => void;
}) {
  const t = useTranslations("Samvaad");
  const ref = useRef<HTMLTextAreaElement>(null);
  const idleTimer = useRef<number | undefined>(undefined);
  const [value, setValue] = useState("");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 25;
    const max = lineHeight * MAX_LINES;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [value]);

  useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  function stopTyping() {
    window.clearTimeout(idleTimer.current);
    onTyping(false);
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = value.trim();
    if (!enabled || text === "") return;
    tap();
    onSend(text);
    setValue("");
    stopTyping();
    ref.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  const canSend = enabled && value.trim() !== "";

  return (
    <div>
      <form
        onSubmit={submit}
        className={cx(
          "flex items-end gap-2 border border-hairline bg-surface py-1.5 pr-1.5 pl-4 transition-[border-color,box-shadow,border-radius] duration-200 ease-apple focus-within:border-trust focus-within:ring-4 focus-within:ring-trust/15",
          "rounded-input",
          !enabled && "opacity-60",
        )}
      >
        <textarea
          ref={ref}
          rows={1}
          value={value}
          lang={detectLang(value, "en")}
          disabled={!enabled}
          maxLength={limits.messageMaxLength}
          placeholder={t("composerPlaceholder")}
          aria-label={t("composerLabel", { name: advocateName })}
          aria-describedby={disabledReason ? "composer-reason" : undefined}
          enterKeyHint="send"
          onKeyDown={onKeyDown}
          onBlur={stopTyping}
          onChange={(e) => {
            setValue(e.target.value);
            if (e.target.value.trim() !== "") {
              onTyping(true);
              window.clearTimeout(idleTimer.current);
              idleTimer.current = window.setTimeout(() => onTyping(false), TYPING_IDLE_MS);
            }
          }}
          className="block min-h-11 flex-1 resize-none self-center bg-transparent py-2.5 text-body text-ink outline-none placeholder:text-ink-2 focus-visible:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label={t("send")}
          className={cx(
            "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-input transition-colors duration-200 ease-apple",
            canSend ? "bg-trust text-surface hover:bg-trust-press" : "bg-ink/8 text-ink-2",
          )}
        >
          <Icon name="arrow-up" size={20} strokeWidth={2.25} />
        </button>
      </form>
      {disabledReason ? (
        <p id="composer-reason" className="mt-2 text-center text-caption text-ink-2">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}
