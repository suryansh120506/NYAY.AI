"use client";

import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/Skeleton";
import { getWalletClient } from "@/lib/api/wallet";
import type { WalletTxn } from "@/lib/api/types";
import { limits } from "@/lib/config";
import { formatPaise } from "@/lib/money";
import { cx } from "@/lib/text";
import { TopUpPanel } from "./TopUpPanel";

/** Balance, top-up and itemised history. Closed-loop: no withdrawal to a bank account (brief §0). */
export function WalletView() {
  const t = useTranslations("Wallet");
  const nav = useTranslations("Nav");
  const { ready, session, requireAuth } = useAuth();
  const signedIn = ready && session !== null;

  const wallet = useQuery({
    queryKey: ["wallet"],
    queryFn: () => getWalletClient().get(),
    enabled: signedIn,
  });
  const history = useQuery({
    queryKey: ["wallet", "history"],
    queryFn: () => getWalletClient().history(),
    enabled: signedIn,
  });

  return (
    <div className="mx-auto max-w-prose px-4 pt-8 pb-section-sm md:pt-12">
      <h1 className="text-display font-semibold text-ink">{t("title")}</h1>

      {ready && !session ? (
        <div className="mt-8 rounded-card border border-hairline bg-surface p-6 text-center">
          <p className="text-body text-ink">{t("signInPrompt")}</p>
          <Button size="lg" className="mt-5" onClick={() => void requireAuth("wallet")}>
            {nav("signIn")}
          </Button>
        </div>
      ) : (
        <>
          <section
            aria-labelledby="balance-title"
            className="mt-8 rounded-card border border-hairline bg-surface p-6"
          >
            <h2 id="balance-title" className="text-callout text-ink-2">
              {t("balance")}
            </h2>
            {wallet.data ? (
              <>
                <p
                  className="mt-1 text-figure font-semibold text-ink tabular"
                  data-testid="wallet-balance"
                >
                  {formatPaise(wallet.data.available_paise)}
                </p>
                {wallet.data.held_paise > 0 ? (
                  <p className="mt-2 text-callout text-ink-2">
                    {t("held", { amount: formatPaise(wallet.data.held_paise) })}
                  </p>
                ) : null}
                {wallet.data.bonus_paise > 0 ? (
                  <p className="mt-1 text-callout text-ink-2">
                    {t("bonus", { amount: formatPaise(wallet.data.bonus_paise) })}
                  </p>
                ) : null}
              </>
            ) : (
              <div aria-busy="true">
                <Skeleton className="mt-2 h-11 w-48" />
                <Skeleton className="mt-3 h-4 w-56" />
              </div>
            )}
          </section>

          <section aria-labelledby="topup-title" className="mt-10">
            <h2 id="topup-title" className="text-headline font-semibold text-ink">
              {t("addMoney")}
            </h2>
            <div className="mt-4">
              <TopUpPanel
                amounts={limits.walletTopupChipsPaise}
                defaultAmount={limits.walletTopupChipsPaise[1]}
                allowCustom
                copy="Wallet"
              />
            </div>
            <p className="mt-4 flex items-start gap-2 text-caption text-ink-2">
              <Icon name="lock" size={16} className="mt-px shrink-0" />
              <span>{t("closedLoop")}</span>
            </p>
          </section>

          <section aria-labelledby="activity-title" className="mt-12">
            <h2 id="activity-title" className="text-headline font-semibold text-ink">
              {t("activity")}
            </h2>
            {history.data ? (
              history.data.length === 0 ? (
                <p className="mt-4 text-callout text-ink-2">{t("empty")}</p>
              ) : (
                <ul className="mt-4 rounded-card border border-hairline bg-surface px-5">
                  {history.data.map((txn) => (
                    <TxnRow key={txn.id} txn={txn} />
                  ))}
                </ul>
              )
            ) : (
              <div
                className="mt-4 rounded-card border border-hairline bg-surface px-5"
                aria-busy="true"
              >
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-4"
                    aria-hidden="true"
                  >
                    <div>
                      <Skeleton className="h-4 w-44" />
                      <Skeleton className="mt-2 h-3 w-24" />
                    </div>
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function TxnRow({ txn }: { txn: WalletTxn }) {
  const t = useTranslations("Wallet");
  const format = useFormatter();
  const title =
    txn.kind === "consultation"
      ? t("txn_consultation", { name: txn.advocate_name ?? "" })
      : txn.kind === "release"
        ? t("txn_release")
        : txn.kind === "bonus_grant"
          ? t("txn_bonus_grant")
          : txn.kind === "bonus_expiry"
            ? t("txn_bonus_expiry")
            : txn.kind === "refund"
              ? t("txn_refund")
              : t("txn_topup");
  const detail = [
    format.dateTime(new Date(txn.created_at), {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }),
    txn.minutes ? t("txn_consultation_detail", { count: txn.minutes }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const credit = txn.amount_paise > 0;

  return (
    <li className="flex items-center justify-between gap-4 border-b border-hairline py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-callout font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-caption text-ink-2 tabular">{detail}</p>
      </div>
      <p
        className={cx("shrink-0 text-callout font-medium tabular", credit ? "text-ok" : "text-ink")}
      >
        {formatPaise(txn.amount_paise, { signed: true })}
      </p>
    </li>
  );
}
