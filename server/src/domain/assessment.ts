import { and, asc, count, eq, gte, inArray, ne } from "drizzle-orm";
import { applications, auditEvents, documents, type Fund } from "../db/schema.js";
import type { Application, DocumentRow } from "../db/schema.js";
import type { Services } from "../services.js";
import {
  addMessage,
  fundContext,
  loadApplication,
  loadFund,
  loadMessages,
  patchApplication,
  publishApplication,
} from "./applications.js";
import { audit } from "./audit.js";
import { computeRiskFlags } from "./risk.js";
import type { Assessment, RiskFlag } from "./types.js";
import { caseSummary } from "./views.js";

/** Queues an assessment. Never awaits the job, so it is safe to call from inside other jobs. */
export async function requestAssessment(s: Services, appId: string, opts: { reason: string }): Promise<void> {
  void s.jobs.run(appId, "assessment", () => runAssessment(s, appId, opts.reason));
}

export function capAmount(fund: Fund, category: string | null, cents: number): number {
  const cat = fund.rubric.categories.find((c) => c.key === category);
  return Math.max(0, Math.min(cents, cat?.maxCents ?? fund.maxGrantCents, fund.maxGrantCents));
}

/**
 * Deterministic auto-approval gate. The AI's recommendation is necessary but
 * never sufficient: small amount, clean risk checks, verified PayPal identity
 * and evidence are all required, and organizers set the limit (0 = never).
 */
export function autoApprovalDecision(
  fund: Fund,
  app: Application,
  assessment: Assessment | null,
  flags: RiskFlag[],
  docs: DocumentRow[],
): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (fund.autoApproveLimitCents <= 0) reasons.push("auto-approval is off for this fund");
  if (!assessment) reasons.push("no AI assessment");
  else {
    if (assessment.recommendation !== "approve") reasons.push(`AI recommends ${assessment.recommendation}`);
    if (assessment.confidence < 0.8) reasons.push(`AI confidence ${assessment.confidence.toFixed(2)} < 0.80`);
    if (assessment.recommendedAmountCents > fund.autoApproveLimitCents) reasons.push("amount above auto-approval limit");
    if (assessment.recommendedAmountCents <= 0) reasons.push("no amount recommended");
  }
  if (flags.some((f) => f.severity !== "info")) reasons.push("risk checks raised warnings");
  if (!(app.payoutMethod === "paypal_account" && app.payoutVerified)) reasons.push("payout account not verified with PayPal");
  const category = fund.rubric.categories.find((c) => c.key === app.category);
  if ((category?.evidence.length ?? 0) > 0 && !docs.some((d) => d.status === "ready")) {
    reasons.push("no supporting document");
  }
  return { eligible: reasons.length === 0, reasons };
}

async function priorGrants(s: Services, fund: Fund, app: Application) {
  const identity = app.paypalPayerId ?? app.payoutReceiver;
  if (!identity) return { count: 0, totalCents: 0, lastPaidAt: null };
  const rows = await s.db
    .select({ amount: applications.amountApprovedCents, paidAt: applications.paidAt })
    .from(applications)
    .where(
      and(
        eq(applications.fundId, fund.id),
        ne(applications.id, app.id),
        inArray(applications.status, ["paid", "unclaimed"]),
        app.paypalPayerId
          ? eq(applications.paypalPayerId, app.paypalPayerId)
          : eq(applications.payoutReceiver, app.payoutReceiver!),
      ),
    );
  const last = rows.map((r) => r.paidAt).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0];
  return {
    count: rows.length,
    totalCents: rows.reduce((sum, r) => sum + (r.amount ?? 0), 0),
    lastPaidAt: last ? last.toISOString().slice(0, 10) : null,
  };
}

async function infoRequestsSoFar(s: Services, appId: string): Promise<number> {
  const [row] = await s.db
    .select({ n: count() })
    .from(auditEvents)
    .where(and(eq(auditEvents.entityId, appId), eq(auditEvents.action, "ai.requested_info")));
  return Number(row?.n ?? 0);
}

export async function runAssessment(s: Services, appId: string, reason: string): Promise<void> {
  let app = await loadApplication(s, appId);
  if (!["submitted", "in_review", "needs_info"].includes(app.status)) return;
  const fund = await loadFund(s, app.fundId);
  const [msgs, docs] = await Promise.all([
    loadMessages(s, app.id),
    s.db.select().from(documents).where(eq(documents.applicationId, app.id)).orderBy(asc(documents.createdAt)),
  ]);

  app = await patchApplication(s, app.id, { aiStatus: "working" });
  await publishApplication(s, app.id);

  const riskFlags = await computeRiskFlags(s.db, fund, app, docs);
  let assessment: Assessment | null = null;
  try {
    assessment = await s.ai.assess({
      fund: fundContext(fund),
      publicRef: app.publicRef,
      facts: app.facts,
      category: app.category,
      amountRequestedCents: app.amountRequestedCents,
      needSummary: app.needSummary,
      payout: { method: app.payoutMethod, verified: app.payoutVerified },
      transcript: msgs
        .filter((m) => !(m.role === "event" && m.meta?.hiddenFromAi))
        .map((m) => ({ role: m.role, content: m.content })),
      documents: docs.map((d) => ({ filename: d.filename, extraction: d.extraction })),
      riskFlags,
      priorGrants: await priorGrants(s, fund, app),
    });
  } catch (err) {
    s.log.error({ err, appId }, "AI assessment failed");
  }

  // Blocking risk flags always win over the AI.
  if (assessment && riskFlags.some((f) => f.severity === "block") && assessment.recommendation === "approve") {
    assessment = {
      ...assessment,
      recommendation: "needs_info",
      reviewerNote: `Automated checks raised a blocking flag; a person must decide. ${assessment.reviewerNote}`,
      questionsForApplicant: [],
    };
  }
  const recommended = assessment ? capAmount(fund, app.category, assessment.recommendedAmountCents) : null;
  if (assessment && recommended !== null) assessment = { ...assessment, recommendedAmountCents: recommended };

  app = await patchApplication(s, app.id, {
    riskFlags,
    assessment,
    aiRecommendation: assessment?.recommendation ?? null,
    aiConfidence: assessment?.confidence ?? null,
    amountRecommendedCents: recommended,
    aiStatus: assessment ? "done" : "error",
  });
  await audit(s.db, {
    fundId: fund.id,
    entityType: "application",
    entityId: app.id,
    actorType: "ai",
    actorName: s.ai.model,
    action: "ai.assessed",
    summary: assessment
      ? `AI caseworker recommends ${assessment.recommendation}${recommended ? ` (${(recommended / 100).toFixed(2)} ${fund.currency})` : ""}, confidence ${assessment.confidence.toFixed(2)} [${reason}]`
      : `AI assessment unavailable; routed to a person [${reason}]`,
    data: { riskFlags: riskFlags.map((f) => f.code), reason },
  });

  // ---- routing
  const wasSubmitted = app.status === "submitted";
  if (
    wasSubmitted &&
    assessment?.recommendation === "needs_info" &&
    assessment.questionsForApplicant.length > 0 &&
    (await infoRequestsSoFar(s, app.id)) < 2
  ) {
    app = await patchApplication(s, app.id, { status: "needs_info" });
    const text = await s.ai
      .decisionMessage({
        fundName: fund.name,
        language: app.language,
        firstName: app.facts.firstName,
        kind: "needs_info",
        currency: fund.currency,
        questions: assessment.questionsForApplicant,
      })
      .catch(() => `We need a little more information:\n${assessment!.questionsForApplicant.join("\n")}`);
    await addMessage(s, app.id, "assistant", text, { ui: "questions", questions: assessment.questionsForApplicant });
    await audit(s.db, {
      fundId: fund.id,
      entityType: "application",
      entityId: app.id,
      actorType: "ai",
      actorName: s.ai.model,
      action: "ai.requested_info",
      summary: `AI caseworker asked the applicant ${assessment.questionsForApplicant.length} follow-up question(s)`,
    });
    await publishApplication(s, app.id);
    return;
  }

  const auto = autoApprovalDecision(fund, app, assessment, riskFlags, docs);
  if (wasSubmitted && auto.eligible && assessment) {
    const { approve } = await import("./decisions.js");
    await approve(s, app.id, {
      actor: { type: "ai", id: null, name: "Tideover policy engine" },
      amountCents: assessment.recommendedAmountCents,
      note: "Auto-approved: within the fund's auto-approval limit, verified PayPal account, clean risk checks, AI confidence ≥ 0.80.",
      fromJob: true,
    });
    return;
  }

  if (app.status !== "in_review") {
    app = await patchApplication(s, app.id, { status: "in_review" });
    await addMessage(
      s,
      app.id,
      "event",
      "Your request is with a volunteer reviewer now. Most requests are reviewed within a few hours.",
      { ui: "in_review", hiddenFromAi: true },
    );
  }
  s.bus.publish("staff", "case.ready", caseSummary(app, fund));
  await publishApplication(s, app.id);
}

export async function countRecentSubmissions(s: Services, fundId: string, since: Date): Promise<number> {
  const [row] = await s.db
    .select({ n: count() })
    .from(applications)
    .where(and(eq(applications.fundId, fundId), gte(applications.submittedAt, since)));
  return Number(row?.n ?? 0);
}
