"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Command, defaultFilter } from "cmdk";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRight,
  BookOpenText,
  FileSearch,
  Gavel,
  Home,
  Languages,
  LogIn,
  LogOut,
  Newspaper,
  Scale,
  Search,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { tap } from "@/lib/haptics";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import { useTransitionNavigate } from "@/lib/navigation/view-transition";

export const OPEN_COMMAND_EVENT = "nyay:command";

/** Opens the palette from anywhere (the nav button uses this). */
export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_COMMAND_EVENT));
}

// The free-text search always matches, so it ranks last: a typed page or preference name wins the default selection.
const SEARCH_VALUE = "search-advocates";
function rank(value: string, search: string, keywords?: string[]): number {
  return value === SEARCH_VALUE ? 0.001 : defaultFilter(value, search, keywords);
}

function Item({
  icon: Icon,
  label,
  value,
  hint,
  keywords,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  hint?: string;
  keywords?: string[];
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value ?? label}
      keywords={keywords}
      onSelect={onSelect}
      className="group flex h-11 cursor-pointer items-center gap-3 rounded-input px-3 text-callout text-ink data-[selected=true]:bg-ink/10"
    >
      <Icon
        size={16}
        aria-hidden="true"
        className="shrink-0 text-ink-2 group-data-[selected=true]:text-trust"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="text-caption text-ink-2">{hint}</span> : null}
      <ArrowRight
        size={14}
        aria-hidden="true"
        className="shrink-0 text-ink-2 opacity-0 transition-opacity duration-100 group-data-[selected=true]:opacity-100"
      />
    </Command.Item>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="px-2 pb-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-2 [&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:text-ink-2"
    >
      {children}
    </Command.Group>
  );
}

/**
 * The command palette (⌘K / Ctrl+K anywhere, or the search button in the nav): jump to any page, search for an
 * advocate with what you typed, switch language, sign in or out. Keyboard-first, fuzzy-matched in English and Hindi.
 * A native modal <dialog> provides the focus trap, Escape and the inert page behind it; cmdk provides the combobox
 * semantics. Rendered in the night theme so it reads as a layer above any page.
 */
export function CommandPalette() {
  const t = useTranslations("Command");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const navigate = useTransitionNavigate();
  const { session, requireAuth, signOut } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const close = useCallback(() => {
    dialog.current?.close();
  }, []);

  useEffect(() => {
    const toggle = () => setOpen((value) => !value);
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_EVENT, toggle);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_EVENT, toggle);
    };
  }, []);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      // React's autoFocus runs before the dialog is modal, so focus the search field once it is.
      el.querySelector<HTMLInputElement>("[cmdk-input]")?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  const run = (action: () => void) => {
    tap();
    close();
    setQuery("");
    action();
  };

  const trimmed = query.trim();
  const other = locale === "en" ? "hi" : "en";

  return (
    <dialog
      ref={dialog}
      data-theme="night"
      aria-label={t("label")}
      data-testid="command-palette"
      onClose={() => setOpen(false)}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
      className="command-dialog"
    >
      {open ? (
        <Command
          label={t("label")}
          loop
          filter={rank}
          className="flex max-h-[min(70dvh,32rem)] flex-col"
        >
          <div className="flex items-center gap-3 border-b border-glass-edge px-4">
            <Search size={18} aria-hidden="true" className="shrink-0 text-ink-2" />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder={t("placeholder")}
              className="h-14 w-full bg-transparent text-body text-ink outline-none placeholder:text-ink-2"
            />
            <kbd className="hidden shrink-0 rounded-md border border-glass-edge px-1.5 py-0.5 font-mono text-caption text-ink-2 sm:inline">
              {t("esc")}
            </kbd>
          </div>
          <Command.List className="min-h-0 flex-1 overflow-y-auto py-2">
            <Command.Empty className="px-5 py-8 text-center text-callout text-ink-2">
              {t("empty")}
            </Command.Empty>
            <Group heading={t("groupGo")}>
              <Item
                icon={Home}
                label={t("home")}
                keywords={["start", "होम"]}
                onSelect={() => run(() => navigate("/"))}
              />
              <Item
                icon={Newspaper}
                label={t("updates")}
                keywords={["news", "court", "समाचार"]}
                onSelect={() => run(() => navigate("/updates"))}
              />
              <Item
                icon={FileSearch}
                label={t("documents")}
                keywords={["saransh", "notice", "contract", "fir", "दस्तावेज़"]}
                onSelect={() => run(() => navigate("/saransh"))}
              />
              <Item
                icon={Wallet}
                label={t("wallet")}
                keywords={["balance", "top up", "वॉलेट"]}
                onSelect={() => run(() => navigate("/wallet"))}
              />
              <Item
                icon={Gavel}
                label={t("advocateDesk")}
                keywords={["lawyer", "वकील"]}
                onSelect={() => run(() => navigate("/advocate"))}
              />
              <Item
                icon={BookOpenText}
                label={t("terms")}
                keywords={["legal"]}
                onSelect={() => run(() => navigate("/terms"))}
              />
              <Item
                icon={ShieldCheck}
                label={t("privacy")}
                keywords={["data", "dpdp"]}
                onSelect={() => run(() => navigate("/privacy"))}
              />
            </Group>
            <Group heading={t("groupPreferences")}>
              <Item
                icon={Languages}
                label={t(other === "hi" ? "toHindi" : "toEnglish")}
                keywords={["language", "hindi", "english", "भाषा"]}
                onSelect={() => run(() => router.replace(pathname, { locale: other }))}
              />
              {session ? (
                <Item
                  icon={LogOut}
                  label={t("signOut")}
                  onSelect={() => run(() => void signOut())}
                />
              ) : (
                <Item
                  icon={LogIn}
                  label={t("signIn")}
                  onSelect={() => run(() => void requireAuth("generic"))}
                />
              )}
            </Group>
            {trimmed.length >= 3 ? (
              <Group heading={t("groupSearch")}>
                <Item
                  icon={Scale}
                  label={t("findFor", { query: trimmed })}
                  value={SEARCH_VALUE}
                  onSelect={() =>
                    run(() => navigate({ pathname: "/parakh", query: { q: trimmed } }))
                  }
                />
              </Group>
            ) : null}
          </Command.List>
          <p className="flex items-center gap-4 border-t border-glass-edge px-4 py-2.5 text-caption text-ink-2">
            <span>{t("hintMove")}</span>
            <span>{t("hintOpen")}</span>
          </p>
        </Command>
      ) : null}
    </dialog>
  );
}
