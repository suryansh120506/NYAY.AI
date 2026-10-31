"use client";

import type { ReactNode } from "react";
import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  MotionConfig,
  useReducedMotion,
} from "framer-motion";

/**
 * The only place framer-motion is imported (enforced by scripts/check-design.mjs). Motion is reserved for responses
 * to what the visitor does (a citation arriving, a file being dropped, a score settling), never for page loads, and
 * it switches itself off under prefers-reduced-motion. `m` components are tree-shaken through LazyMotion.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

/** Easing for the few things that are timed rather than physical (opacity fades, sequenced ticks). */
export const EASE = [0.25, 0.1, 0.25, 1] as const;

/**
 * Motion tokens. Movement uses springs, not durations: a spring keeps its velocity when it is interrupted (a card can
 * be dismissed mid-entrance and simply turns around), which is what makes an interface feel physical.
 *  - SPRING: snappy, for things that appear or move into place (citation cards, dropzone feedback).
 *  - SPRING_SOFT: calmer, for size changes (a clause opening, a progress bar filling).
 */
export const SPRING = { type: "spring", stiffness: 520, damping: 38, mass: 0.9 } as const;
export const SPRING_SOFT = { type: "spring", stiffness: 260, damping: 32, mass: 1 } as const;

export { AnimatePresence, m, useReducedMotion };
