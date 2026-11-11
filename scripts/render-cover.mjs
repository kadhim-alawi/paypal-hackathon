// Renders the Devpost cover (1500×1000) and the YouTube thumbnail (1280×720) into docs/devpost/.
// Usage: node scripts/render-cover.mjs   (needs Playwright: npm i -D playwright, or PLAYWRIGHT_MODULE)
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const root = resolve(import.meta.dirname, "..");
mkdirSync(resolve(root, "docs/devpost"), { recursive: true });
const browser = await chromium.launch();
for (const [html, out, width, height] of [
  ["scripts/devpost-cover.html", "docs/devpost/cover.png", 1500, 1000],
  ["scripts/youtube-thumbnail.html", "docs/devpost/youtube-thumbnail.png", 1280, 720],
]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(`file://${resolve(root, html)}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(root, out) });
  console.log(`wrote ${out}`);
}
await browser.close();
