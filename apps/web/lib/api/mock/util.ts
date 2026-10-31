export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Simulated network latency so skeletons and optimistic states are exercised in the demo. */
export const latency = (min = 250, max = 700) => sleep(min + Math.random() * (max - min));

export function uid(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

export { safeStorage } from "@/lib/storage";

export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
