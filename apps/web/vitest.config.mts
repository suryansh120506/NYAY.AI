import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
    css: false,
    restoreMocks: true,
    // next-intl imports "next/navigation" without an extension; let Vite resolve it instead of Node's ESM loader.
    server: { deps: { inline: ["next-intl"] } },
  },
});
