import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import type { CopilotTool } from "../ai/types.js";
import { applications, copilotMessages, donations, funds, payouts, type User } from "../db/schema.js";
import { newId } from "../lib/ids.js";
import type { Services } from "../services.js";
import { audit } from "./audit.js";
import { refundDonation } from "./donations.js";
import { fundStats } from "./funds.js";
import { caseSummary, donationView, payoutView } from "./views.js";

type JsonSchema = Record<string, unknown>;

const obj = (properties: Record<string, unknown>, required: string[] = []): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});

/** Strips keys that make schemas non-deterministic (e.g. date defaults) so prompts stay cacheable. */
function cleanSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === "$schema" || k === "default") continue;
      out[k] = cleanSchema(v);
    }
    return out;
  }
  return schema;
}

/**
 * Wraps tools from the official PayPal Agent Toolkit (@paypal/agent-toolkit) so
 * Claude can call them. Only available when real PayPal credentials are set.
 */
async function paypalToolkitTools(s: Services): Promise<CopilotTool[]> {
  if (s.config.paypal.mode === "simulated") return [];
  try {
    const mod = (await import("@paypal/agent-toolkit/ai-sdk")) as unknown as {
      PayPalAgentToolkit?: new (opts: unknown) => { getTools(): Record<string, ToolkitTool> };
      default?: { PayPalAgentToolkit: new (opts: unknown) => { getTools(): Record<string, ToolkitTool> } };
    };
    const Toolkit = mod.PayPalAgentToolkit ?? mod.default!.PayPalAgentToolkit;
    const { zodToJsonSchema } = await import("zod-to-json-schema");
    const toolkit = new Toolkit({
      clientId: s.config.paypal.clientId,
      clientSecret: s.config.paypal.clientSecret,
      configuration: {
        actions: {
          transactions: { list: true },
          orders: { get: true },
          insights: { get: true },
          disputes: { list: true, get: true },
          invoices: { list: true },
        },
        context: { sandbox: s.config.paypal.mode === "sandbox" },
      },
    });
    const tools = toolkit.getTools();
    return Object.entries(tools).map(([name, tool]) => ({
      name: `paypal_${name}`,
      description: `[PayPal Agent Toolkit] ${tool.description}`.slice(0, 1000),
      inputSchema: cleanSchema(
        zodToJsonSchema(tool.parameters as never, { target: "jsonSchema7", $refStrategy: "none" }),
      ) as JsonSchema,
      run: async (input) => {
        const args = tool.parameters.parse(input);
        return tool.execute(args, { toolCallId: newId("tk"), messages: [] });
      },
    }));
  } catch (err) {
    s.log.warn({ err }, "PayPal Agent Toolkit unavailable; copilot continues without it");
    return [];
  }
}

interface ToolkitTool {
  description: string;
  parameters: { parse(input: unknown): unknown };
  execute(args: unknown, options: unknown): Promise<unknown>;
}

export async function copilotTools(s: Services, user: User): Promise<CopilotTool[]> {
  const fundRows = await s.db.select().from(funds).orderBy(asc(funds.createdAt));
  const fundById = new Map(fundRows.map((f) => [f.id, f]));

  const tools: CopilotTool[] = [
    {
      name: "get_fund_overview",
      description:
        "Balances and key numbers for each fund: money raised, granted, available balance, people helped, median minutes from request to cash, requests waiting on review or on funds.",
      inputSchema: obj({}),
      run: async () =>
        Promise.all(
          fundRows.map(async (f) => ({
            fund: f.name,
            slug: f.slug,
            status: f.status,
            autoApproveLimitCents: f.autoApproveLimitCents,
            ...(await fundStats(s, f)),
          })),
        ),
    },
    {
      name: "search_applications",
      description:
        "Find requests (cases). Filter by status (intake, submitted, needs_info, in_review, approved, awaiting_funds, paying, paid, unclaimed, payout_failed, denied, withdrawn), category key, or free-text query over the need summary and reference.",
      inputSchema: obj({
        status: { type: "string" },
        category: { type: "string" },
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      }),
      run: async (input) => {
        const conds = [];
        if (typeof input.status === "string") conds.push(eq(applications.status, input.status as never));
        if (typeof input.category === "string") conds.push(eq(applications.category, input.category));
        if (typeof input.query === "string" && input.query.trim()) {
          const q = `%${input.query.trim()}%`;
          conds.push(or(ilike(applications.needSummary, q), ilike(applications.publicRef, q)));
        }
        const rows = await s.db
          .select()
          .from(applications)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(applications.updatedAt))
          .limit(Math.min(50, Number(input.limit ?? 20)));
        return rows.map((a) => caseSummary(a, fundById.get(a.fundId)!));
      },
    },
    {
      name: "get_application",
      description: "Full details of one request by its reference (e.g. TDO-7KQ4M): AI assessment, risk flags, amounts, status.",
      inputSchema: obj({ ref: { type: "string" } }, ["ref"]),
      run: async (input) => {
        const [a] = await s.db
          .select()
          .from(applications)
          .where(eq(applications.publicRef, String(input.ref).toUpperCase()))
          .limit(1);
        if (!a) return { error: "not found" };
        return {
          ...caseSummary(a, fundById.get(a.fundId)!),
          facts: a.facts,
          assessment: a.assessment,
          riskFlags: a.riskFlags,
          decisionNote: a.decisionNote,
        };
      },
    },
    {
      name: "list_donations",
      description: "Recent donations with donor (unless anonymous), amount, PayPal capture id, fee and net, and whether an AI agent initiated it.",
      inputSchema: obj({ limit: { type: "integer", minimum: 1, maximum: 100 }, status: { type: "string" } }),
      run: async (input) => {
        const rows = await s.db
          .select()
          .from(donations)
          .where(typeof input.status === "string" ? eq(donations.status, input.status as never) : undefined)
          .orderBy(desc(donations.createdAt))
          .limit(Math.min(100, Number(input.limit ?? 20)));
        return rows.map((d) => donationView(d, { staff: true }));
      },
    },
    {
      name: "list_payouts",
      description: "Recent PayPal Payouts (grants sent) with status, PayPal batch/item ids and fees.",
      inputSchema: obj({ limit: { type: "integer", minimum: 1, maximum: 100 }, status: { type: "string" } }),
      run: async (input) => {
        const rows = await s.db
          .select()
          .from(payouts)
          .where(typeof input.status === "string" ? eq(payouts.status, input.status as never) : undefined)
          .orderBy(desc(payouts.createdAt))
          .limit(Math.min(100, Number(input.limit ?? 20)));
        return rows.map(payoutView);
      },
    },
    {
      name: "reconcile_with_paypal",
      description:
        "Compares Tideover's records with PayPal's transaction history for the last N days (max 31): captured donations and sent payouts that are missing on either side.",
      inputSchema: obj({ days: { type: "integer", minimum: 1, maximum: 31 } }),
      run: async (input) => {
        const days = Math.min(31, Math.max(1, Number(input.days ?? 7)));
        const end = new Date();
        const start = new Date(end.getTime() - days * 86_400_000);
        const txns = await s.paypal.listTransactions({ start, end });
        const ids = new Set(txns.map((t) => t.transactionId));
        const captured = await s.db
          .select()
          .from(donations)
          .where(eq(donations.status, "captured"));
        const sent = await s.db
          .select()
          .from(payouts)
          .where(inArray(payouts.status, ["success", "unclaimed"]));
        const inWindow = (d: Date | null) => !!d && d >= start && d <= end;
        const missingDonations = captured
          .filter((d) => inWindow(d.capturedAt) && d.paypalCaptureId && !ids.has(d.paypalCaptureId))
          .map((d) => ({ donationId: d.id, captureId: d.paypalCaptureId, amountCents: d.amountCents }));
        const missingPayouts = sent
          .filter((p) => inWindow(p.completedAt) && p.paypalTransactionId && !ids.has(p.paypalTransactionId))
          .map((p) => ({ payoutId: p.id, transactionId: p.paypalTransactionId, amountCents: p.amountCents }));
        return {
          windowDays: days,
          paypalTransactions: txns.length,
          tideoverDonations: captured.filter((d) => inWindow(d.capturedAt)).length,
          tideoverPayouts: sent.filter((p) => inWindow(p.completedAt)).length,
          missingDonations,
          missingPayouts,
          note:
            s.paypal.mode === "simulated"
              ? "PayPal simulator data."
              : "PayPal transaction search can lag up to 3 hours behind real time.",
        };
      },
    },
    {
      name: "refund_donation",
      description:
        "Refund a captured donation through PayPal. Requires confirm=true, which you may only send after the staff member explicitly confirmed in a previous message. Admins only.",
      inputSchema: obj(
        {
          donation_id: { type: "string" },
          reason: { type: "string" },
          confirm: { type: "boolean" },
        },
        ["donation_id", "reason", "confirm"],
      ),
      run: async (input) => {
        if (user.role !== "admin") return { error: "Only admins can refund donations." };
        const [d] = await s.db.select().from(donations).where(eq(donations.id, String(input.donation_id))).limit(1);
        if (!d) return { error: "Donation not found" };
        if (input.confirm !== true) {
          return {
            confirmation_required: true,
            donation: donationView(d, { staff: true }),
            message: "Ask the staff member to confirm this refund explicitly.",
          };
        }
        const refunded = await refundDonation(s, d.id, { id: user.id, name: user.name }, String(input.reason ?? ""));
        return { ok: true, donation: donationView(refunded, { staff: true }) };
      },
    },
  ];

  const toolkit = await paypalToolkitTools(s);
  if (toolkit.length > 0) {
    tools.push(...toolkit);
  } else {
    tools.push({
      name: "paypal_list_transactions",
      description:
        "List PayPal transactions (captures and payouts) for the last N days (max 31) from the fund's PayPal account.",
      inputSchema: obj({ days: { type: "integer", minimum: 1, maximum: 31 } }),
      run: async (input) => {
        const days = Math.min(31, Math.max(1, Number(input.days ?? 7)));
        const end = new Date();
        return s.paypal.listTransactions({ start: new Date(end.getTime() - days * 86_400_000), end });
      },
    });
  }
  return tools;
}

/** Runs one copilot turn, streaming to the staff member's console. */
export async function runCopilotTurn(s: Services, user: User, content: string): Promise<void> {
  const channel = `copilot:${user.id}`;
  await s.db.insert(copilotMessages).values({ id: newId("cpm"), userId: user.id, role: "user", content });
  const history = await s.db
    .select()
    .from(copilotMessages)
    .where(eq(copilotMessages.userId, user.id))
    .orderBy(desc(copilotMessages.createdAt))
    .limit(20);
  history.reverse();
  const turnId = newId("cpm");
  s.bus.publish(channel, "copilot.start", { turnId });
  const toolTrace: Array<{ name: string; ok: boolean; preview: string }> = [];
  let text: string;
  try {
    text = await s.ai.copilotTurn({
      userName: user.name,
      history: history.map((m) => ({ role: m.role, content: m.content })),
      tools: await copilotTools(s, user),
      onDelta: (delta) => s.bus.publish(channel, "copilot.delta", { turnId, text: delta }),
      onTool: (ev) => {
        toolTrace.push({ name: ev.name, ok: ev.ok, preview: ev.preview });
        s.bus.publish(channel, "copilot.tool", { turnId, name: ev.name, ok: ev.ok });
      },
    });
  } catch (err) {
    s.log.error({ err }, "copilot turn failed");
    text = "Sorry, I couldn't complete that just now. Please try again.";
  }
  await s.db.insert(copilotMessages).values({
    id: turnId,
    userId: user.id,
    role: "assistant",
    content: text || "(no answer)",
    meta: { tools: toolTrace },
  });
  if (toolTrace.some((t) => t.name === "refund_donation")) {
    await audit(s.db, {
      entityType: "copilot",
      entityId: turnId,
      actorType: "ai",
      actorName: s.ai.model,
      action: "copilot.money_tool",
      summary: `Copilot used refund_donation on behalf of ${user.name}`,
    });
  }
  s.bus.publish(channel, "copilot.done", { turnId, content: text, tools: toolTrace });
}

export async function copilotHistory(s: Services, userId: string) {
  const rows = await s.db
    .select()
    .from(copilotMessages)
    .where(eq(copilotMessages.userId, userId))
    .orderBy(asc(copilotMessages.createdAt))
    .limit(100);
  return rows.map((m) => ({ id: m.id, role: m.role, content: m.content, meta: m.meta, createdAt: m.createdAt.toISOString() }));
}
