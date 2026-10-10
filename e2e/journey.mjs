// End-to-end journey through the real UI (Flutter web + API + PayPal simulator).
// Usage: node e2e/journey.mjs http://localhost:8787 out-dir
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import { resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:8787";
const out = process.argv[3] ?? "screenshots";
const estimate = resolve(import.meta.dirname, "../demo-assets/eastside-auto-estimate-380.jpg");
const browser = await chromium.launch();
let n = 0;
const snap = async (page, name) => {
  n++;
  const file = `${out}/j${String(n).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file });
  console.log("📸", file);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Turns on Flutter's semantics tree so we can find widgets by role/name. */
async function enableA11y(page) {
  await page.waitForSelector("flt-semantics-placeholder", { state: "attached", timeout: 20000 }).catch(() => {});
  await page.evaluate(() => document.querySelector("flt-semantics-placeholder")?.click());
  await sleep(600);
}
const button = (page, name) => page.getByRole("button", { name, exact: false }).first();

async function open(page, path) {
  await page.goto(base + path, { waitUntil: "load" });
  await sleep(2500);
  await enableA11y(page);
}

// ---------------------------------------------------------------- applicant
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-US" });
const app = await phone.newPage();
app.on("pageerror", (e) => console.log("pageerror(app):", e.message));
await open(app, "/f/eastside/apply");
await snap(app, "apply-start");
await button(app, "Start my request").click();
await app.waitForURL(/\/r\/app_/, { timeout: 15000 });
await sleep(2500);
await enableA11y(app);
await snap(app, "chat-greeting");

const typeAndSend = async (text) => {
  const box = app.getByRole("textbox").last();
  await box.click();
  await sleep(300);
  await app.keyboard.type(text, { delay: 5 });
  await sleep(200);
  await app.keyboard.press("Enter");
  await sleep(3500);
};
await typeAndSend("Hola. My car broke down and I need $380 to fix the brakes so I can get to work at the warehouse. I live in 78741 and need it this week.");
await snap(app, "chat-first-reply");

// Upload the repair estimate.
await button(app, "Add").click().catch(async () => button(app, "Add a photo or document").click());
await sleep(800);
const chooserPromise = app.waitForEvent("filechooser", { timeout: 10000 });
await app.getByText("Choose a photo or PDF").click();
const chooser = await chooserPromise;
await chooser.setFiles(estimate);
await sleep(5000);
await snap(app, "chat-document-read");

// Review & submit → Connect PayPal (simulated Log in with PayPal).
await button(app, "Review & submit").click();
await sleep(1500);
await snap(app, "review-sheet");
await button(app, "Connect PayPal").click();
await app.waitForURL(/\/sim\/paypal\/login/, { timeout: 15000 });
await sleep(500);
await snap(app, "paypal-login-sim");
await app.getByRole("button", { name: "Agree and connect" }).click();
await app.waitForURL(/paypal=connected/, { timeout: 15000 });
await sleep(3500);
await enableA11y(app);
await snap(app, "paypal-connected-review");
await button(app, "Submit request").click();
await sleep(4000);
await snap(app, "submitted");
const requestUrl = app.url().split("?")[0];

// ------------------------------------------------------------------- staff
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
const staff = await desk.newPage();
staff.on("pageerror", (e) => console.log("pageerror(staff):", e.message));
await open(staff, "/console/login");
await snap(staff, "console-login");
await button(staff, "Sign in as Sam").click();
await staff.waitForURL(/\/console$/, { timeout: 15000 });
await sleep(2500);
await snap(staff, "console-dashboard");
await open(staff, "/console/cases");
await snap(staff, "console-cases");
const caseId = requestUrl.split("/r/")[1];
await open(staff, `/console/cases/${caseId}`);
await snap(staff, "console-case");
await staff.mouse.wheel(0, 900);
await sleep(600);
await snap(staff, "console-case-scrolled");
await staff.mouse.wheel(0, -2000);
await sleep(400);
await button(staff, "Approve & send").click();
await sleep(800);
await snap(staff, "approve-dialog");
await staff.getByRole("button", { name: "Approve & send" }).last().click();
await sleep(9000);
await snap(staff, "console-case-paid");

// Applicant sees the money arrive (live, no refresh).
await sleep(1000);
await snap(app, "applicant-paid");

// ----------------------------------------------------------------- donor
const donor = await desk.newPage();
await open(donor, "/f/riverside-college");
await snap(donor, "fund-riverside-need");
await button(donor, "Fund this").click();
await sleep(1200);
await snap(donor, "give-sheet");
await button(donor, "Continue to PayPal").click();
await donor.waitForURL(/\/give\/checkout\//, { timeout: 15000 });
await sleep(800);
await snap(donor, "checkout-page");
await donor.getByRole("button", { name: "Pay with PayPal" }).click();
await donor.waitForURL(/\/sim\/paypal\/checkout/, { timeout: 15000 });
await snap(donor, "paypal-checkout-sim");
await donor.getByRole("button", { name: "Complete purchase" }).click();
await donor.waitForURL(/\/thanks\//, { timeout: 20000 });
await sleep(9000);
await snap(donor, "thanks-delivered");
await open(donor, "/f/eastside");
await snap(donor, "fund-eastside-after");

// Remaining console pages.
for (const [path, name] of [["/console/money", "console-money"], ["/console/funds", "console-funds"], ["/console/audit", "console-audit"], ["/console/copilot", "console-copilot"]]) {
  await open(staff, path);
  await snap(staff, name);
}
await button(staff, "How much can we still grant").click().catch(() => {});
await sleep(4000);
await snap(staff, "console-copilot-answer");

await browser.close();
console.log("journey complete");
