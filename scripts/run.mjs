#!/usr/bin/env node
// Cross-platform helper: run a command with extra env vars (Windows shells can't do `VAR=x cmd`).
//   node scripts/run.mjs NEXT_PUBLIC_USE_MOCKS=true -- pnpm --filter @nyay/web build
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const split = args.indexOf("--");
if (split < 1) {
  console.error("usage: node scripts/run.mjs KEY=VALUE [KEY=VALUE...] -- command [args...]");
  process.exit(2);
}
const env = { ...process.env };
for (const pair of args.slice(0, split)) {
  const eq = pair.indexOf("=");
  env[pair.slice(0, eq)] = pair.slice(eq + 1);
}
const [command, ...rest] = args.slice(split + 1);
const child = spawn(command, rest, { stdio: "inherit", env, shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 1));
