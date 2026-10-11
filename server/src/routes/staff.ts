import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  applications,
  auditEvents,
  documents,
  donations,
  funds,
  messages,
  payouts,
  reviews,
  users,
} from "../db/schema.js";
import { loadApplication, loadFund } from "../domain/applications.js";
import { requestAssessment } from "../domain/assessment.js";
import { copilotHistory, runCopilotTurn } from "../domain/copilot.js";
import { addNote, approvalsRequired, approve, deny, requestInfo } from "../domain/decisions.js";
import { disburse, syncPayout } from "../domain/disbursement.js";
import { fundStats, publicFund, updateFundSettings } from "../domain/funds.js";
import { ledgerRows } from "../domain/ledger-rows.js";
import type { ApplicationStatus, FundRubric } from "../domain/types.js";
import { caseSummary, donationView, payoutView, staffCaseView } from "../domain/views.js";
import { requireStaff, signStaffToken } from "../http/auth.js";
import { streamEvents } from "../http/sse.js";
import { badRequest, conflict, notFound, unauthorized } from "../lib/errors.js";
import { verifyPassword } from "../lib/passwords.js";
import { median } from "../lib/time.js";
import type { Services } from "../services.js";

const LedgerAskBody = z.object({
  question: z.string().trim().min(2).max(500),
  schema: z.record(z.string(), z.unknown()),
  state: z.record(z.string(), z.unknown()).optional(),
});
const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const ApproveBody = z.object({ amountCents: z.number().int().positive().nullish(), note: z.string().max(1000).nullish() });
const DenyBody = z.object({ reason: z.string().min(3).max(1000) });
const InfoBody = z.object({ questions: z.array(z.string().max(300)).min(1).max(5) });
const NoteBody = z.object({ note: z.string().min(1).max(2000) });
const CopilotBody = z.object({ content: z.string().min(1).max(4000) });
const RubricSchema = z.object({
  summary: z.string(),
  categories: z.array(
    z.object({
      key: z.string().min(1).max(40),
      label: z.string().min(1).max(80),
      maxCents: z.number().int().positive(),
      examples: z.array(z.string()),
      evidence: z.array(z.string()),
    }),
  ).min(1),
  criteria: z.array(z.object({ id: z.string(), text: z.string(), kind: z.enum(["required", "preferred", "disqualifying"]) })),
  requiredInfo: z.array(z.string()),
  maxGrantCents: z.number().int().positive(),
  cooldownDays: z.number().int().min(0),
});
const FundBody = z.object({
  name: z.string().min(2).max(120).optional(),
  tagline: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
  region: z.string().max(120).optional(),
  policyText: z.string().max(12000).optional(),
  rubric: RubricSchema.optional(),
  autoApproveLimitCents: z.number().int().min(0).optional(),
  dualApprovalAboveCents: z.number().int().min(0).optional(),
  status: z.enum(["open", "paused"]).optional(),
  accentColor: z.string().optional(),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw badRequest("Invalid request", r.error.issues);
  return r.data;
}

const DECIDED: ApplicationStatus[] = ["approved", "awaiting_funds", "paying", "paid", "unclaimed", "payout_failed", "denied"];

export async function staffRoutes(app: FastifyInstance, s: Services) {
  app.post("/api/auth/login", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (req) => {
    const body = parse(LoginBody, req.body);
    const [user] = await s.db.select().from(users).where(eq(users.email, body.email.toLowerCase())).limit(1);
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw unauthorized("Email or password is incorrect.");
    }
    return {
      token: await signStaffToken(s, user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  });

  app.get("/api/staff/me", async (req) => {
    const user = await requireStaff(s, req);
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  });

  app.get("/api/staff/events", async (req, reply) => {
    await requireStaff(s, req);
    await streamEvents(req, reply, s.bus, ["staff"]);
  });

  // ------------------------------------------------------------ dashboard
  app.get("/api/staff/dashboard", async (req) => {
    await requireStaff(s, req);
    const fundRows = await s.db.select().from(funds).orderBy(asc(funds.createdAt));
    const fundsOut = await Promise.all(fundRows.map(async (f) => publicFund(f, await fundStats(s, f))));

    const statusCounts = await s.db
      .select({ status: applications.status, n: sql<string>`count(*)` })
      .from(applications)
      .groupBy(applications.status);
    const byStatus = Object.fromEntries(statusCounts.map((r) => [r.status, Number(r.n)]));

    const since = new Date(Date.now() - 13 * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const paidRows = await s.db
      .select({ paidAt: applications.paidAt, amount: applications.amountApprovedCents, submittedAt: applications.submittedAt })
      .from(applications)
      .where(and(isNotNull(applications.paidAt), gte(applications.paidAt, since)));
    const submittedRows = await s.db
      .select({ submittedAt: applications.submittedAt })
      .from(applications)
      .where(and(isNotNull(applications.submittedAt), gte(applications.submittedAt, since)));
    const donationRows = await s.db
      .select({ at: donations.capturedAt, amount: donations.amountCents })
      .from(donations)
      .where(and(eq(donations.status, "captured"), gte(donations.capturedAt, since)));
    const series = Array.from({ length: 14 }, (_, i) => {
      const day = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
      return { date: day, requests: 0, grantsCents: 0, donationsCents: 0 };
    });
    const idx = (d: Date | null) => (d ? Math.floor((d.getTime() - since.getTime()) / 86_400_000) : -1);
    for (const r of submittedRows) {
      const i = idx(r.submittedAt);
      if (series[i]) series[i].requests++;
    }
    for (const r of paidRows) {
      const i = idx(r.paidAt);
      if (series[i]) series[i].grantsCents += r.amount ?? 0;
    }
    for (const r of donationRows) {
      const i = idx(r.at);
      if (series[i]) series[i].donationsCents += r.amount;
    }

    const allPaid = await s.db
      .select({ submittedAt: applications.submittedAt, paidAt: applications.paidAt })
      .from(applications)
      .where(inArray(applications.status, ["paid", "unclaimed"]));
    const minutes = allPaid
      .filter((r) => r.submittedAt && r.paidAt)
      .map((r) => (r.paidAt!.getTime() - r.submittedAt!.getTime()) / 60_000);

    const decided = await s.db
      .select({ status: applications.status, ai: applications.aiRecommendation })
      .from(applications)
      .where(and(inArray(applications.status, DECIDED), isNotNull(applications.aiRecommendation)));
    const agreed = decided.filter((d) =>
      d.ai === "approve" ? d.status !== "denied" : d.ai === "deny" ? d.status === "denied" : false,
    ).length;
    const comparable = decided.filter((d) => d.ai === "approve" || d.ai === "deny").length;

    const recent = await s.db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(12);
    return {
      funds: fundsOut,
      byStatus,
      series,
      medianMinutesToCash: median(minutes),
      aiAgreement: comparable ? agreed / comparable : null,
      aiDecisions: comparable,
      ai: { mode: s.ai.mode, model: s.ai.model },
      paypal: { mode: s.paypal.mode },
      recent: recent.map((a) => ({
        id: a.id,
        entityType: a.entityType,
        entityId: a.entityId,
        actorType: a.actorType,
        actorName: a.actorName,
        action: a.action,
        summary: a.summary,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  });

  // ---------------------------------------------------------------- cases
  app.get<{ Querystring: { status?: string; fund?: string; q?: string; limit?: string } }>(
    "/api/staff/cases",
    async (req) => {
      await requireStaff(s, req);
      const conds = [];
      if (req.query.status) {
        conds.push(inArray(applications.status, req.query.status.split(",") as ApplicationStatus[]));
      } else {
        conds.push(sql`${applications.status} <> 'intake'`);
      }
      if (req.query.fund) {
        const [f] = await s.db.select().from(funds).where(eq(funds.slug, req.query.fund)).limit(1);
        if (f) conds.push(eq(applications.fundId, f.id));
      }
      if (req.query.q) {
        const q = `%${req.query.q}%`;
        conds.push(or(ilike(applications.publicRef, q), ilike(applications.needSummary, q), ilike(applications.applicantName, q)));
      }
      const rows = await s.db
        .select()
        .from(applications)
        .where(and(...conds))
        .orderBy(desc(applications.submittedAt), desc(applications.createdAt))
        .limit(Math.min(200, Number(req.query.limit ?? 100)));
      const fundRows = await s.db.select().from(funds);
      const byId = new Map(fundRows.map((f) => [f.id, f]));
      return rows.map((a) => caseSummary(a, byId.get(a.fundId)!));
    },
  );

  app.get<{ Params: { id: string } }>("/api/staff/cases/:id", async (req) => {
    await requireStaff(s, req);
    const a = await loadApplication(s, req.params.id);
    const fund = await loadFund(s, a.fundId);
    const [msgs, docs, revs, pays, trail] = await Promise.all([
      s.db.select().from(messages).where(eq(messages.applicationId, a.id)).orderBy(asc(messages.createdAt)),
      s.db
        .select({
          id: documents.id,
          applicationId: documents.applicationId,
          filename: documents.filename,
          mimeType: documents.mimeType,
          sizeBytes: documents.sizeBytes,
          sha256: documents.sha256,
          status: documents.status,
          extraction: documents.extraction,
          createdAt: documents.createdAt,
        })
        .from(documents)
        .where(eq(documents.applicationId, a.id))
        .orderBy(asc(documents.createdAt)),
      s.db.select().from(reviews).where(eq(reviews.applicationId, a.id)).orderBy(asc(reviews.createdAt)),
      s.db.select().from(payouts).where(eq(payouts.applicationId, a.id)).orderBy(desc(payouts.createdAt)),
      s.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, a.id))
        .orderBy(asc(auditEvents.createdAt)),
    ]);
    const amount = a.amountRecommendedCents ?? a.amountRequestedCents ?? 0;
    return staffCaseView(
      a,
      fund,
      msgs,
      docs.map((d) => ({ ...d, data: Buffer.alloc(0) })),
      revs,
      pays,
      trail,
      approvalsRequired(fund, amount),
    );
  });

  const actorOf = (u: { id: string; name: string }) => ({ type: "staff" as const, id: u.id, name: u.name });

  app.post<{ Params: { id: string } }>("/api/staff/cases/:id/approve", async (req) => {
    const user = await requireStaff(s, req);
    const body = parse(ApproveBody, req.body ?? {});
    return approve(s, req.params.id, { actor: actorOf(user), amountCents: body.amountCents, note: body.note });
  });

  app.post<{ Params: { id: string } }>("/api/staff/cases/:id/deny", async (req) => {
    const user = await requireStaff(s, req);
    await deny(s, req.params.id, { actor: actorOf(user), reason: parse(DenyBody, req.body).reason });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/staff/cases/:id/request-info", async (req) => {
    const user = await requireStaff(s, req);
    await requestInfo(s, req.params.id, { actor: actorOf(user), questions: parse(InfoBody, req.body).questions });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/staff/cases/:id/note", async (req) => {
    const user = await requireStaff(s, req);
    await addNote(s, req.params.id, { actor: actorOf(user), note: parse(NoteBody, req.body).note });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/staff/cases/:id/reassess", async (req) => {
    await requireStaff(s, req);
    const a = await loadApplication(s, req.params.id);
    if (!["submitted", "in_review", "needs_info"].includes(a.status)) throw conflict("Only open cases can be re-assessed.");
    await requestAssessment(s, a.id, { reason: "requested by reviewer" });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/staff/cases/:id/retry-payout", async (req) => {
    await requireStaff(s, req);
    const a = await loadApplication(s, req.params.id);
    if (!["payout_failed", "awaiting_funds", "approved"].includes(a.status)) throw conflict("Nothing to retry.");
    void s.jobs.run(a.id, "disburse", () => disburse(s, a.id, { actor: "staff" }));
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/api/staff/documents/:id/file", async (req, reply) => {
    await requireStaff(s, req);
    const [doc] = await s.db.select().from(documents).where(eq(documents.id, req.params.id)).limit(1);
    if (!doc) throw notFound("Document");
    reply.header("Content-Type", doc.mimeType).header("Cache-Control", "private, max-age=600");
    return reply.send(doc.data);
  });

  // ------------------------------------------------------- money movement
  app.get("/api/staff/payouts", async (req) => {
    await requireStaff(s, req);
    const rows = await s.db
      .select({ p: payouts, ref: applications.publicRef, fundName: funds.name })
      .from(payouts)
      .innerJoin(applications, eq(applications.id, payouts.applicationId))
      .innerJoin(funds, eq(funds.id, payouts.fundId))
      .orderBy(desc(payouts.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...payoutView(r.p), publicRef: r.ref, fundName: r.fundName }));
  });

  app.post<{ Params: { id: string } }>("/api/staff/payouts/:id/sync", async (req) => {
    await requireStaff(s, req);
    const [p] = await s.db.select().from(payouts).where(eq(payouts.id, req.params.id)).limit(1);
    if (!p) throw notFound("Payout");
    await s.jobs.run(p.applicationId, "payout-sync", () => syncPayout(s, p.id));
    const [fresh] = await s.db.select().from(payouts).where(eq(payouts.id, p.id)).limit(1);
    return payoutView(fresh!);
  });

  app.get("/api/staff/donations", async (req) => {
    await requireStaff(s, req);
    const rows = await s.db
      .select({ d: donations, fundName: funds.name })
      .from(donations)
      .innerJoin(funds, eq(funds.id, donations.fundId))
      .orderBy(desc(donations.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...donationView(r.d, { staff: true }), fundName: r.fundName }));
  });

  // --------------------------------------------------------------- ledger
  // The treasurer's Ledger (AG Grid): every money movement, and "ask the ledger",
  // which turns a question into grid state via the AG Grid AI Toolkit schema.
  app.get("/api/staff/ledger", async (req) => {
    await requireStaff(s, req);
    return ledgerRows(s);
  });

  app.post("/api/staff/ledger/ask", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    await requireStaff(s, req);
    const body = parse(LedgerAskBody, req.body);
    if (JSON.stringify(body.schema).length > 200_000) throw badRequest("Grid schema is too large");
    try {
      const result = await s.ai.gridQuery({
        question: body.question,
        schema: body.schema,
        state: body.state ?? {},
        today: new Date().toISOString().slice(0, 10),
      });
      return { ...result, mode: s.ai.mode };
    } catch (err) {
      req.log.warn({ err }, "ledger question failed; answering with rules");
      const { heuristicGridQuery } = await import("../ai/grid-heuristic.js");
      const fallback = heuristicGridQuery({ question: body.question, schema: body.schema, state: body.state ?? {}, today: new Date().toISOString().slice(0, 10) });
      return { ...fallback, mode: "heuristic" };
    }
  });

  // ---------------------------------------------------------------- funds
  app.get("/api/staff/funds", async (req) => {
    await requireStaff(s, req);
    const rows = await s.db.select().from(funds).orderBy(asc(funds.createdAt));
    return Promise.all(
      rows.map(async (f) => ({
        ...publicFund(f, await fundStats(s, f)),
        policyText: f.policyText,
        rubric: f.rubric,
        dualApprovalAboveCents: f.dualApprovalAboveCents,
        approvalsRequired: f.approvalsRequired,
      })),
    );
  });

  app.put<{ Params: { id: string } }>("/api/staff/funds/:id", async (req) => {
    const user = await requireStaff(s, req, "admin");
    const body = parse(FundBody, req.body);
    const f = await updateFundSettings(s, req.params.id, { ...body, rubric: body.rubric as FundRubric | undefined }, user);
    return { ...publicFund(f, await fundStats(s, f)), policyText: f.policyText, rubric: f.rubric };
  });

  /** Turns plain-language policy into a rubric preview (not saved until PUT). */
  app.post<{ Params: { id: string } }>("/api/staff/funds/:id/compile-policy", async (req) => {
    await requireStaff(s, req, "admin");
    const f = await loadFund(s, req.params.id);
    const { policyText } = parse(z.object({ policyText: z.string().min(20).max(12000) }), req.body);
    const rubric = await s.ai.compilePolicy({ fundName: f.name, region: f.region, currency: f.currency, policyText });
    return { rubric, model: s.ai.model };
  });

  app.get<{ Querystring: { limit?: string } }>("/api/staff/audit", async (req) => {
    await requireStaff(s, req);
    const rows = await s.db
      .select()
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(Math.min(500, Number(req.query.limit ?? 200)));
    return rows.map((a) => ({
      id: a.id,
      fundId: a.fundId,
      entityType: a.entityType,
      entityId: a.entityId,
      actorType: a.actorType,
      actorName: a.actorName,
      action: a.action,
      summary: a.summary,
      createdAt: a.createdAt.toISOString(),
    }));
  });

  // -------------------------------------------------------------- copilot
  app.get("/api/staff/copilot", async (req) => {
    const user = await requireStaff(s, req);
    return copilotHistory(s, user.id);
  });

  app.post("/api/staff/copilot", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = await requireStaff(s, req);
    const { content } = parse(CopilotBody, req.body);
    void s.jobs.run(`copilot:${user.id}`, "copilot", () => runCopilotTurn(s, user, content));
    reply.code(202);
    return { ok: true };
  });

  app.get("/api/staff/copilot/events", async (req, reply) => {
    const user = await requireStaff(s, req);
    await streamEvents(req, reply, s.bus, [`copilot:${user.id}`]);
  });
}
