// Public runtime configuration. NEXT_PUBLIC_* values must be referenced literally so Next.js can inline them.

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS !== "false";
const mockMinuteMs = Number(process.env.NEXT_PUBLIC_MOCK_MINUTE_MS || "15000");

export const publicConfig = {
  /** Every data source uses its offline fixture/mock implementation (Phase 1 default). */
  useMocks,
  /** Mock only: length of one billed minute in the demo (docs/ASSUMPTIONS.md A23). */
  mockMinuteMs: Number.isFinite(mockMinuteMs) && mockMinuteMs >= 500 ? mockMinuteMs : 15_000,
  /** Absolute origin for canonical and hreflang URLs. `||`, not `??`: an empty value (a blank build arg) falls back too. */
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  apiUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8100",
  wsUrl: process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8100",
} as const;

export const limits = {
  minTopupPaise: 10_000,
  topupChipsPaise: [10_000, 20_000, 50_000] as const,
  walletTopupChipsPaise: [10_000, 20_000, 50_000, 100_000] as const,
  /** A session can only be reserved with at least this many minutes of balance (brief §1.3). */
  reserveMinutes: 5,
  saranshMaxBytes: 10 * 1024 * 1024,
  saranshMaxPages: 8,
  saranshMimeTypes: ["application/pdf", "image/jpeg", "image/png"] as const,
  messageMaxLength: 4_000,
  queryMaxLength: 2_000,
} as const;
