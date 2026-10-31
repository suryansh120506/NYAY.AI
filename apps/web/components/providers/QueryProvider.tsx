"use client";

import { QueryClient, QueryClientContext, QueryClientProvider } from "@tanstack/react-query";
import { useContext, useState, type ReactNode } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
          mutations: { retry: 0 },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** For code-split UI (e.g. the Saransh sheet opened from the home page) that may render outside a QueryProvider. */
export function EnsureQueryClient({ children }: { children: ReactNode }) {
  const existing = useContext(QueryClientContext);
  return existing ? <>{children}</> : <QueryProvider>{children}</QueryProvider>;
}
