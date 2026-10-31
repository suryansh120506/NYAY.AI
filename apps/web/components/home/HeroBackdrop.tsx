"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const HeroShader = dynamic(() => import("./HeroShader"), { ssr: false });

/**
 * Loads the hero shader only once the browser is idle, so it never competes with the headline (the LCP element) or
 * the search box. Until then, and wherever WebGL is unavailable, the hero is the plain canvas colour.
 */
export function HeroBackdrop() {
  const [load, setLoad] = useState(false);

  useEffect(() => {
    const start = () => setLoad(true);
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(start, { timeout: 2_500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(start, 1_200);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(120%_85%_at_50%_0%,black_45%,transparent_100%)]"
    >
      {load ? <HeroShader /> : null}
    </div>
  );
}
