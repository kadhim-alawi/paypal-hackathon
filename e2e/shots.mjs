// Visual smoke test: renders the main pages and saves screenshots.
// Usage: node e2e/shots.mjs http://localhost:8787 out-dir
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";

const base = process.argv[2] ?? "http://localhost:8787";
const out = process.argv[3] ?? "screenshots";
const browser = await chromium.launch();

async function shoot(page, path, name, wait = 2500) {
  await page.goto(base + path, { waitUntil: "load" });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  console.log("shot", name);
}

const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
desktop.on("console", (m) => m.type() === "error" && console.log("console error:", m.text()));
await shoot(desktop, "/", "01-home");
await shoot(desktop, "/f/eastside", "02-fund");
await shoot(desktop, "/f/riverside-college", "03-fund-riverside");
await shoot(desktop, "/f/eastside/apply", "04-apply-start");
await shoot(desktop, "/console/login", "05-login");

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-US" });
await shoot(mobile, "/", "m01-home");
await shoot(mobile, "/f/eastside", "m02-fund");
await browser.close();
