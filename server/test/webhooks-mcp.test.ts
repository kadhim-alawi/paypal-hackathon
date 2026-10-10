import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applications, payouts, webhookEvents } from "../src/db/schema.js";
import { disburse } from "../src/domain/disbursement.js";
import { makeApp, type TestCtx } from "./helpers.js";

describe("webhooks", () => {
  let ctx: TestCtx;
  beforeEach(async () => {
    ctx = await makeApp({ SIMULATED_PAYOUT_DELAY_MS: "600000" });
  });
  afterEach(async () => ctx.close());

  it("applies a payout-item webhook once and ignores duplicates", async () => {
    // Approve Lucía's case directly and send her payout (delay keeps it pending at PayPal).
    const [lucia] = await ctx.s.db.select().from(applications).where(eq(applications.amountRequestedCents, 28_640));
    await ctx.s.db
      .update(applications)
      .set({ status: "approved", amountApprovedCents: 28_640, decidedAt: new Date() })
      .where(eq(applications.id, lucia!.id));
    await disburse(ctx.s, lucia!.id, { actor: "staff" });
    const [p] = await ctx.s.db.select().from(payouts).where(eq(payouts.applicationId, lucia!.id));
    expect(p!.status).toBe("processing");

    const batch = await ctx.sim.getPayoutBatch(p!.paypalBatchId!);
    const item = { ...batch.items![0]!, transaction_status: "SUCCESS" as const, transaction_id: "TX123", payout_item_fee: { currency: "USD", value: "5.73" } };
    const event = { id: "WH-1", event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource_type: "payouts_item", resource: item };
    const r1 = await ctx.app.inject({ method: "POST", url: "/api/webhooks/paypal", payload: event });
    expect(r1.json().result).toBe("processed");
    await ctx.s.jobs.idle();
    const r2 = await ctx.app.inject({ method: "POST", url: "/api/webhooks/paypal", payload: event });
    expect(r2.json().result).toBe("duplicate");

    const [after] = await ctx.s.db.select().from(payouts).where(eq(payouts.id, p!.id));
    expect(after!.status).toBe("success");
    expect(after!.paypalTransactionId).toBe("TX123");
    const [app] = await ctx.s.db.select().from(applications).where(eq(applications.id, lucia!.id));
    expect(app!.status).toBe("paid");
    const rows = await ctx.s.db.select().from(webhookEvents);
    expect(rows.find((r) => r.id === "WH-1")?.processedAt).toBeTruthy();
  });

  it("rejects malformed events", async () => {
    const r = await ctx.app.inject({ method: "POST", url: "/api/webhooks/paypal", payload: { hello: "world" } });
    expect(r.statusCode).toBe(400);
  });
});

describe("MCP server (agentic giving)", () => {
  let ctx: TestCtx;
  beforeEach(async () => {
    ctx = await makeApp();
  });
  afterEach(async () => ctx.close());

  async function rpc(method: string, params: unknown, id = 1) {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-protocol-version": "2025-06-18" },
      payload: { jsonrpc: "2.0", id, method, params },
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it("lists tools, finds a need and creates a PayPal checkout link", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-agent", version: "1.0" },
    });
    expect(init.result.serverInfo.name).toBe("tideover");

    const list = await rpc("tools/list", {}, 2);
    const names = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_funds", "find_needs", "create_donation", "get_donation_status", "get_impact"]));

    const needs = await rpc("tools/call", { name: "find_needs", arguments: { max_amount: 500 } }, 3);
    const parsed = JSON.parse(needs.result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].fund_slug).toBe("riverside-college");

    const created = await rpc(
      "tools/call",
      { name: "create_donation", arguments: { fund_slug: "riverside-college", amount_usd: 430, need_id: parsed[0].need_id, agent_name: "Claude" } },
      4,
    );
    const donation = JSON.parse(created.result.content[0].text);
    expect(donation.checkout_url).toMatch(/^http:\/\/tideover\.test\/give\/checkout\/don_/);

    const status = await rpc("tools/call", { name: "get_donation_status", arguments: { donation_id: donation.donation_id } }, 5);
    expect(JSON.parse(status.result.content[0].text).status).toBe("created");
  });
});
