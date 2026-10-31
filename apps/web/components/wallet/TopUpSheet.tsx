"use client";

import type { ReactNode } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { getSessionCheckout, getSessionWalletClient } from "@/lib/api/samvaad";
import { limits } from "@/lib/config";
import type { Paise } from "@/lib/money";
import { TopUpPanel } from "./TopUpPanel";

/** Add money without leaving the page (used when a balance is too low to start a consultation). */
export function TopUpSheet({
  open,
  onClose,
  title,
  description,
  defaultAmount,
  onPaid,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description: ReactNode;
  defaultAmount?: Paise;
  onPaid: (amount: Paise) => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      testId="topup-sheet"
    >
      <TopUpPanel
        amounts={limits.topupChipsPaise}
        defaultAmount={defaultAmount}
        onPaid={onPaid}
        clients={{ wallet: getSessionWalletClient(), checkout: getSessionCheckout() }}
      />
    </Sheet>
  );
}
