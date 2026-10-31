"use client";

import dynamic from "next/dynamic";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getAuthClient } from "@/lib/api/auth";
import type { AuthSession } from "@/lib/api/types";

export type AuthReason = "connect" | "attach" | "wallet" | "generic";

interface AuthContextValue {
  session: AuthSession | null;
  /** False until the stored session has been read on the client (avoids a hydration flash). */
  ready: boolean;
  /** Progressive authentication (brief §1.4): resolves true once signed in, false if the person backs out. */
  requireAuth: (reason?: AuthReason) => Promise<boolean>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Loaded only when someone actually needs to sign in.
const OtpSheet = dynamic(() => import("./OtpSheet").then((m) => m.OtpSheet), { ssr: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; reason: AuthReason; loaded: boolean }>({
    open: false,
    reason: "generic",
    loaded: false,
  });
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAuthClient()
      .restore()
      .catch(() => null)
      .then((restored) => {
        if (cancelled) return;
        setSession(restored);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
  }, []);

  const requireAuth = useCallback(
    (reason: AuthReason = "generic") => {
      const current = getAuthClient().current();
      if (current) {
        setSession(current);
        return Promise.resolve(true);
      }
      settle(false);
      setSheet({ open: true, reason, loaded: true });
      return new Promise<boolean>((resolve) => {
        resolver.current = resolve;
      });
    },
    [settle],
  );

  const signOut = useCallback(async () => {
    await getAuthClient().logout();
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ session, ready, requireAuth, signOut }),
    [session, ready, requireAuth, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {sheet.loaded ? (
        <OtpSheet
          open={sheet.open}
          reason={sheet.reason}
          onSuccess={(next) => {
            setSession(next);
            setSheet((s) => ({ ...s, open: false }));
            settle(true);
          }}
          onClose={() => {
            setSheet((s) => ({ ...s, open: false }));
            settle(false);
          }}
        />
      ) : null}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
