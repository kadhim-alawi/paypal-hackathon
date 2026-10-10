import { and, eq, gte } from "drizzle-orm";
import { reviews } from "../db/schema.js";
import { badRequest, conflict } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { formatMoney } from "../lib/money.js";
import type { Services } from "../services.js";
import { addMessage, loadApplication, loadFund, patchApplication, publishApplication } from "./applications.js";
import { capAmount } from "./assessment.js";
import { audit } from "./audit.js";
import { disburse } from "./disbursement.js";
import { payoutLabel } from "./views.js";

export interface DecisionActor {
  type: "staff" | "ai";
  id: string | null;
  name: string;
}

const DECIDABLE = ["submitted", "needs_info", "in_review"];

/** How many distinct staff approvals this amount needs (two-person rule). */
export function approvalsRequired(fund: { approvalsRequired: number; dualApprovalAboveCents: number }, amountCents: number) {
  return Math.max(fund.approvalsRequired, amountCents > fund.dualApprovalAboveCents ? 2 : 1);
}

export async function approve(
  s: Services,
  appId: string,
  input: { actor: DecisionActor; amountCents?: number | null; note?: string | null; fromJob?: boolean },
): Promise<{ status: "approved" | "pending_second_approval"; approvals: number; required: number }> {
  let app = await loadApplication(s, appId);
  if (!DECIDABLE.includes(app.status)) throw conflict(`A ${app.status} request can't be approved.`);
  const fund = await loadFund(s, app.fundId);
  const requested = input.amountCents ?? app.amountRecommendedCents ?? app.amountRequestedCents ?? 0;
  if (requested <= 0) throw badRequest("Approval amount must be positive.");
  const amount = capAmount(fund, app.category, requested);
  if (amount < requested) {
    throw badRequest(`Amount exceeds the cap for this category (${formatMoney(amount, fund.currency)}).`);
  }

  await s.db.insert(reviews).values({
    id: newId("rev"),
    applicationId: app.id,
    reviewerId: input.actor.type === "staff" ? input.actor.id : null,
    reviewerName: input.actor.name,
    decision: "approve",
    amountCents: amount,
    note: input.note ?? null,
  });

  const required = input.actor.type === "ai" ? 1 : approvalsRequired(fund, amount);
  // Count distinct staff approvals at this amount since submission.
  const approvals = await s.db
    .select({ reviewerId: reviews.reviewerId, amountCents: reviews.amountCents })
    .from(reviews)
    .where(
      and(
        eq(reviews.applicationId, app.id),
        eq(reviews.decision, "approve"),
        gte(reviews.createdAt, app.submittedAt ?? app.createdAt),
      ),
    );
  const distinct = new Set(
    approvals.filter((r) => r.amountCents === amount).map((r) => r.reviewerId ?? "policy-engine"),
  ).size;

  if (distinct < required) {
    await audit(s.db, {
      fundId: fund.id,
      entityType: "application",
      entityId: app.id,
      actorType: input.actor.type,
      actorId: input.actor.id,
      actorName: input.actor.name,
      action: "decision.approval_recorded",
      summary: `${input.actor.name} approved ${formatMoney(amount, fund.currency)} (${distinct} of ${required} approvals)`,
    });
    if (app.status !== "in_review") await patchApplication(s, app.id, { status: "in_review" });
    await publishApplication(s, app.id);
    return { status: "pending_second_approval", approvals: distinct, required };
  }

  app = await patchApplication(s, app.id, {
    status: "approved",
    amountApprovedCents: amount,
    decidedAt: new Date(),
    decisionNote: input.note ?? null,
  });
  await audit(s.db, {
    fundId: fund.id,
    entityType: "application",
    entityId: app.id,
    actorType: input.actor.type,
    actorId: input.actor.id,
    actorName: input.actor.name,
    action: "decision.approved",
    summary: `${input.actor.name} approved ${formatMoney(amount, fund.currency)}`,
    data: { amountCents: amount, approvals: distinct },
  });

  const message = await s.ai
    .decisionMessage({
      fundName: fund.name,
      language: app.language,
      firstName: app.facts.firstName,
      kind: "approved",
      amountCents: amount,
      currency: fund.currency,
      payoutLabel: payoutLabel(app, app.language),
    })
    .catch(() => `Good news: your request was approved for ${formatMoney(amount, fund.currency)}. We're sending the money now.`);
  await addMessage(s, app.id, "assistant", message, { ui: "approved", amountCents: amount });
  await publishApplication(s, app.id);

  const run = () => disburse(s, app.id, { actor: input.actor.type === "ai" ? "ai" : "staff" });
  if (input.fromJob) await run();
  else void s.jobs.run(app.id, "disburse", run);
  return { status: "approved", approvals: distinct, required };
}

export async function deny(s: Services, appId: string, input: { actor: DecisionActor; reason: string }): Promise<void> {
  const app = await loadApplication(s, appId);
  if (!DECIDABLE.includes(app.status)) throw conflict(`A ${app.status} request can't be declined.`);
  const reason = input.reason.trim();
  if (!reason) throw badRequest("Please give the applicant a reason.");
  const fund = await loadFund(s, app.fundId);
  await s.db.insert(reviews).values({
    id: newId("rev"),
    applicationId: app.id,
    reviewerId: input.actor.id,
    reviewerName: input.actor.name,
    decision: "deny",
    note: reason,
  });
  await patchApplication(s, app.id, { status: "denied", decidedAt: new Date(), decisionNote: reason });
  await audit(s.db, {
    fundId: fund.id,
    entityType: "application",
    entityId: app.id,
    actorType: input.actor.type,
    actorId: input.actor.id,
    actorName: input.actor.name,
    action: "decision.denied",
    summary: `${input.actor.name} declined the request: ${reason}`,
  });
  const message = await s.ai
    .decisionMessage({
      fundName: fund.name,
      language: app.language,
      firstName: app.facts.firstName,
      kind: "denied",
      currency: fund.currency,
      reason,
    })
    .catch(() => `We're sorry, we couldn't approve this request. ${reason} You can call 211 for other local help.`);
  await addMessage(s, app.id, "assistant", message, { ui: "denied" });
  await publishApplication(s, app.id);
}

export async function requestInfo(
  s: Services,
  appId: string,
  input: { actor: DecisionActor; questions: string[] },
): Promise<void> {
  const app = await loadApplication(s, appId);
  if (!DECIDABLE.includes(app.status)) throw conflict(`Can't ask questions on a ${app.status} request.`);
  const questions = input.questions.map((q) => q.trim()).filter(Boolean).slice(0, 5);
  if (questions.length === 0) throw badRequest("Add at least one question.");
  const fund = await loadFund(s, app.fundId);
  await s.db.insert(reviews).values({
    id: newId("rev"),
    applicationId: app.id,
    reviewerId: input.actor.id,
    reviewerName: input.actor.name,
    decision: "request_info",
    note: questions.join("\n"),
  });
  await patchApplication(s, app.id, { status: "needs_info" });
  await audit(s.db, {
    fundId: fund.id,
    entityType: "application",
    entityId: app.id,
    actorType: input.actor.type,
    actorId: input.actor.id,
    actorName: input.actor.name,
    action: "decision.requested_info",
    summary: `${input.actor.name} asked ${questions.length} question(s)`,
  });
  const message = await s.ai
    .decisionMessage({
      fundName: fund.name,
      language: app.language,
      firstName: app.facts.firstName,
      kind: "needs_info",
      currency: fund.currency,
      questions,
    })
    .catch(() => `A reviewer has a few questions:\n${questions.join("\n")}`);
  await addMessage(s, app.id, "assistant", message, { ui: "questions", questions });
  await publishApplication(s, app.id);
}

export async function addNote(s: Services, appId: string, input: { actor: DecisionActor; note: string }): Promise<void> {
  const app = await loadApplication(s, appId);
  const note = input.note.trim();
  if (!note) throw badRequest("Note is empty.");
  await s.db.insert(reviews).values({
    id: newId("rev"),
    applicationId: app.id,
    reviewerId: input.actor.id,
    reviewerName: input.actor.name,
    decision: "note",
    note,
  });
  await audit(s.db, {
    fundId: app.fundId,
    entityType: "application",
    entityId: app.id,
    actorType: input.actor.type,
    actorId: input.actor.id,
    actorName: input.actor.name,
    action: "case.note",
    summary: `${input.actor.name} added a note`,
  });
  await publishApplication(s, app.id);
}
