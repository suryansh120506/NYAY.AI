const DEVANAGARI = /[ऀ-ॿ]/;

/** BCP 47 tag for user-typed text so Devanagari gets correct shaping and line-height (brief §3.2: lang auto-set). */
export function detectLang(text: string, fallback: "en" | "hi"): "en" | "hi" {
  if (text.trim() === "") return fallback;
  return DEVANAGARI.test(text) ? "hi" : "en";
}

export function initials(name: string): string {
  const parts = name
    .replace(/^(Demo|Adv\.?|Advocate)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/** "+919876541234" → "+91••••••1234" (brief rule 6: never show or log phone numbers in full). */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const last4 = digits.slice(-4);
  return `+91••••••${last4}`;
}

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
