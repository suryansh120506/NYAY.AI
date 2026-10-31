#!/usr/bin/env node
// `make dev` / `pnpm dev:all`: API (uvicorn --reload), background worker (scheduler) and the web app, in one terminal.
// Everything is configured by the repo-root .env. Ctrl+C stops all three.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(join(root, ".env"))) {
  console.error(
    "No .env found. Copy .env.example to .env and fill it in (see README → Configuration).",
  );
  process.exit(2);
}

const port = process.env.API_PORT ?? "8100";
const shell = process.platform === "win32";
const procs = [
  [
    "api",
    "uv",
    ["run", "uvicorn", "app.main:app", "--reload", "--port", port],
    join(root, "services", "api"),
  ],
  ["worker", "uv", ["run", "python", "-m", "app.workers.scheduler"], join(root, "services", "api")],
  ["web", "pnpm", ["--filter", "@nyay/web", "dev"], root],
].map(([name, cmd, args, cwd]) => {
  const child = spawn(cmd, args, { cwd, shell, env: process.env });
  const tag = `[${name}]`.padEnd(9);
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) =>
      chunk
        .toString()
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => console.log(`${tag}${line}`)),
    );
  }
  child.on("exit", (code) => console.log(`${tag}exited (${code ?? "signal"})`));
  return child;
});

const stop = () => {
  procs.forEach((p) => p.kill());
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
