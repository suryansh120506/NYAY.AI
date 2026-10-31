/**
 * A very short vibration on phones that support it (Android Chrome), to confirm an action the way native apps do.
 * Never on desktop pointers, never under reduced motion, and silently a no-op where the API is missing (iOS).
 */
export function tap(): void {
  if (typeof window === "undefined" || typeof navigator.vibrate !== "function") return;
  if (!window.matchMedia("(pointer: coarse)").matches) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  navigator.vibrate(8);
}
