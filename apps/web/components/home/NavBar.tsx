import type { ReactNode } from "react";

/** Sticky bar with a solid background and a fixed hairline. Nothing reacts to scrolling. */
export function NavBar({ children }: { children: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-canvas">{children}</header>
  );
}
