import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// One `.env` at the repository root configures both the API and the web app (resolved relative to this file, so
// it works wherever the repo is unpacked). Real environment variables still take precedence.
// forceReload: Next has already loaded (and cached) apps/web/.env*, which would otherwise make this call a no-op.
loadEnvConfig(
  path.resolve(__dirname, "../.."),
  process.env.NODE_ENV !== "production",
  undefined,
  true,
);

const withNextIntl = createNextIntlPlugin({
  requestConfig: "./lib/i18n/request.ts",
  experimental: {
    // ICU messages are compiled at build time, so the ICU parser never ships to the browser (home JS budget, §3.5).
    messages: { format: "json", path: "./messages", locales: "infer", precompile: true },
  },
});

const isDev = process.env.NODE_ENV !== "production";
const origin = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
};
const apiOrigin = origin(process.env.NEXT_PUBLIC_API_URL);
const wsOrigin = origin(process.env.NEXT_PUBLIC_WS_URL?.replace(/^ws/, "http")).replace(
  /^http/,
  "ws",
);

// Brief §1.4 hardening. Next.js inlines small bootstrap scripts, so script-src needs 'unsafe-inline' until a
// nonce middleware is added (TODO(human): nonce-based CSP). Razorpay Checkout is the only third-party script.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://checkout.razorpay.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${apiOrigin} ${wsOrigin} https://api.razorpay.com https://lumberjack.razorpay.com`.trim(),
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com")',
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The Docker image (apps/web/Dockerfile) sets NEXT_OUTPUT=standalone for a self-contained server bundle;
  // `next start` locally and in CI is unchanged.
  ...(process.env.NEXT_OUTPUT === "standalone"
    ? { output: "standalone" as const, outputFileTracingRoot: path.resolve(__dirname, "../..") }
    : {}),
  async redirects() {
    return [
      { source: "/:locale(en|hi)/legal/terms", destination: "/:locale/terms", permanent: true },
      { source: "/:locale(en|hi)/legal/privacy", destination: "/:locale/privacy", permanent: true },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    // Tailwind output is small; inlining it removes the render-blocking CSS requests in front of the hero (LCP).
    inlineCss: true,
    // React Compiler: memoises components and hooks automatically (no hand-written useMemo/useCallback needed).
    reactCompiler: true,
  },
};

export default withNextIntl(nextConfig);
