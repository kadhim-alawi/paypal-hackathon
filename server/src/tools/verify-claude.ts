/**
 * Live check of the AI layer against the Anthropic API.
 *
 *   ANTHROPIC_API_KEY=... npm run verify:claude
 */
import { readFileSync } from "node:fs";
import { ClaudeAi } from "../ai/claude.js";
import type { RecordDetailsInput } from "../ai/types.js";
import { EASTSIDE_POLICY, EASTSIDE_RUBRIC } from "../seed.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY.");
  process.exit(1);
}
const model = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const ai = new ClaudeAi({ apiKey, baseUrl: process.env.TIDEOVER_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com" }, model);
const fund = { name: "Eastside Neighbors Emergency Fund", region: "East Austin, TX", currency: "USD", policyText: EASTSIDE_POLICY, rubric: EASTSIDE_RUBRIC };
const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t = Date.now();
  const r = await fn();
  console.log(`\n▸ ${label} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  return r;
};

const image = readFileSync(new URL("../../../demo-assets/eastside-auto-estimate-380.jpg", import.meta.url));
const doc = await timed("Document reading (vision)", () =>
  ai.extractDocument({ filename: "estimate.jpg", mimeType: "image/jpeg", data: image, statedAmountCents: 38_000, category: "car_repair" }),
);
console.log(doc);

const recorded: RecordDetailsInput[] = [];
let streamed = "";
await timed("Intake turn (Spanish, streaming + tools)", () =>
  ai.intakeTurn({
    fund,
    publicRef: "TDO-VERIFY",
    facts: {},
    documents: [],
    history: [
      { role: "assistant", content: "Hi, I'm the Eastside Neighbors Emergency Fund assistant. What happened?" },
      { role: "user", content: "Hola. Se descompuso mi carro y lo necesito para ir al trabajo. El mecánico dice que son $380 por los frenos. Vivo en 78741." },
    ],
    onDelta: (d) => (streamed += d),
    tools: {
      recordDetails: async (i) => {
        recorded.push(i);
        return "Saved. Still unknown: urgency.";
      },
      requestDocument: async (i) => `Upload button shown for ${i.document_kind}.`,
      markReady: async () => "Ready card shown.",
    },
  }),
);
console.log("Assistant:", streamed);
console.log("Recorded:", recorded);

const assessment = await timed("Case assessment (structured output)", () =>
  ai.assess({
    fund,
    publicRef: "TDO-VERIFY",
    facts: { location: "78741", urgency: "this_week", circumstances: "Car needed to get to warehouse job" },
    category: "car_repair",
    amountRequestedCents: 38_000,
    needSummary: "Brake repair needed to keep getting to work.",
    payout: { method: "paypal_account", verified: true },
    transcript: [{ role: "user", content: "Se descompuso mi carro... $380 por los frenos. Vivo en 78741." }],
    documents: [{ filename: "estimate.jpg", extraction: doc }],
    riskFlags: [],
    priorGrants: { count: 0, totalCents: 0, lastPaidAt: null },
  }),
);
console.log(assessment);

const message = await timed("Decision message (Spanish)", () =>
  ai.decisionMessage({ fundName: fund.name, language: "es", firstName: "Maria", kind: "paid", amountCents: 38_000, currency: "USD", payoutLabel: "your PayPal account" }),
);
console.log(message);

const rubric = await timed("Policy compiler", () =>
  ai.compilePolicy({ fundName: fund.name, region: fund.region, currency: "USD", policyText: EASTSIDE_POLICY }),
);
console.log(JSON.stringify(rubric, null, 2).slice(0, 1500));
console.log("\nClaude integration works.");
