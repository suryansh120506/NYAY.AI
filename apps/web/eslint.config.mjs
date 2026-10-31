import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

// Punctuation that may appear as literal JSX text. Every word goes through next-intl.
const allowedStrings = [
  "·",
  "•",
  "–",
  "—",
  "/",
  "+",
  "−",
  "×",
  "=",
  "₹",
  ":",
  "%",
  "(",
  ")",
  "…",
  "|",
  "→",
];

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "lib/api/generated/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react/jsx-no-literals": ["error", { noStrings: true, ignoreProps: true, allowedStrings }],
      "no-console": ["error", { allow: ["warn", "error", "info"] }],
    },
  },
  {
    files: [
      "tests/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      "*.config.ts",
      "*.config.mts",
      "*.config.mjs",
      "scripts/**",
    ],
    rules: { "react/jsx-no-literals": "off", "no-console": "off" },
  },
];

export default config;
