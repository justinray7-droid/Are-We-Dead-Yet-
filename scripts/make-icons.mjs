// Renders public/icons/icon.svg to the PNGs the app installs with.
// Needs Playwright with Chromium (not a project dependency): node scripts/make-icons.mjs
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const svg = await readFile(root + "public/icons/icon.svg", "utf8");

// [file, size, inset]: maskable icons keep the artwork inside the central 80% safe zone.
const outputs = [
  ["app/apple-icon.png", 180, 0],
  ["public/icons/icon-192.png", 192, 0],
  ["public/icons/icon-512.png", 512, 0],
  ["public/icons/maskable-512.png", 512, 0.1],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, inset] of outputs) {
  const pad = Math.round(size * inset);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;background:#0c0a09"><div style="width:${size}px;height:${size}px;padding:${pad}px;box-sizing:border-box">` +
      svg.replace("<svg ", `<svg width="${size - 2 * pad}" height="${size - 2 * pad}" `) +
      "</div></body>",
  );
  await page.screenshot({ path: root + file, omitBackground: false });
  console.log("wrote", file);
}
await browser.close();
