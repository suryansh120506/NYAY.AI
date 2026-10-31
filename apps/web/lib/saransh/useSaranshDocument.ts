"use client";

import { useQuery } from "@tanstack/react-query";
import { getSaranshClient } from "@/lib/api/saransh";

/** Polls a document until it is ready or failed (the arq job runs in the background, brief §1.3 Saransh). */
export function useSaranshDocument(documentId: string | null) {
  return useQuery({
    queryKey: ["saransh", documentId],
    queryFn: () => getSaranshClient().get(documentId ?? ""),
    enabled: documentId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "ready" || status === "failed" ? false : 1_000;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export const LOW_CONFIDENCE = 0.6;
