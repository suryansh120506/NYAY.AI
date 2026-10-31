import type { AuthClient } from "@/lib/api/clients";
import { ApiError, type AuthSession, type OtpRequestResult } from "@/lib/api/types";
import { maskPhone } from "@/lib/text";
import { db, mutate } from "./db";
import { getBridgedSession } from "@/lib/api/session-bridge";
import { DEMO_STARTING_BALANCE_PAISE } from "./constants";
import { latency } from "./util";

const PHONE = /^\+91[6-9]\d{9}$/;
/** The fake OTP provider accepts only this code (brief §1.4, dev only). */
const DEMO_CODE = "000000";
/** Numbers ending in 9999 sign in as a premium demo user so the premium Parakh tier can be seen. */
const PREMIUM_SUFFIX = "9999";

function userIdFor(phone: string): string {
  let hash = 0;
  for (const char of phone) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `user_${hash.toString(16).padStart(8, "0")}`;
}

export function ensureMockUser(userId: string, isPremium: boolean): void {
  mutate((s) => {
    if (s.users[userId]) return;
    s.users[userId] = {
      id: userId,
      is_premium: isPremium,
      wallet: { available_paise: DEMO_STARTING_BALANCE_PAISE, held_paise: 0, bonus_paise: 0 },
      history: [
        {
          id: `txn_seed_${userId}`,
          kind: "topup",
          amount_paise: DEMO_STARTING_BALANCE_PAISE,
          created_at: new Date(Date.now() - 86_400_000).toISOString(),
          advocate_name: null,
          minutes: null,
        },
      ],
      uploads: { day: "", count: 0 },
    };
  });
}

export class MockAuthClient implements AuthClient {
  async requestOtp(phoneE164: string): Promise<OtpRequestResult> {
    await latency(400, 800);
    if (!PHONE.test(phoneE164)) throw new ApiError("invalid_phone", 422);
    return { resend_after_seconds: 30 };
  }

  async verifyOtp(phoneE164: string, code: string): Promise<AuthSession> {
    await latency(400, 800);
    if (!PHONE.test(phoneE164)) throw new ApiError("invalid_phone", 422);
    if (code !== DEMO_CODE) throw new ApiError("invalid_otp", 401);
    const userId = userIdFor(phoneE164);
    const isPremium = phoneE164.endsWith(PREMIUM_SUFFIX);
    ensureMockUser(userId, isPremium);
    const session: AuthSession = {
      user: {
        id: userId,
        phone_masked: maskPhone(phoneE164),
        display_name: null,
        role: "user",
        preferred_lang: "en",
        is_premium: isPremium,
      },
      access_token: `mock.${userId}`,
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
    mutate((s) => {
      s.auth = session;
    });
    return session;
  }

  current(): AuthSession | null {
    return db().auth;
  }

  async restore(): Promise<AuthSession | null> {
    return db().auth;
  }

  async logout(): Promise<void> {
    mutate((s) => {
      s.auth = null;
    });
  }
}

export function requireMockUserId(): string {
  const auth = db().auth ?? getBridgedSession();
  if (!auth) throw new ApiError("unauthorized", 401);
  ensureMockUser(auth.user.id, auth.user.is_premium);
  return auth.user.id;
}
