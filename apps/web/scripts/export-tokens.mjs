#!/usr/bin/env node
// Exports the design tokens in app/globals.css to the W3C Design Tokens (DTCG) format, so Figma variables (via a
// plugin such as Tokens Studio) and code share one source of truth. Run: pnpm tokens:export
// Output: design/tokens.json at the repository root. The CSS stays the source; this file is generated, never edited.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "app", "globals.css"), "utf8");
const out = join(here, "..", "..", "..", "design", "tokens.json");

/** Declarations inside a block that starts at `start` (matching braces). */
function block(start) {
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", start) + 1, i);
  }
  return "";
}

function declarations(body) {
  const tokens = {};
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gi)) {
    const [, name, raw] = match;
    if (raw.trim() === "initial" || name.endsWith("*")) continue;
    tokens[name] = raw.replace(/\s+/g, " ").trim();
  }
  return tokens;
}

const TYPES = [
  [/^color-/, "color"],
  [/^shadow-/, "shadow"],
  [/^radius-/, "dimension"],
  [/^text-[a-z]+--line-height$/, "number"],
  [/^text-[a-z]+--letter-spacing$/, "dimension"],
  [/^text-[a-z]+--font-weight$/, "fontWeight"],
  [/^text-/, "dimension"],
  [/^container-|^spacing-/, "dimension"],
  [/^ease-/, "cubicBezier"],
];
const typeOf = (name) => TYPES.find(([rx]) => rx.test(name))?.[1] ?? "other";

function group(tokens) {
  const tree = {};
  for (const [name, value] of Object.entries(tokens)) {
    const [head, ...rest] = name.replace("--", "-").split("-");
    const node = (tree[head] ??= {});
    node[rest.join("-") || "default"] = { $value: value, $type: typeOf(name) };
  }
  return tree;
}

const theme = {};
for (const match of css.matchAll(/@theme(?:\s+static)?\s*\{/g))
  Object.assign(theme, declarations(block(match.index)));
const nightStart = css.indexOf('[data-theme="night"] {');
const night = nightStart >= 0 ? declarations(block(nightStart)) : {};

const document = {
  $description:
    "Nyay.ai design tokens, generated from apps/web/app/globals.css. Do not edit by hand.",
  light: group(theme),
  night: group(night),
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
console.log(
  `tokens: ${Object.keys(theme).length} base, ${Object.keys(night).length} night -> ${out}`,
);
