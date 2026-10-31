"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { bareInputClasses, FieldError, FieldLabel, fieldClasses } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { getAuthClient } from "@/lib/api/auth";
import { ApiError, type AuthSession } from "@/lib/api/types";
import { publicConfig } from "@/lib/config";
import { Link } from "@/lib/i18n/navigation";
import { maskPhone } from "@/lib/text";
import type { AuthReason } from "./AuthProvider";

interface OtpSheetProps {
  open: boolean;
  reason: AuthReason;
  onSuccess: (session: AuthSession) => void;
  onClose: () => void;
}

const TITLE_KEY = {
  connect: "titleConnect",
  attach: "titleAttach",
  wallet: "titleWallet",
  generic: "title",
} as const;

/** Phone OTP sign-in in a bottom sheet (brief §3.2: appears only when the user taps Connect or Attach). */
export function OtpSheet({ open, reason, onSuccess, onClose }: OtpSheetProps) {
  const t = useTranslations("Auth");
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t(TITLE_KEY[reason])}
      description={t("body")}
      testId="otp-sheet"
    >
      {open ? <OtpForm onSuccess={onSuccess} /> : null}
    </Sheet>
  );
}

function OtpForm({ onSuccess }: { onSuccess: (session: AuthSession) => void }) {
  const t = useTranslations("Auth");
  const phoneId = useId();
  const codeId = useId();
  const errorId = useId();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [digits, setDigits] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  const phoneE164 = `+91${digits}`;
  const validPhone = /^[6-9]\d{9}$/.test(digits);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((s) => s - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    if (!validPhone) {
      setError(t("invalidPhone"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await getAuthClient().requestOtp(phoneE164);
      setResendIn(result.resend_after_seconds);
      setStep("code");
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "invalid_phone"
          ? t("invalidPhone")
          : t("requestFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(value = code) {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      onSuccess(await getAuthClient().verifyOtp(phoneE164, value));
    } catch {
      setError(t("invalidCode"));
      setCode("");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  if (step === "phone") {
    return (
      <form onSubmit={requestCode} noValidate>
        <FieldLabel htmlFor={phoneId}>{t("phoneLabel")}</FieldLabel>
        <div className={fieldClasses}>
          <span className="pl-4 text-body text-ink-2 tabular" aria-hidden="true">
            {t("phonePrefix")}
          </span>
          <input
            id={phoneId}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={10}
            value={digits}
            onChange={(e) => {
              setDigits(e.target.value.replace(/\D/g, "").slice(0, 10));
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={`${bareInputClasses} pl-2 tabular`}
            data-autofocus
          />
        </div>
        {error ? <FieldError id={errorId}>{error}</FieldError> : null}
        <Button
          type="submit"
          size="lg"
          fullWidth
          className="mt-6"
          disabled={busy || digits.length < 10}
        >
          {busy ? t("sending") : t("sendCode")}
        </Button>
        <Consent />
      </form>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void verify();
      }}
      noValidate
    >
      <p className="mb-4 text-callout text-ink-2">
        {t("codeSent", { phone: maskPhone(phoneE164) })}
      </p>
      <FieldLabel htmlFor={codeId}>{t("codeLabel")}</FieldLabel>
      <div className={fieldClasses}>
        <input
          ref={codeRef}
          id={codeId}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(next);
            setError(null);
            if (next.length === 6) void verify(next);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`${bareInputClasses} text-headline tracking-[0.4em] tabular`}
        />
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
      {publicConfig.useMocks ? (
        <p className="mt-3 text-caption text-ink-2">{t("demoHint")}</p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        fullWidth
        className="mt-6"
        disabled={busy || code.length !== 6}
      >
        {busy ? t("verifying") : t("verify")}
      </Button>
      <div className="mt-3 flex items-center justify-between">
        <Button
          variant="text"
          onClick={() => {
            setStep("phone");
            setCode("");
            setError(null);
          }}
        >
          {t("changeNumber")}
        </Button>
        <Button variant="text" disabled={resendIn > 0 || busy} onClick={() => void requestCode()}>
          <span className="tabular">
            {resendIn > 0 ? t("resendIn", { seconds: resendIn }) : t("resend")}
          </span>
        </Button>
      </div>
    </form>
  );
}

function Consent() {
  const t = useTranslations("Auth");
  return (
    <p className="mt-4 text-center text-caption text-ink-2">
      {t.rich("consent", {
        terms: (chunks) => (
          <Link href="/terms" className="text-trust underline-offset-2 hover:underline">
            {chunks}
          </Link>
        ),
        privacy: (chunks) => (
          <Link href="/privacy" className="text-trust underline-offset-2 hover:underline">
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}
