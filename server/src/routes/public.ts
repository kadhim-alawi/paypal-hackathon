import { asc } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { funds } from "../db/schema.js";
import { loadFundBySlug } from "../domain/applications.js";
import { fundFeed, fundStats, publicFund, sponsorableNeeds } from "../domain/funds.js";
import { streamEvents } from "../http/sse.js";
import type { Services } from "../services.js";

export async function publicRoutes(app: FastifyInstance, s: Services) {
  app.get("/api/health", async () => ({ ok: true, time: new Date().toISOString() }));

  /** What the client needs to know about this deployment. */
  app.get("/api/config", async () => ({
    publicUrl: s.config.publicUrl,
    paypal: { mode: s.paypal.mode, clientId: s.paypal.clientId },
    ai: { mode: s.ai.mode, model: s.ai.model },
    mcpUrl: `${s.config.publicUrl}/mcp`,
  }));

  app.get("/api/funds", async () => {
    const rows = await s.db.select().from(funds).orderBy(asc(funds.createdAt));
    return Promise.all(rows.map(async (f) => publicFund(f, await fundStats(s, f))));
  });

  app.get<{ Params: { slug: string } }>("/api/funds/:slug", async (req) => {
    const fund = await loadFundBySlug(s, req.params.slug);
    const [stats, feed, needs] = await Promise.all([fundStats(s, fund), fundFeed(s, fund), sponsorableNeeds(s, fund)]);
    return { ...publicFund(fund, stats), feed, needs, policyText: fund.policyText, criteria: fund.rubric.criteria };
  });

  app.get<{ Params: { slug: string } }>("/api/funds/:slug/events", async (req, reply) => {
    const fund = await loadFundBySlug(s, req.params.slug);
    await streamEvents(req, reply, s.bus, [`fund:${fund.id}`]);
  });
}
