import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { asc } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { funds } from "../db/schema.js";
import { loadFundBySlug } from "../domain/applications.js";
import { createDonation } from "../domain/donations.js";
import { fundFeed, fundStats, publicFund, sponsorableNeeds } from "../domain/funds.js";
import { formatMoney } from "../lib/money.js";
import { donationStatus } from "../routes/donations.js";
import type { Services } from "../services.js";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

/**
 * "Agentic giving": an MCP server that lets anyone's AI assistant (Claude,
 * ChatGPT, ...) discover verified needs and start a gift. The agent never
 * moves money by itself: it returns a PayPal checkout link that a human approves.
 */
export function buildMcpServer(s: Services): McpServer {
  const server = new McpServer(
    { name: "tideover", version: "1.0.0" },
    {
      instructions:
        "Tideover runs community emergency funds. Use list_funds and find_needs to see where money is needed, then create_donation to get a PayPal checkout link the user must open to approve the payment. Never claim a donation is complete until get_donation_status says captured.",
    },
  );

  server.registerTool(
    "list_funds",
    {
      title: "List emergency funds",
      description: "Community emergency funds on this Tideover server with live impact numbers (raised, granted, people helped, median minutes from request to cash).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const rows = await s.db.select().from(funds).orderBy(asc(funds.createdAt));
      const out = await Promise.all(
        rows.map(async (f) => {
          const pf = publicFund(f, await fundStats(s, f));
          return {
            slug: pf.slug,
            name: pf.name,
            region: pf.region,
            summary: pf.summary,
            status: pf.status,
            raised: formatMoney(pf.stats.raisedCents, pf.currency),
            granted: formatMoney(pf.stats.grantedCents, pf.currency),
            peopleHelped: pf.stats.peopleHelped,
            medianMinutesToCash: pf.stats.medianMinutesToCash,
            approvedNeedsWaitingForDonations: pf.stats.awaitingCount,
            page: `${s.config.publicUrl}/f/${pf.slug}`,
          };
        }),
      );
      return text(out);
    },
  );

  server.registerTool(
    "find_needs",
    {
      title: "Find approved needs waiting for donations",
      description:
        "Approved emergency grants that are waiting for money. Each has been reviewed by a person; details are anonymized. Funding one pays it out to the recipient immediately.",
      inputSchema: {
        fund_slug: z.string().optional().describe("Limit to one fund"),
        max_amount: z.number().positive().optional().describe("Maximum amount in USD"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ fund_slug, max_amount }) => {
      const rows = fund_slug ? [await loadFundBySlug(s, fund_slug)] : await s.db.select().from(funds);
      const needs = [];
      for (const f of rows) {
        for (const n of await sponsorableNeeds(s, f)) {
          if (max_amount && n.amountCents > max_amount * 100) continue;
          needs.push({
            need_id: n.id,
            fund_slug: f.slug,
            fund: f.name,
            category: n.categoryLabel,
            amount: formatMoney(n.amountCents, f.currency),
            amount_usd: n.amountCents / 100,
            story: n.story,
            approved_at: n.approvedAt,
          });
        }
      }
      return text(needs.length ? needs : { message: "No approved needs are waiting right now. A gift to a fund is used for the next approved request." });
    },
  );

  server.registerTool(
    "get_impact",
    {
      title: "Recent impact of a fund",
      description: "Live statistics and the latest anonymized grants and gifts for a fund.",
      inputSchema: { fund_slug: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ fund_slug }) => {
      const f = await loadFundBySlug(s, fund_slug);
      const stats = await fundStats(s, f);
      const feed = await fundFeed(s, f, 10);
      return text({ fund: f.name, stats, recent: feed.map((i) => ({ kind: i.kind, at: i.at, text: i.text })) });
    },
  );

  server.registerTool(
    "create_donation",
    {
      title: "Start a donation (returns a PayPal checkout link)",
      description:
        "Creates a gift to a fund, optionally earmarked for one approved need (need_id from find_needs). Returns a PayPal checkout URL. The user must open it and approve the payment with PayPal or Venmo; nothing is charged until they do.",
      inputSchema: {
        fund_slug: z.string(),
        amount_usd: z.number().min(1).max(10000),
        need_id: z.string().optional(),
        donor_name: z.string().max(80).optional(),
        message: z.string().max(280).optional(),
        anonymous: z.boolean().optional(),
        agent_name: z.string().max(60).optional().describe("Name of the AI assistant making the request, e.g. Claude"),
      },
    },
    async (args) => {
      const { donation, checkoutUrl } = await createDonation(s, {
        fundSlug: args.fund_slug,
        amountCents: Math.round(args.amount_usd * 100),
        applicationId: args.need_id ?? null,
        donorName: args.donor_name ?? null,
        donorMessage: args.message ?? null,
        anonymous: args.anonymous ?? false,
        source: "agent",
        agentName: args.agent_name ?? "AI assistant",
      });
      return text({
        donation_id: donation.id,
        amount: formatMoney(donation.amountCents, donation.currency),
        checkout_url: checkoutUrl,
        next_step: "Ask the user to open checkout_url and approve the payment with PayPal. Then call get_donation_status.",
      });
    },
  );

  server.registerTool(
    "get_donation_status",
    {
      title: "Check a donation",
      description: "Whether a donation has been paid, and (for earmarked gifts) whether the grant it funded has reached the recipient.",
      inputSchema: { donation_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ donation_id }) => text(await donationStatus(s, donation_id)),
  );

  return server;
}

export async function mcpRoutes(app: FastifyInstance, s: Services) {
  // Stateless Streamable HTTP: a fresh server + transport per request.
  app.post("/mcp", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const server = buildMcpServer(s);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err) {
      req.log.error({ err }, "MCP request failed");
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "Content-Type": "application/json" });
        reply.raw.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
      }
    }
  });
  const notAllowed = async (_req: unknown, reply: { code(n: number): { send(b: unknown): unknown } }) =>
    reply.code(405).send({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
