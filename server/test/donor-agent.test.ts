import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDonorAgent, type DonorAgentEvent } from "../src/agent/donor-agent.js";
import { donations } from "../src/db/schema.js";
import { makeApp, type TestCtx } from "./helpers.js";

type Body = { messages: Array<{ role: string; content: unknown }>; tools: Array<{ name: string }>; system: string };

/** A Messages API stand-in that plays Claude's side of the conversation. */
function fakeClaude(turns: Array<(body: Body) => unknown[]>) {
  const bodies: Body[] = [];
  const impl = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    bodies.push(body);
    const turn = turns.shift();
    if (!turn) throw new Error("unexpected request");
    const content = turn(body);
    const stop = content.some((b) => (b as { type: string }).type === "tool_use") ? "tool_use" : "end_turn";
    return new Response(
      JSON.stringify({
        id: `msg_${bodies.length}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content,
        stop_reason: stop,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
      { status: 200, headers: { "content-type": "application/json", "request-id": "req_test" } },
    );
  }) as typeof fetch;
  return { impl, bodies };
}

const lastToolResult = (body: Body) => {
  const last = body.messages[body.messages.length - 1]!;
  const block = (last.content as Array<{ type: string; content: string }>).find((b) => b.type === "tool_result")!;
  return block.content;
};

describe("terminal donor agent (Claude over Tideover MCP)", () => {
  let ctx: TestCtx;
  beforeEach(async () => {
    ctx = await makeApp();
  });
  afterEach(async () => ctx.close());

  /** Routes the MCP client's HTTP requests into the in-process server. */
  const viaInject = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const res = await ctx.app.inject({
      method: (init?.method ?? "GET") as "GET",
      url: url.pathname + url.search,
      headers,
      payload: init?.body as string | undefined,
    });
    return new Response(res.statusCode === 202 || res.statusCode === 204 ? null : res.rawPayload, {
      status: res.statusCode,
      headers: res.headers as Record<string, string>,
    });
  }) as typeof fetch;

  it("finds an approved need, starts an earmarked donation and hands back the PayPal checkout link", async () => {
    let needId = "";
    const claude = fakeClaude([
      (body) => {
        expect(body.tools.map((t) => t.name)).toEqual(
          expect.arrayContaining(["list_funds", "find_needs", "create_donation", "get_donation_status"]),
        );
        expect(body.system).toContain("You cannot move money");
        return [{ type: "tool_use", id: "toolu_1", name: "find_needs", input: { max_amount: 500 } }];
      },
      (body) => {
        const needs = JSON.parse(lastToolResult(body)) as Array<{ need_id: string; fund_slug: string; amount_usd: number }>;
        needId = needs[0]!.need_id;
        return [
          {
            type: "tool_use",
            id: "toolu_2",
            name: "create_donation",
            input: { fund_slug: needs[0]!.fund_slug, amount_usd: 25, need_id: needId, agent_name: "Tideover CLI agent" },
          },
        ];
      },
      (body) => {
        const created = JSON.parse(lastToolResult(body)) as { checkout_url: string };
        return [{ type: "text", text: `I started a $25 gift toward a student's housing grant. Approve it here: ${created.checkout_url}` }];
      },
    ]);

    const events: DonorAgentEvent[] = [];
    const result = await runDonorAgent({
      mcpUrl: "http://tideover.test/mcp",
      mcpFetch: viaInject,
      anthropic: new Anthropic({ apiKey: "test", fetch: claude.impl, maxRetries: 0 }),
      model: "claude-opus-5-5",
      prompt: "Give $25 to someone who needs help",
      onEvent: (e) => events.push(e),
    });

    expect(claude.bodies).toHaveLength(3);
    expect(events.filter((e) => e.type === "tool_call").map((e) => (e as { name: string }).name)).toEqual(["find_needs", "create_donation"]);
    expect(result.checkoutUrls).toHaveLength(1);
    expect(result.checkoutUrls[0]).toMatch(/^http:\/\/tideover\.test\/give\/checkout\/don_/);
    expect(result.text).toContain(result.checkoutUrls[0]);

    // The gift is recorded as agent-initiated, earmarked, and not yet paid: a person must approve it.
    const [d] = await ctx.s.db.select().from(donations).where(eq(donations.id, result.donationIds[0]!));
    expect(d).toMatchObject({ source: "agent", agentName: "Tideover CLI agent", amountCents: 2_500, applicationId: needId, status: "created" });
  });
});
