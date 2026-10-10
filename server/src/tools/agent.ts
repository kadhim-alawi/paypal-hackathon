/**
 * Agentic giving from the terminal: Claude connects to a Tideover server over MCP,
 * finds a verified need and starts a donation you approve with PayPal.
 *
 *   ANTHROPIC_API_KEY=... npm run agent -- "Give $25 to a student who needs help"
 *   ANTHROPIC_API_KEY=... npm run agent -- --url https://your-tideover.onrender.com "..."
 */
import "../lib/env.js";
import Anthropic from "@anthropic-ai/sdk";
import { runDonorAgent } from "../agent/donor-agent.js";

const args = process.argv.slice(2);
let url = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8080}`;
const urlFlag = args.indexOf("--url");
if (urlFlag >= 0) {
  url = args[urlFlag + 1] ?? url;
  args.splice(urlFlag, 2);
}
const prompt = args.join(" ").trim() || "Find an approved need that's waiting for money and give $25 to it.";
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY.");
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey, baseURL: process.env.TIDEOVER_ANTHROPIC_BASE_URL });
const mcpUrl = `${url.replace(/\/$/, "")}/mcp`;
console.log(`\nYou: ${prompt}\n`);
console.log(`Connecting to ${mcpUrl} …`);

try {
  const result = await runDonorAgent({
    mcpUrl,
    anthropic,
    model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
    prompt,
    onEvent: (e) => {
      if (e.type === "connected") console.log(`  tools: ${e.tools.join(", ")}\n`);
      if (e.type === "tool_call") console.log(`→ ${e.name} ${JSON.stringify(e.input)}`);
      if (e.type === "tool_result") console.log(`  ${e.isError ? "✗" : "✓"} ${e.text.replace(/\s+/g, " ").slice(0, 160)}${e.text.length > 160 ? "…" : ""}`);
    },
  });
  console.log(`\nAgent: ${result.text}\n`);
  for (const link of result.checkoutUrls) console.log(`Approve with PayPal: ${link}`);
  if (result.checkoutUrls.length === 0) console.log("(No donation was started.)");
} catch (err) {
  console.error("\n✗", (err as Error).message);
  process.exit(1);
}
