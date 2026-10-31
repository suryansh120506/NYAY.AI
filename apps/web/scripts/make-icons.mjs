// Regenerates the raster favicons from app/icon.svg (flat Indigo #1A237E). Run: node scripts/make-icons.mjs
// Needs Playwright's Chromium (already used by the e2e suite). Output: app/apple-icon.png, app/favicon.ico.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rounded = readFileSync(join(root, "app/icon.svg"), "utf-8");
// Apple masks touch icons itself, so it gets a full-bleed square.
const square = rounded.replace(/ rx="\d+"/, "");

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

writeFileSync(join(root, "app/apple-icon.png"), await render(square, 180));

// ICO container holding PNG images (supported by every current browser).
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((size) => render(rounded, size)));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map((png, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(sizes[i], 0);
  entry.writeUInt8(sizes[i], 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});
writeFileSync(join(root, "app/favicon.ico"), Buffer.concat([header, ...entries, ...images]));
await browser.close();
console.log("icons written");
