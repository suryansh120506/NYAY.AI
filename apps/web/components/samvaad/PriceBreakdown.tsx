import { useTranslations } from "next-intl";
import { formatPaise, perMinuteCost, type PerMinuteRates } from "@/lib/money";
import { cx } from "@/lib/text";

/**
 * Two disclosed lines plus GST, shown before the session starts (brief §0: no fee sharing; the advocate's rate goes
 * to the advocate in full, the platform fee and GST to Nyay.ai, as separate ledger accounts).
 */
export function PriceBreakdown({
  rates,
  gstRateBps,
}: {
  rates: PerMinuteRates;
  gstRateBps: number;
}) {
  const t = useTranslations("Samvaad");
  const common = useTranslations("Common");
  const perMinute = (paise: number) => common("perMinute", { amount: formatPaise(paise) });
  const rows = [
    { label: t("advocateRate"), value: perMinute(rates.adv_rate_paise) },
    { label: t("platformFee"), value: perMinute(rates.plat_rate_paise) },
    {
      label: t("gst", { rate: (gstRateBps / 100).toString() }),
      value: perMinute(rates.gst_rate_paise),
    },
  ];
  return (
    <section aria-labelledby="price-title">
      <h2 id="price-title" className="text-callout font-semibold text-ink">
        {t("priceTitle")}
      </h2>
      <dl className="mt-3 rounded-card border border-hairline bg-surface px-5">
        {rows.map((row) => (
          <Row key={row.label} label={row.label} value={row.value} />
        ))}
        <Row label={t("total")} value={perMinute(perMinuteCost(rates))} strong />
      </dl>
      <p className="mt-2 text-caption text-ink-2">{t("feeNote")}</p>
    </section>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-hairline py-3 last:border-b-0">
      <dt className={cx("text-callout", strong ? "font-semibold text-ink" : "text-ink-2")}>
        {label}
      </dt>
      <dd className={cx("text-callout tabular", strong ? "font-semibold text-ink" : "text-ink")}>
        {value}
      </dd>
    </div>
  );
}
