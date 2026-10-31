import { gstOnFee } from "@/lib/money";

/** TODO(human): platform fee and GST treatment need finance/legal sign-off (docs/ASSUMPTIONS.md A20, A21). */
export const PLATFORM_FEE_PAISE = 500;
export const GST_RATE_BPS = 1_800;
export const GST_ON_PLATFORM_FEE_PAISE = gstOnFee(PLATFORM_FEE_PAISE, GST_RATE_BPS);
/** Maximum moved into a session hold at once (brief §1.3 RESERVE_CAP_PAISE). TODO(human): confirm. */
export const RESERVE_CAP_PAISE = 200_000;
export const DEMO_STARTING_BALANCE_PAISE = 25_000;
export const SARANSH_DAILY_CAP = 5;
export const RESERVATION_TTL_MS = 10 * 60_000;
