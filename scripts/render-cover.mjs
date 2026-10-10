// Renders scripts/devpost-cover.html to docs/devpost/cover.png (1500×1000).
// Usage: node scripts/render-cover.mjs   (needs Playwright: npm i -D playwright, or PLAYWRIGHT_MODULE)
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const root = resolve(import.meta.dirname, "..");
mkdirSync(resolve(root, "docs/devpost"), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(`file://${resolve(root, "scripts/devpost-cover.html")}`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(root, "docs/devpost/cover.png") });
await browser.close();
console.log("wrote docs/devpost/cover.png");
