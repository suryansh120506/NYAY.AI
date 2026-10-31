"use client";

import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactElement,
} from "react";

const SHOW_DELAY_MS = 350;
const GAP = 6;

function supportsAnchoring(): boolean {
  return typeof CSS !== "undefined" && CSS.supports("anchor-name: --a");
}

/**
 * A label for an icon-only control. Built on the platform: a `popover="manual"` element in the top layer (never
 * clipped by overflow), placed with CSS anchor positioning and flipped below when there is no room above. Where anchor
 * positioning is missing it is placed from the trigger's measured box instead. Shows on hover after a short delay
 * and immediately on keyboard focus; Escape hides it. The text is also the trigger's accessible description.
 */
export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  const id = useId();
  const anchor = `--tip-${id.replace(/[^a-zA-Z0-9]/g, "")}`;
  const wrapper = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function place() {
    const el = tip.current;
    const host = wrapper.current;
    if (!el || !host || supportsAnchoring()) return;
    const box = host.getBoundingClientRect();
    const size = el.getBoundingClientRect();
    const above = box.top - size.height - GAP;
    const top = above >= 0 ? above : box.bottom + GAP;
    const left = Math.min(
      Math.max(GAP, box.left + box.width / 2 - size.width / 2),
      window.innerWidth - size.width - GAP,
    );
    el.style.position = "fixed";
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }

  function show(delay: number) {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = tip.current;
      if (!el || el.matches(":popover-open")) return;
      el.showPopover();
      place();
    }, delay);
  }

  function hide() {
    window.clearTimeout(timer.current);
    const el = tip.current;
    if (el?.matches(":popover-open")) el.hidePopover();
  }

  return (
    <span
      ref={wrapper}
      className="inline-flex"
      style={{ anchorName: anchor } as CSSProperties}
      onPointerEnter={() => show(SHOW_DELAY_MS)}
      onPointerLeave={hide}
      onFocus={() => show(0)}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === "Escape") hide();
      }}
    >
      {cloneElement(children, { "aria-describedby": id })}
      <span
        ref={tip}
        id={id}
        role="tooltip"
        popover="manual"
        data-anchored=""
        className="tooltip"
        style={{ positionAnchor: anchor } as CSSProperties}
      >
        {label}
      </span>
    </span>
  );
}
