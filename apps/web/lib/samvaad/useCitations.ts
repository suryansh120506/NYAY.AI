"use client";

import { useMemo } from "react";
import { collectCitations, type Citation } from "@/lib/legal/citations";
import { useRoomStore } from "./store";

/** Citations for the open conversation: every section of law mentioned by either side, newest mention first. */
export function useCitations(): Citation[] {
  const items = useRoomStore((state) => state.items);
  return useMemo(
    () =>
      collectCitations(
        items.flatMap((item) =>
          item.kind === "message"
            ? [{ from: item.from, text: item.text, ts: item.ts, seq: item.seq }]
            : [],
        ),
      ),
    [items],
  );
}
