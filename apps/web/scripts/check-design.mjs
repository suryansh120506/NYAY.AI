#!/usr/bin/env node
// Design and regulatory guardrails as code (docs/ASSUMPTIONS.md A10). Runs as part of `pnpm lint`.
//  1. No colour literals outside app/globals.css: every colour must come from the brief §3.1 tokens.
//  2. No Tailwind default-palette classes (the palette is cleared, so they would silently do nothing).
//  3. No spinners anywhere (brief §3.1: skeletons only).
//  4. No promotional ranking claims in user-facing copy (brief §0, regulatory guardrails).
//  5. Praman never reaches the frontend (brief §1.3: never exposed in any user-facing UI).
//  6. Route-level loading.tsx never imports next-intl: Next renders it before the locale is set (ASSUMPTIONS A29).
//  7. Authenticity sweep: flat colour (no gradients), no pill or fully round controls, still pages (no animation
//     libraries, entrance animations, smooth scrolling or custom cursors), no emoji, no em dashes, no hype words,
//     no invented social proof, and no text that mentions how the app was built.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const CODE_DIRS = ["app", "components", "lib"];
const COPY_DIRS = ["messages", "fixtures"];
const TOKEN_FILE = join("app", "globals.css");

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "fonts" ? [] : walk(full);
    return [full];
  });

const files = (dirs, exts) =>
  dirs
    .map((d) => join(root, d))
    .flatMap((d) => {
      try {
        return walk(d);
      } catch {
        return [];
      }
    })
    .filter((f) => exts.some((e) => f.endsWith(e)));

const COLOUR_LITERAL =
  /(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/;
const DEFAULT_PALETTE =
  /\b(?:bg|text|border|fill|stroke|ring|outline|from|to|via|shadow|decoration|divide|placeholder|caret|accent)-(?:white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|violet|purple|fuchsia|pink|rose|indigo-\d{2,3})\b/;
const SPINNER = /animate-spin|\bspinner\b|\bloader\b|ActivityIndicator|CircularProgress/i;
const PRAMAN = /praman|प्रमाण|trust\s?score/i;

// --- authenticity sweep ---------------------------------------------------------------------------------------
const GRADIENT = /gradient/i;
// Gradients are allowed only where generated artwork and data-screen backdrops are made: the tokens file and the
// news mesh. Everything else stays flat.
const GRADIENT_FILES = new Set(
  [
    "app/globals.css",
    "lib/news/mesh.ts",
    "components/workspace/Backdrop.tsx",
    "components/home/HeroBackdrop.tsx",
  ].map((f) => f.split("/").join(sep)),
);
const PILL_RADIUS =
  /\brounded-(?:full|pill|bar)\b|\bradius-(?:pill|bar)\b|border-radius:\s*(?:9{3}|[0-9]{3,})px/;
// `rounded-round` is for true circles only: avatars, presence dots, typing dots, list bullets.
const CIRCLE_FILES = new Set(
  [
    "components/ui/Avatar.tsx",
    "components/ui/Skeleton.tsx",
    "components/parakh/AdvocateCard.tsx",
    "components/samvaad/AdvocateRoom.tsx",
    "components/samvaad/RoomHeader.tsx",
    "components/samvaad/MessageList.tsx",
    "components/saransh/SaranshCard.tsx",
  ].map((f) => f.split("/").join(sep)),
);
const MOTION =
  /gsap|lottie|react-spring|animate-(?:fade-in|rise|bar-up|bounce|ping|spin)|scroll-smooth|scroll-behavior:\s*smooth|scrollIntoView\(\{[^}]*smooth|data-aos|IntersectionObserver/;
// Framer Motion powers the micro-interactions, but only through components/motion (reduced-motion aware).
const FRAMER = /from\s+["']framer-motion["']|from\s+["']motion\/react["']/;
const CUSTOM_CURSOR = /cursor\s*:\s*url|cursor-\[|custom[- ]?cursor|mousemove/i;
const EM_DASH = /\u2014/;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{2728}\u{2764}]/u;
const HYPE =
  /\b(?:revolutioni[sz](?:e|es|ing)|seamless(?:ly)?|unlock(?:s|ing)?|supercharg\w*|leverag(?:e|es|ing)|empower(?:s|ing)?|game[- ]?chang\w*|cutting[- ]edge|effortless(?:ly)?|world[- ]class|next[- ]gen\w*|elevate[sd]?|delve|state[- ]of[- ]the[- ]art|turbocharg\w*|AI[- ]powered|magic(?:al)?)\b/i;
// Invented social proof: testimonials, star ratings, "10,000+ users" style counters.
const SOCIAL_PROOF =
  /testimonial|\u2605|\u2B50|\b\d[\d,.]*\+?\s*(?:happy |satisfied |verified )?(?:customers|clients|users|consultations|cases|reviews|ratings)\b/i;
// Text that says how the app was made.
const AUTHORSHIP =
  /made (?:with|by) (?:ai|claude|gpt|chatgpt|an? ai)|generated (?:by|with|using) (?:ai|claude|gpt|chatgpt|an? llm)|\bclaude\b|\banthropic\b|\bchatgpt\b|co-authored|vibe[- ]?cod/i;

const BANNED_COPY = [
  /\bbest\b/i,
  /\btop\b(?![\s-]?up)/i,
  /\bguarantee/i,
  /\bwin(?:s|ning|ner)?\b/i,
  /#\s?1\b|\bno\.?\s?1\b|\bnumber one\b/i,
  /\bleading\b/i,
  /\bexpert\b/i,
  /\bsuccess rate\b/i,
  /\bassured\b/i,
  /सर्वश्रेष्ठ|बेहतरीन|गारंटी|जीत|टॉप|नंबर\s?(?:1|वन)|सबसे अच्छे|विशेषज्ञ/,
];

const problems = [];
const report = (file, lineNo, rule, line) =>
  problems.push(
    `${relative(root, file).split(sep).join("/")}:${lineNo}  ${rule}\n    ${line.trim()}`,
  );

for (const file of files(CODE_DIRS, [".ts", ".tsx", ".css", ".mjs"])) {
  const rel = relative(root, file);
  const isRouteLoading = rel.startsWith("app") && rel.endsWith(`${sep}loading.tsx`);
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes("design-check-ignore")) return;
    if (isRouteLoading && /next-intl|useTranslations|getTranslations/.test(line)) {
      report(
        file,
        i + 1,
        "loading.tsx must not use next-intl (rendered before the locale is set)",
        line,
      );
    }
    if (rel !== TOKEN_FILE && COLOUR_LITERAL.test(line))
      report(file, i + 1, "colour literal outside tokens", line);
    if (DEFAULT_PALETTE.test(line)) report(file, i + 1, "Tailwind default palette class", line);
    if (SPINNER.test(line)) report(file, i + 1, "spinner (use <Skeleton />)", line);
    if (PRAMAN.test(line)) report(file, i + 1, "Praman must never reach the frontend", line);
    if (rel.includes("generated")) return;
    if (GRADIENT.test(line) && !GRADIENT_FILES.has(rel))
      report(file, i + 1, "gradient (flat colours only, except news mesh and backdrops)", line);
    if (PILL_RADIUS.test(line))
      report(file, i + 1, "pill or fully round radius (use rounded-input / rounded-card)", line);
    if (/\brounded-round\b/.test(line) && !CIRCLE_FILES.has(rel))
      report(file, i + 1, "rounded-round is for circles only (avatars, presence dots)", line);
    if (MOTION.test(line))
      report(file, i + 1, "animation or smooth scrolling (pages stay still)", line);
    if (CUSTOM_CURSOR.test(line)) report(file, i + 1, "custom cursor", line);
    if (FRAMER.test(line) && !rel.startsWith(`components${sep}motion${sep}`))
      report(file, i + 1, "import framer-motion only inside components/motion", line);
    if (EM_DASH.test(line)) report(file, i + 1, "em dash", line);
    if (EMOJI.test(line)) report(file, i + 1, "emoji (use an SVG icon or nothing)", line);
    if (AUTHORSHIP.test(line)) report(file, i + 1, "mentions how the app was built", line);
  });
}

// Long-form legal text is TypeScript, not JSON: hold it to the same writing rules as the message files.
for (const file of files(["lib/legal"], [".ts"])) {
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (EM_DASH.test(line)) report(file, i + 1, "em dash", line);
      if (EMOJI.test(line)) report(file, i + 1, "emoji", line);
      if (HYPE.test(line)) report(file, i + 1, "hype wording", line);
    });
}

for (const file of files(COPY_DIRS, [".json"])) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    // Only check values, not keys.
    const value = line.includes('":') ? line.slice(line.indexOf('":') + 2) : line;
    for (const rx of BANNED_COPY) {
      if (rx.test(value)) report(file, i + 1, `promotional claim ${rx}`, line);
    }
    if (SPINNER.test(value)) report(file, i + 1, "spinner wording", line);
    if (PRAMAN.test(value)) report(file, i + 1, "Praman must never reach the frontend", line);
    if (EM_DASH.test(value)) report(file, i + 1, "em dash", line);
    if (EMOJI.test(value)) report(file, i + 1, "emoji", line);
    if (HYPE.test(value)) report(file, i + 1, "hype wording", line);
    if (SOCIAL_PROOF.test(value)) report(file, i + 1, "invented social proof", line);
    if (AUTHORSHIP.test(value)) report(file, i + 1, "mentions how the app was built", line);
  });
}

if (problems.length > 0) {
  console.error(`check-design: ${problems.length} problem(s)\n\n${problems.join("\n\n")}\n`);
  process.exit(1);
}
console.log(
  "check-design: ok (tokens only, flat colour, no pills, still pages, no emoji or em dashes, no hype or invented proof, no Praman)",
);
