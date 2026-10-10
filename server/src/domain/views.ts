import type {
  Application,
  AuditEvent,
  DocumentRow,
  Donation,
  Fund,
  Message,
  Payout,
  Review,
} from "../db/schema.js";
import { say } from "./i18n.js";
import type { ApplicationStatus } from "./types.js";

export function maskReceiver(method: string | null, receiver: string | null, paypalEmail?: string | null): string | null {
  if (method === "paypal_account") return paypalEmail ? maskEmail(paypalEmail) : "Verified PayPal account";
  if (!receiver) return null;
  if (method === "venmo_phone") return `Venmo •••${receiver.slice(-4)}`;
  return maskEmail(receiver);
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return email;
  const visible = user.length <= 2 ? user[0] ?? "" : `${user[0]}${"•".repeat(Math.min(6, user.length - 2))}${user[user.length - 1]}`;
  return `${visible}@${domain}`;
}

/** Where a grant goes, in plain words (English for staff; pass the applicant's language for their messages). */
export function payoutLabel(
  app: Pick<Application, "payoutMethod" | "payoutReceiver" | "paypalEmail">,
  language: string | null = "en",
): string | null {
  switch (app.payoutMethod) {
    case "paypal_account":
      return `${say(language, "your PayPal account", "su cuenta de PayPal")}${app.paypalEmail ? ` (${maskEmail(app.paypalEmail)})` : ""}`;
    case "paypal_email":
      return `PayPal (${maskEmail(app.payoutReceiver ?? "")})`;
    case "venmo_phone":
      return `Venmo (•••${(app.payoutReceiver ?? "").slice(-4)})`;
    default:
      return null;
  }
}

export function minutesToCash(app: Pick<Application, "submittedAt" | "paidAt">): number | null {
  if (!app.submittedAt || !app.paidAt) return null;
  return Math.max(0, (app.paidAt.getTime() - app.submittedAt.getTime()) / 60_000);
}

type Step = { key: string; label: string; at: string | null; state: "done" | "current" | "todo" | "failed" };

/** Applicant-facing progress timeline. */
export function timeline(app: Application, payout: Payout | null): Step[] {
  const s = app.status;
  const l = app.language;
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  const decided = ["approved", "awaiting_funds", "paying", "paid", "unclaimed", "payout_failed"].includes(s);
  const steps: Step[] = [
    { key: "request", label: say(l, "Request written", "Solicitud escrita"), at: iso(app.createdAt), state: s === "intake" ? "current" : "done" },
    {
      key: "review",
      label: s === "needs_info" ? say(l, "More information needed", "Falta información") : say(l, "Reviewed", "Revisada"),
      at: iso(app.decidedAt),
      state:
        s === "denied"
          ? "failed"
          : decided
            ? "done"
            : ["submitted", "in_review", "needs_info"].includes(s)
              ? "current"
              : "todo",
    },
    {
      key: "sent",
      label: s === "awaiting_funds" ? say(l, "Waiting for donations", "Esperando donaciones") : say(l, "Money sent", "Dinero enviado"),
      at: iso(payout?.sentAt),
      state: ["paid", "unclaimed"].includes(s)
        ? "done"
        : s === "payout_failed"
          ? "failed"
          : ["paying", "approved", "awaiting_funds"].includes(s)
            ? "current"
            : "todo",
    },
    {
      key: "received",
      label: s === "unclaimed" ? say(l, "Claim it at PayPal", "Reclámelo en PayPal") : say(l, "Received", "Recibido"),
      at: iso(app.paidAt),
      state: s === "paid" ? "done" : s === "unclaimed" ? "current" : "todo",
    },
  ];
  return steps;
}

function documentRequest(messages: Message[], docs: DocumentRow[]) {
  const req = [...messages].reverse().find((m) => m.meta?.ui === "request_document");
  if (!req) return null;
  const uploadedAfter = docs.some((d) => d.createdAt >= req.createdAt);
  if (uploadedAfter) return null;
  return { kind: String(req.meta.kind ?? "document"), reason: String(req.meta.reason ?? "") };
}

export function applicantView(
  app: Application,
  fund: Fund,
  messages: Message[],
  docs: DocumentRow[],
  payout: Payout | null,
) {
  const category = fund.rubric.categories.find((c) => c.key === app.category);
  return {
    id: app.id,
    publicRef: app.publicRef,
    status: app.status,
    language: app.language,
    fund: {
      slug: fund.slug,
      name: fund.name,
      region: fund.region,
      currency: fund.currency,
      accentColor: fund.accentColor,
      categories: fund.rubric.categories.map((c) => ({ key: c.key, label: c.label, maxCents: c.maxCents })),
      maxGrantCents: fund.maxGrantCents,
    },
    request: {
      firstName: app.facts.firstName ?? app.applicantName ?? null,
      category: app.category,
      categoryLabel: category?.label ?? null,
      amountRequestedCents: app.amountRequestedCents,
      needSummary: app.needSummary,
      urgency: app.facts.urgency ?? null,
      location: app.facts.location ?? null,
    },
    readyToSubmit: app.readyToSubmit,
    documentRequest: app.status === "intake" || app.status === "needs_info" ? documentRequest(messages, docs) : null,
    payout: {
      method: app.payoutMethod,
      display: maskReceiver(app.payoutMethod, app.payoutReceiver, app.paypalEmail),
      verified: app.payoutVerified,
      paypalName: app.paypalName,
    },
    consentPublicStory: app.consentPublicStory,
    documents: docs.map((d) => ({
      id: d.id,
      filename: d.filename,
      mimeType: d.mimeType,
      status: d.status,
      summary: d.extraction?.summary ?? null,
      createdAt: d.createdAt.toISOString(),
    })),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      meta: m.meta,
      createdAt: m.createdAt.toISOString(),
    })),
    decision: {
      amountApprovedCents: app.amountApprovedCents,
      note: app.decisionNote,
      decidedAt: app.decidedAt?.toISOString() ?? null,
    },
    payoutStatus: payout?.status ?? null,
    submittedAt: app.submittedAt?.toISOString() ?? null,
    paidAt: app.paidAt?.toISOString() ?? null,
    minutesToCash: minutesToCash(app),
    timeline: timeline(app, payout),
  };
}

export function caseSummary(app: Application, fund: Pick<Fund, "rubric" | "name" | "slug">) {
  const category = fund.rubric.categories.find((c) => c.key === app.category);
  const flags = app.riskFlags ?? [];
  return {
    id: app.id,
    publicRef: app.publicRef,
    fundName: fund.name,
    fundSlug: fund.slug,
    status: app.status as ApplicationStatus,
    language: app.language,
    firstName: app.facts.firstName ?? app.applicantName ?? null,
    category: app.category,
    categoryLabel: category?.label ?? app.category,
    amountRequestedCents: app.amountRequestedCents,
    amountRecommendedCents: app.amountRecommendedCents,
    amountApprovedCents: app.amountApprovedCents,
    needSummary: app.needSummary,
    aiRecommendation: app.aiRecommendation,
    aiConfidence: app.aiConfidence,
    aiStatus: app.aiStatus,
    riskLevel: flags.some((f) => f.severity === "block")
      ? "high"
      : flags.some((f) => f.severity === "warn")
        ? "medium"
        : "low",
    riskCount: flags.filter((f) => f.severity !== "info").length,
    payoutMethod: app.payoutMethod,
    payoutVerified: app.payoutVerified,
    location: app.facts.location ?? null,
    urgency: app.facts.urgency ?? null,
    submittedAt: app.submittedAt?.toISOString() ?? null,
    decidedAt: app.decidedAt?.toISOString() ?? null,
    paidAt: app.paidAt?.toISOString() ?? null,
    createdAt: app.createdAt.toISOString(),
    minutesToCash: minutesToCash(app),
  };
}

export function staffCaseView(
  app: Application,
  fund: Fund,
  messages: Message[],
  docs: DocumentRow[],
  reviews: Review[],
  payouts: Payout[],
  auditTrail: AuditEvent[],
  approvalsNeeded: number,
) {
  return {
    ...caseSummary(app, fund),
    fund: {
      id: fund.id,
      slug: fund.slug,
      name: fund.name,
      currency: fund.currency,
      criteria: fund.rubric.criteria,
      categories: fund.rubric.categories,
      maxGrantCents: fund.maxGrantCents,
      autoApproveLimitCents: fund.autoApproveLimitCents,
      dualApprovalAboveCents: fund.dualApprovalAboveCents,
    },
    facts: app.facts,
    assessment: app.assessment,
    riskFlags: app.riskFlags,
    applicant: {
      name: app.applicantName,
      email: app.applicantEmail,
      phone: app.applicantPhone,
      paypalName: app.paypalName,
      paypalEmail: app.paypalEmail,
      paypalPayerId: app.paypalPayerId,
    },
    payout: {
      method: app.payoutMethod,
      receiver: app.payoutMethod === "paypal_account" ? app.paypalEmail ?? app.paypalPayerId : app.payoutReceiver,
      verified: app.payoutVerified,
    },
    consentPublicStory: app.consentPublicStory,
    publicStory: app.publicStory,
    decisionNote: app.decisionNote,
    approvalsNeeded,
    documents: docs.map((d) => ({
      id: d.id,
      filename: d.filename,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      status: d.status,
      extraction: d.extraction,
      createdAt: d.createdAt.toISOString(),
    })),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      meta: m.meta,
      createdAt: m.createdAt.toISOString(),
    })),
    reviews: reviews.map((r) => ({
      id: r.id,
      reviewerName: r.reviewerName,
      reviewerId: r.reviewerId,
      decision: r.decision,
      amountCents: r.amountCents,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    })),
    payouts: payouts.map(payoutView),
    audit: auditTrail.map((a) => ({
      id: a.id,
      actorType: a.actorType,
      actorName: a.actorName,
      action: a.action,
      summary: a.summary,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export function payoutView(p: Payout) {
  return {
    id: p.id,
    applicationId: p.applicationId,
    amountCents: p.amountCents,
    currency: p.currency,
    status: p.status,
    method: p.method,
    receiver: p.method === "paypal_account" ? "PayPal account" : p.receiver,
    senderBatchId: p.senderBatchId,
    paypalBatchId: p.paypalBatchId,
    paypalItemId: p.paypalItemId,
    paypalTransactionId: p.paypalTransactionId,
    paypalTransactionStatus: p.paypalTransactionStatus,
    feeCents: p.feeCents,
    errorCode: p.errorCode,
    errorMessage: p.errorMessage,
    createdAt: p.createdAt.toISOString(),
    sentAt: p.sentAt?.toISOString() ?? null,
    completedAt: p.completedAt?.toISOString() ?? null,
  };
}

export function donationView(d: Donation, opts: { staff: boolean }) {
  return {
    id: d.id,
    applicationId: d.applicationId,
    amountCents: d.amountCents,
    currency: d.currency,
    status: d.status,
    donorName: d.anonymous && !opts.staff ? null : d.donorName,
    donorEmail: opts.staff ? d.donorEmail : null,
    donorMessage: d.donorMessage,
    anonymous: d.anonymous,
    source: d.source,
    agentName: d.agentName,
    paypalOrderId: opts.staff ? d.paypalOrderId : null,
    paypalCaptureId: opts.staff ? d.paypalCaptureId : null,
    feeCents: opts.staff ? d.feeCents : null,
    netCents: opts.staff ? d.netCents : null,
    createdAt: d.createdAt.toISOString(),
    capturedAt: d.capturedAt?.toISOString() ?? null,
  };
}
