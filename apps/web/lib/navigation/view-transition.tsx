"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Link, usePathname, useRouter } from "@/lib/i18n/navigation";

type Href = Parameters<ReturnType<typeof useRouter>["push"]>[0];
type Navigate = (href: Href) => void;

/** Longest the old page may stay frozen while the next one loads (prefetched routes take a few frames). */
const MAX_FREEZE_MS = 700;

const NavigateContext = createContext<Navigate | null>(null);

function pathOf(href: Href): string {
  const raw = typeof href === "string" ? href : href.pathname;
  return raw.split(/[?#]/)[0] ?? "";
}

/**
 * Page-to-page navigation with the View Transitions API. The browser snapshots the old page, we push the new route,
 * and the snapshot is released once the new route has committed (plus two frames for its effects), so the page
 * cross-fades and elements that share a `view-transition-name` (an advocate's avatar on the results and in the room)
 * glide from one place to the other. Falls back to a plain navigation when the API is missing, under reduced motion,
 * and when only the query string changes.
 */
export function ViewTransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    const resolve = pending.current;
    if (!resolve) return;
    pending.current = null;
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }, [pathname]);

  const navigate = useCallback<Navigate>(
    (href) => {
      const canAnimate =
        typeof document !== "undefined" &&
        "startViewTransition" in document &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
        pathOf(href) !== pathname;
      if (!canAnimate) {
        router.push(href);
        return;
      }
      document.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            pending.current = resolve;
            window.setTimeout(resolve, MAX_FREEZE_MS);
            router.push(href);
          }),
      );
    },
    [router, pathname],
  );

  return <NavigateContext.Provider value={navigate}>{children}</NavigateContext.Provider>;
}

/** Navigate with a view transition (plain router.push outside the provider, e.g. in unit tests). */
export function useTransitionNavigate(): Navigate {
  const navigate = useContext(NavigateContext);
  const router = useRouter();
  return navigate ?? ((href) => router.push(href));
}

/** A locale-aware Link that animates the navigation. New-tab and modified clicks behave normally. */
export type TransitionLinkProps = Omit<ComponentProps<typeof Link>, "href"> & { href: Href };

export function TransitionLink({ href, onClick, target, ...rest }: TransitionLinkProps) {
  const navigate = useTransitionNavigate();
  return (
    <Link
      href={href}
      target={target}
      {...rest}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          (target && target !== "_self")
        )
          return;
        event.preventDefault();
        navigate(href);
      }}
    />
  );
}

/** Shared-element name for an advocate's avatar, the same on the results card and in the consultation room. */
export const avatarTransitionName = (advocateId: string) =>
  `avatar-${advocateId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
