// Renders the app icons from inline SVG with the locally installed Chromium (Playwright).
// Usage: node scripts/generate-icons.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const mark = (stroke) => `<path d="M30 52 L44 66 L72 36" fill="none" stroke="${stroke}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M70 70 a24 24 0 1 1 6 -18" fill="none" stroke="${stroke}" stroke-width="5" stroke-linecap="round" opacity="0.55"/>`;

const icon = (size, { padding = 0, radius = 22, bg = "#1f5f7a", transparent = false, stroke = "#ffffff" } = {}) => {
  const inner = 100 - padding * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  ${transparent ? "" : `<rect width="100" height="100" rx="${radius}" fill="${bg}"/>`}
  <g transform="translate(${padding} ${padding}) scale(${inner / 100})">${mark(stroke)}</g></svg>`;
};

const targets = [
  ["public/icons/icon-192.png", 192, icon(192)],
  ["public/icons/icon-512.png", 512, icon(512)],
  ["public/icons/icon-maskable-512.png", 512, icon(512, { padding: 14, radius: 0 })],
  ["public/icons/apple-touch-icon.png", 180, icon(180, { radius: 0 })],
  ["public/icons/badge-72.png", 72, icon(72, { transparent: true, stroke: "#ffffff" })],
  ["src/app/icon.png", 64, icon(64)],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, svg] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log("wrote", file, fs.statSync(file).size, "bytes");
}
await browser.close();
