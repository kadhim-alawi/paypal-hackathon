import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * A minimal "your own AI assistant" for agentic giving: Claude connects to any
 * Tideover server over MCP, finds verified needs and starts a donation. It can't
 * move money: every gift ends in a PayPal checkout link the person approves.
 */

export type DonorAgentEvent =
  | { type: "connected"; tools: string[] }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; name: string; isError: boolean; text: string }
  | { type: "text"; text: string };

export interface DonorAgentOptions {
  /** Tideover MCP endpoint, e.g. https://tideover.onrender.com/mcp */
  mcpUrl: string;
  anthropic: Anthropic;
  model: string;
  prompt: string;
  agentName?: string;
  /** Custom fetch for the MCP connection (tests). */
  mcpFetch?: typeof fetch;
  onEvent?: (event: DonorAgentEvent) => void;
  maxSteps?: number;
}

export interface DonorAgentResult {
  text: string;
  checkoutUrls: string[];
  donationIds: string[];
}

const SYSTEM = (agentName: string) => `You are ${agentName}, a giving assistant acting for the person you're talking to. You are connected to a Tideover server, which runs community emergency funds.

- Use the tools to find where money is needed. Prefer approved needs (find_needs): a person has already reviewed them, and funding one pays it out immediately.
- Never give more than the person asked for. If they named an amount, use exactly that or less; if they didn't, ask instead of guessing.
- When you create a donation, pass agent_name "${agentName}".
- You cannot move money. A donation is only complete after the person opens the checkout_url and approves the payment with PayPal or Venmo. Say so plainly and give them the link; never claim the gift is done.
- Keep the final answer short: what you chose and why, the amount, and the checkout link.`;

export async function runDonorAgent(o: DonorAgentOptions): Promise<DonorAgentResult> {
  const agentName = o.agentName ?? "Tideover CLI agent";
  const emit = o.onEvent ?? (() => {});
  const mcp = new Client({ name: "tideover-donor-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(o.mcpUrl), o.mcpFetch ? { fetch: o.mcpFetch } : undefined);
  await mcp.connect(transport);

  try {
    const { tools: mcpTools } = await mcp.listTools();
    emit({ type: "connected", tools: mcpTools.map((t) => t.name) });
    const tools: Anthropic.Beta.Messages.BetaTool[] = mcpTools.map((t) => ({
      name: t.name,
      description: t.description ?? t.title ?? t.name,
      input_schema: t.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
    }));

    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: o.prompt }];
    const checkoutUrls = new Set<string>();
    const donationIds = new Set<string>();
    let finalText = "";

    for (let step = 0; step < (o.maxSteps ?? 8); step++) {
      const res = await o.anthropic.beta.messages.create({
        model: o.model,
        max_tokens: 16000,
        system: SYSTEM(agentName),
        tools,
        messages,
        output_config: { effort: "medium" },
      });
      if (res.stop_reason === "refusal") {
        finalText = "The model declined this request.";
        break;
      }
      const text = res.content
        .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (text) emit({ type: "text", text });
      const uses = res.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
      if (uses.length === 0 || res.stop_reason === "max_tokens") {
        finalText = text;
        break;
      }

      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const use of uses) {
        emit({ type: "tool_call", name: use.name, input: use.input });
        let resultText: string;
        let isError = false;
        try {
          const out = await mcp.callTool({ name: use.name, arguments: (use.input ?? {}) as Record<string, unknown> });
          isError = out.isError === true;
          resultText = (Array.isArray(out.content) ? out.content : [])
            .map((c) => (c && typeof c === "object" && "text" in c ? String(c.text) : ""))
            .join("\n");
        } catch (err) {
          isError = true;
          resultText = `Tool failed: ${(err as Error).message}`;
        }
        for (const m of resultText.matchAll(/"checkout_url":\s*"([^"]+)"/g)) checkoutUrls.add(m[1]!);
        for (const m of resultText.matchAll(/"donation_id":\s*"([^"]+)"/g)) donationIds.add(m[1]!);
        emit({ type: "tool_result", name: use.name, isError, text: resultText });
        results.push({ type: "tool_result", tool_use_id: use.id, content: resultText || "(empty)", is_error: isError });
      }
      messages.push({ role: "user", content: results });
    }

    return { text: finalText, checkoutUrls: [...checkoutUrls], donationIds: [...donationIds] };
  } finally {
    await mcp.close().catch(() => {});
  }
}
