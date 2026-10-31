"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { CommandPalette } from "@/components/command/CommandPalette";
import { ToastProvider } from "@/components/ui/Toast";
import { ViewTransitionProvider } from "@/lib/navigation/view-transition";

/** Global, deliberately light providers. TanStack Query is added per route so the home page stays small. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <ViewTransitionProvider>
          {children}
          <CommandPalette />
        </ViewTransitionProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
