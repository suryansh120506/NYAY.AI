"use client";

import dynamic from "next/dynamic";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { Icon } from "@/components/ui/Icon";
import { limits } from "@/lib/config";
import { useRouter } from "@/lib/i18n/navigation";
import { rememberDocument, type PendingDocument } from "@/lib/saransh/pending";
import { cx, detectLang } from "@/lib/text";

// The upload flow is only downloaded when someone taps the paperclip.
const SaranshSheet = dynamic(
  () => import("@/components/saransh/SaranshSheet").then((m) => m.SaranshSheet),
  {
    ssr: false,
  },
);

const MIN_QUERY = 3;
const MAX_LINES = 4;

interface HeroSearchProps {
  variant?: "hero" | "compact";
  initialQuery?: string;
  initialDocument?: PendingDocument | null;
  /** Compact (Parakh page) handles the new search itself; the hero navigates to /parakh. */
  onSearch?: (query: string, document: PendingDocument | null) => void;
}

/**
 * The single entry point (brief §3.2): a large pill that accepts Hindi, English or Hinglish, grows to four lines,
 * submits on Enter, and offers document attach (sign-in first) and a circular submit arrow.
 */
export function HeroSearch({
  variant = "hero",
  initialQuery = "",
  initialDocument = null,
  onSearch,
}: HeroSearchProps) {
  const t = useTranslations("Hero");
  const locale = useLocale();
  const router = useRouter();
  const { requireAuth } = useAuth();
  const hintId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initialQuery);
  const [document, setDocument] = useState<PendingDocument | null>(initialDocument);
  const [attach, setAttach] = useState({ open: false, loaded: false });

  const trimmed = value.trim();
  const canSubmit = trimmed.length >= MIN_QUERY;
  const lang = detectLang(value, locale === "hi" ? "hi" : "en");
  const compact = variant === "compact";

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 25;
    const max = lineHeight * MAX_LINES;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [value]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSubmit) return;
    if (onSearch) {
      onSearch(trimmed, document);
      return;
    }
    router.push({
      pathname: "/parakh",
      query: document ? { q: trimmed, doc: document.id } : { q: trimmed },
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  async function openAttach() {
    if (!(await requireAuth("attach"))) return;
    setAttach({ open: true, loaded: true });
  }

  return (
    <div className={cx("mx-auto w-full text-left", compact ? "max-w-prose" : "max-w-[720px]")}>
      <form role="search" onSubmit={submit}>
        <div
          className={cx(
            "flex items-end gap-1 border border-hairline bg-surface py-2 pr-2 shadow-hairline transition-[border-color,box-shadow] duration-150 focus-within:border-trust focus-within:ring-4 focus-within:ring-trust/15",
            compact ? "min-h-14 pl-5" : "min-h-[68px] pl-6",
            "rounded-input",
          )}
        >
          <div className={cx("relative min-w-0 flex-1 self-center", compact ? "py-1.5" : "py-2")}>
            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              lang={lang}
              maxLength={limits.queryMaxLength}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label={t("inputLabel")}
              aria-describedby={hintId}
              enterKeyHint="search"
              className={cx(
                "block w-full resize-none bg-transparent text-ink outline-none focus-visible:outline-none",
                compact ? "text-body" : "text-body md:text-headline",
              )}
            />
            {value === "" ? <StaticPlaceholder compact={compact} /> : null}
            <span id={hintId} className="sr-only">
              {t("keyboardHint")}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void openAttach()}
            aria-label={t("attach")}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-input text-ink-2 transition-colors duration-200 ease-apple hover:bg-ink/5 hover:text-ink"
          >
            <Icon name="paperclip" size={22} />
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            aria-label={t("submit")}
            className={cx(
              "inline-flex shrink-0 items-center justify-center rounded-input transition-colors duration-200 ease-apple",
              compact ? "h-11 w-11" : "h-12 w-12",
              canSubmit ? "bg-trust text-surface hover:bg-trust-press" : "bg-ink/8 text-ink-2",
            )}
          >
            <Icon name="arrow-up" size={22} strokeWidth={2.25} />
          </button>
        </div>
      </form>

      {document ? (
        <div className="mt-3 flex justify-center">
          <span className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-input border border-hairline bg-surface py-1 pr-1 pl-4 text-callout text-ink">
            <Icon name="document" size={18} className="shrink-0 text-ink-2" />
            <span className="truncate">{t("attached", { name: document.fileName })}</span>
            <button
              type="button"
              onClick={() => setDocument(null)}
              aria-label={t("removeAttachment", { name: document.fileName })}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-input text-ink-2 hover:bg-ink/5 hover:text-ink"
            >
              <Icon name="close" size={16} />
            </button>
          </span>
        </div>
      ) : null}

      {attach.loaded ? (
        <SaranshSheet
          open={attach.open}
          onClose={() => setAttach((a) => ({ ...a, open: false }))}
          onDone={(doc) => {
            rememberDocument(doc);
            setDocument(doc);
            setAttach((a) => ({ ...a, open: false }));
            textareaRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

/** One example query, shown until the visitor types. Absolutely positioned: no layout shift. */
function StaticPlaceholder({ compact }: { compact: boolean }) {
  const t = useTranslations("Hero");
  const locale = useLocale();
  const text = t("placeholder1");
  const lang = detectLang(text, "en");
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <span
        lang={lang}
        className={cx(
          "absolute inset-x-0 top-1/2 -translate-y-1/2 truncate text-ink-2",
          compact ? "text-body" : "text-body md:text-headline",
          lang === "hi" && locale !== "hi" && "font-system",
        )}
      >
        {text}
      </span>
    </span>
  );
}
