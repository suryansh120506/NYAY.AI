"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { bareInputClasses, FieldError, fieldClasses } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import type { PaymentCheckout, WalletClient } from "@/lib/api/clients";
import { getCheckout, getWalletClient } from "@/lib/api/wallet";
import { limits } from "@/lib/config";
import { formatPaise, parseRupeesInput, type Paise } from "@/lib/money";

interface TopUpPanelProps {
  amounts: readonly Paise[];
  defaultAmount?: Paise;
  allowCustom?: boolean;
  onPaid?: (amount: Paise) => void;
  /** Label key namespace: the room uses Samvaad copy, the wallet page uses Wallet copy. */
  copy?: "Samvaad" | "Wallet";
  /** Which wallet to charge. Defaults to the account wallet; the consultation room passes its own. */
  clients?: { wallet: WalletClient; checkout: PaymentCheckout };
}

/**
 * Amount chips + one "Add ₹X with UPI" button. Opens the provider checkout (Razorpay in production) and never
 * navigates away, so it works inside a live consultation without dropping the socket (brief §3.3 LowBalanceSheet).
 * Money moves only when the provider confirms; the wallet is closed-loop (brief §0).
 */
export function TopUpPanel({
  amounts,
  defaultAmount,
  allowCustom = false,
  onPaid,
  copy = "Samvaad",
  clients,
}: TopUpPanelProps) {
  const t = useTranslations(copy);
  const wallet = useTranslations("Wallet");
  const toast = useToast();
  const queryClient = useQueryClient();
  const customId = useId();
  const errorId = useId();
  const [selected, setSelected] = useState<Paise | "custom">(
    defaultAmount ?? amounts[1] ?? amounts[0] ?? limits.minTopupPaise,
  );
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customPaise = parseRupeesInput(custom);
  const amount: Paise | null = selected === "custom" ? customPaise : selected;
  const tooSmall = amount !== null && amount < limits.minTopupPaise;

  async function pay() {
    if (amount === null || tooSmall) {
      setError(
        wallet("minTopup", { amount: formatPaise(limits.minTopupPaise, { trimZeroPaise: true }) }),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const order = await (clients?.wallet ?? getWalletClient()).createTopup(amount);
      const result = await (clients?.checkout ?? getCheckout()).open(order);
      if (result === "paid") {
        toast.show(
          t(copy === "Samvaad" ? "paymentAdded" : "added", {
            amount: formatPaise(amount, { trimZeroPaise: true }),
          }),
          "success",
        );
        await queryClient.invalidateQueries({ queryKey: ["wallet"] });
        onPaid?.(amount);
      } else if (result === "failed") {
        setError(t(copy === "Samvaad" ? "paymentFailed" : "failed"));
      }
    } catch {
      setError(t(copy === "Samvaad" ? "paymentFailed" : "failed"));
    } finally {
      setBusy(false);
    }
  }

  const label = amount !== null && !tooSmall ? formatPaise(amount, { trimZeroPaise: true }) : "";

  return (
    <div>
      <div
        role="group"
        aria-label={t(copy === "Samvaad" ? "addAmountLabel" : "amountLabel")}
        className="flex flex-wrap gap-2"
      >
        {amounts.map((value) => (
          <Chip
            key={value}
            selected={selected === value}
            onClick={() => setSelected(value)}
            disabled={busy}
            className="tabular"
          >
            +{formatPaise(value, { trimZeroPaise: true })}
          </Chip>
        ))}
        {allowCustom ? (
          <Chip
            selected={selected === "custom"}
            onClick={() => setSelected("custom")}
            disabled={busy}
          >
            {wallet("other")}
          </Chip>
        ) : null}
      </div>

      {allowCustom && selected === "custom" ? (
        <div className={`${fieldClasses} mt-4`}>
          <span className="pl-4 text-body text-ink-2" aria-hidden="true">
            {"₹"}
          </span>
          <input
            id={customId}
            inputMode="decimal"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              setError(null);
            }}
            aria-label={wallet("customLabel")}
            aria-describedby={error ? errorId : undefined}
            className={`${bareInputClasses} pl-2 tabular`}
            autoFocus
          />
        </div>
      ) : null}

      {error ? <FieldError id={errorId}>{error}</FieldError> : null}

      <Button
        size="lg"
        fullWidth
        className="mt-6"
        onClick={() => void pay()}
        disabled={busy || amount === null}
      >
        {busy ? t("confirmingPayment") : t("addWithUpi", { amount: label })}
      </Button>
    </div>
  );
}
