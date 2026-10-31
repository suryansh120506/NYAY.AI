"use client";

import { useEffect, useState } from "react";
import { useFormatter } from "next-intl";

/**
 * "3h ago". Renders with the server's clock first (identical markup on both sides, no hydration mismatch), then
 * switches to the visitor's clock and refreshes every minute (docs/ASSUMPTIONS.md A19).
 */
export function RelativeTime({ iso, serverNow }: { iso: string; serverNow: number }) {
  const format = useFormatter();
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <time dateTime={iso} className="tabular">
      {format.relativeTime(new Date(iso), { now, style: "narrow" })}
    </time>
  );
}
