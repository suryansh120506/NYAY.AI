"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { TopUpPanel } from "@/components/wallet/TopUpPanel";
import { getSessionCheckout, getSessionWalletClient } from "@/lib/api/samvaad";
import { limits } from "@/lib/config";
import { formatPaise } from "@/lib/money";
import { displayRemainingSeconds } from "@/lib/samvaad/reducer";
import { useRoomStore } from "@/lib/samvaad/store";
import { useNow } from "@/lib/samvaad/useNow";

/**
 * Opens on `session.warning`. Top up with UPI without leaving the room or dropping the socket; dismissing it does
 * not stop the clock (brief §3.3). The new balance arrives as a server tick, never as a local calculation.
 */
export function LowBalanceSheet({ onEnd }: { onEnd: () => void }) {
  const t = useTranslations("Samvaad");
  const open = useRoomStore((s) => s.lowBalanceOpen);
  const setOpen = useRoomStore((s) => s.setLowBalanceOpen);
  const balance = useRoomStore((s) => s.balancePaise);
  const remainingSeconds = useRoomStore((s) => s.remainingSeconds);
  const tickAt = useRoomStore((s) => s.tickAt);
  const clockRate = useRoomStore((s) => s.clockRate);
  const now = useNow(open);
  const remaining = displayRemainingSeconds({ remainingSeconds, tickAt, clockRate }, now) ?? 0;

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title={t("lowBalanceTitle")}
      description={t("lowBalanceBody", {
        minutes: Math.max(1, Math.floor(remaining / 60)),
        amount: formatPaise(balance ?? 0, { trimZeroPaise: true }),
      })}
      testId="low-balance-sheet"
    >
      <TopUpPanel
        amounts={limits.topupChipsPaise}
        defaultAmount={limits.topupChipsPaise[1]}
        onPaid={() => setOpen(false)}
        clients={{ wallet: getSessionWalletClient(), checkout: getSessionCheckout() }}
      />
      <Button variant="danger" fullWidth className="mt-2" onClick={onEnd}>
        {t("endSession")}
      </Button>
    </Sheet>
  );
}
