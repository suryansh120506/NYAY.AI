import type { AuthSession } from "./types";

/**
 * The signed-in user, shared between the real HTTP auth client and the parts of the app that are still mocked
 * (the Samvaad room until Phase 3). Kept dependency-free so mocks don't pull in the HTTP layer.
 */
let current: AuthSession | null = null;

export function getBridgedSession(): AuthSession | null {
  return current;
}

export function setBridgedSession(session: AuthSession | null): void {
  current = session;
}
