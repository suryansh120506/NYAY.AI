import type { ReactNode } from "react";
import { QueryProvider } from "@/components/providers/QueryProvider";

// Interactive routes (Parakh, Samvaad, Wallet) get TanStack Query; the marketing home page stays lean.
export default function AppRoutesLayout({ children }: { children: ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
