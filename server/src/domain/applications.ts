import { and, asc, desc, eq } from "drizzle-orm";
import { summarizeDocumentForChat } from "../ai/shared.js";
import type { ChatTurn, FundContext, RecordDetailsInput } from "../ai/types.js";
import {
  type Application,
  applications,
  documents,
  type Fund,
  funds,
  type Message,
  messages,
  payouts,
} from "../db/schema.js";
import { badRequest, conflict, notFound, unauthorized } from "../lib/errors.js";
import { newId, newPublicRef, newSecretToken, sha256Hex } from "../lib/ids.js";
import { formatMoney, toCents } from "../lib/money.js";
import type { Services } from "../services.js";
import { audit } from "./audit.js";
import { normalizeReceiver } from "./risk.js";
import type { IntakeFacts, PayoutMethod } from "./types.js";
import { applicantView, caseSummary } from "./views.js";
import { say } from "./i18n.js";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_DOCUMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

export function fundContext(fund: Fund): FundContext {
  return {
    name: fund.name,
    region: fund.region,
    currency: fund.currency,
    policyText: fund.policyText,
    rubric: fund.rubric,
  };
}

function greeting(fund: Fund, language: string): string {
  return say(
    language,
    `Hi, I'm the ${fund.name} assistant. In a few words, tell me what happened and what you need help paying for. You can write in any language (puede escribir en español), or tap the mic to talk. What you share is only seen by the fund's volunteer reviewers.`,
    `Hola, soy el asistente de ${fund.name}. En pocas palabras, cuénteme qué pasó y qué necesita pagar. Puede escribir en cualquier idioma o tocar el micrófono para hablar. Lo que comparta solo lo ven las personas voluntarias que revisan las solicitudes.`,
  );
}

// ------------------------------------------------------------ loading

export async function loadFundBySlug(s: Services, slug: string): Promise<Fund> {
  const [fund] = await s.db.select().from(funds).where(eq(funds.slug, slug)).limit(1);
  if (!fund) throw notFound("Fund");
  return fund;
}

export async function loadFund(s: Services, id: string): Promise<Fund> {
  const [fund] = await s.db.select().from(funds).where(eq(funds.id, id)).limit(1);
  if (!fund) throw notFound("Fund");
  return fund;
}

export async function loadApplication(s: Services, id: string): Promise<Application> {
  const [app] = await s.db.select().from(applications).where(eq(applications.id, id)).limit(1);
  if (!app) throw notFound("Request");
  return app;
}

/** Applicants authenticate with the secret token from their private link. */
export async function loadApplicationForApplicant(s: Services, id: string, token: string | undefined): Promise<Application> {
  if (!token) throw unauthorized("Missing access token");
  const app = await loadApplication(s, id);
  if (app.accessTokenHash !== sha256Hex(token)) throw unauthorized("Invalid access token");
  return app;
}

export async function loadMessages(s: Services, applicationId: string): Promise<Message[]> {
  return s.db.select().from(messages).where(eq(messages.applicationId, applicationId)).orderBy(asc(messages.createdAt));
}

async function latestPayout(s: Services, applicationId: string) {
  const [p] = await s.db
    .select()
    .from(payouts)
    .where(eq(payouts.applicationId, applicationId))
    .orderBy(desc(payouts.createdAt))
    .limit(1);
  return p ?? null;
}

export async function buildApplicantView(s: Services, appId: string) {
  const app = await loadApplication(s, appId);
  const fund = await loadFund(s, app.fundId);
  const [msgs, docs, payout] = await Promise.all([
    loadMessages(s, app.id),
    s.db.select().from(documents).where(eq(documents.applicationId, app.id)).orderBy(asc(documents.createdAt)),
    latestPayout(s, app.id),
  ]);
  return applicantView(app, fund, msgs, docs, payout);
}

// ---------------------------------------------------------- publishing

export async function addMessage(
  s: Services,
  applicationId: string,
  role: Message["role"],
  content: string,
  meta: Record<string, unknown> = {},
  id = newId("msg"),
): Promise<Message> {
  const [row] = await s.db.insert(messages).values({ id, applicationId, role, content, meta }).returning();
  s.bus.publish(`app:${applicationId}`, "message.created", {
    id: row!.id,
    role: row!.role,
    content: row!.content,
    meta: row!.meta,
    createdAt: row!.createdAt.toISOString(),
  });
  return row!;
}

/** Pushes fresh state to the applicant's page and the reviewer console. */
export async function publishApplication(s: Services, appId: string): Promise<void> {
  const view = await buildApplicantView(s, appId);
  s.bus.publish(`app:${appId}`, "application.updated", view);
  const app = await loadApplication(s, appId);
  if (app.status !== "intake") {
    const fund = await loadFund(s, app.fundId);
    s.bus.publish("staff", "case.updated", caseSummary(app, fund));
  }
}

async function patchApplication(s: Services, appId: string, patch: Partial<Application>): Promise<Application> {
  const [row] = await s.db
    .update(applications)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(applications.id, appId))
    .returning();
  return row!;
}

// --------------------------------------------------------------- intake

export async function startApplication(
  s: Services,
  fundSlug: string,
  opts: { fingerprint?: string | null; language?: string | null },
): Promise<{ application: Application; token: string }> {
  const fund = await loadFundBySlug(s, fundSlug);
  if (fund.status !== "open") throw conflict("This fund is not accepting new requests right now.");
  const token = newSecretToken();
  const [app] = await s.db
    .insert(applications)
    .values({
      id: newId("app"),
      fundId: fund.id,
      publicRef: newPublicRef(),
      accessTokenHash: sha256Hex(token),
      language: opts.language?.slice(0, 8) || "en",
      clientFingerprint: opts.fingerprint ?? null,
    })
    .returning();
  await addMessage(s, app!.id, "assistant", greeting(fund, app!.language), { greeting: true });
  return { application: app!, token };
}

function missingFields(app: Application): string[] {
  const missing: string[] = [];
  if (!app.needSummary) missing.push("need_summary");
  if (!app.category) missing.push("category");
  if (app.amountRequestedCents == null) missing.push("amount_requested");
  if (!app.facts.location) missing.push("location");
  if (!app.facts.urgency) missing.push("urgency");
  return missing;
}

export async function postApplicantMessage(s: Services, app: Application, content: string): Promise<Message> {
  const text = content.trim();
  if (!text) throw badRequest("Message is empty");
  if (text.length > 4000) throw badRequest("Message is too long");
  if (!["intake", "needs_info", "in_review", "submitted"].includes(app.status)) {
    throw conflict("This request is closed for new messages.");
  }
  const msg = await addMessage(s, app.id, "user", text);
  if (app.status === "intake" || app.status === "needs_info") {
    scheduleIntakeTurn(s, app.id, { reassessAfter: app.status === "needs_info" });
  } else {
    // Under review: no AI turn, but reviewers see it immediately.
    s.bus.publish("staff", "case.message", { applicationId: app.id, publicRef: app.publicRef });
    await addMessage(
      s,
      app.id,
      "event",
      say(app.language, "Thanks, your message was added to your request. A reviewer will see it.", "Gracias, su mensaje se agregó a su solicitud. La persona que la revisa lo verá."),
      { ui: "notice" },
    );
  }
  return msg;
}

export function scheduleIntakeTurn(s: Services, appId: string, opts: { reassessAfter?: boolean } = {}): void {
  void s.jobs.run(appId, "intake-turn", async () => {
    await runIntakeTurn(s, appId);
    if (opts.reassessAfter) {
      const { requestAssessment } = await import("./assessment.js");
      const app = await loadApplication(s, appId);
      if (app.status === "needs_info") {
        await patchApplication(s, appId, { status: "submitted" });
        await requestAssessment(s, appId, { reason: "applicant answered follow-up questions" });
      }
    }
  });
}

/** Runs one assistant turn of the intake conversation, streaming to the applicant. */
export async function runIntakeTurn(s: Services, appId: string): Promise<void> {
  let app = await loadApplication(s, appId);
  const fund = await loadFund(s, app.fundId);
  const msgs = await loadMessages(s, appId);
  const docs = await s.db.select().from(documents).where(eq(documents.applicationId, appId));
  const turnId = newId("msg");
  const channel = `app:${appId}`;
  s.bus.publish(channel, "assistant.start", { turnId });

  const history: ChatTurn[] = msgs
    .filter((m) => !(m.role === "event" && m.meta?.hiddenFromAi))
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const text = await s.ai.intakeTurn({
      fund: fundContext(fund),
      publicRef: app.publicRef,
      facts: { ...app.facts, ...(app.language ? { language: app.language } : {}) } as IntakeFacts,
      documents: docs.map((d) => ({ filename: d.filename, extraction: d.extraction })),
      history,
      onDelta: (delta) => s.bus.publish(channel, "assistant.delta", { turnId, text: delta }),
      tools: {
        recordDetails: async (input) => {
          app = await applyRecordedDetails(s, app, fund, input);
          const missing = missingFields(app);
          return missing.length ? `Saved. Still unknown: ${missing.join(", ")}.` : "Saved. All key details are known.";
        },
        requestDocument: async (input) => {
          await addMessage(s, appId, "event", `Upload button shown for: ${input.document_kind}`, {
            ui: "request_document",
            kind: input.document_kind,
            reason: input.reason,
          });
          await publishApplication(s, appId);
          return "The upload button is now visible to the applicant.";
        },
        markReady: async (input) => {
          app = await loadApplication(s, appId);
          const missing = ["need_summary", "category", "amount_requested"].filter((f) =>
            missingFields(app).includes(f),
          );
          if (missing.length) return `Not ready yet. Record these first: ${missing.join(", ")}.`;
          if (!app.readyToSubmit) {
            app = await patchApplication(s, appId, { readyToSubmit: true });
            await addMessage(s, appId, "event", "Review-and-submit card shown to the applicant.", {
              ui: "ready",
              summary: input.summary_for_applicant,
            });
          }
          await publishApplication(s, appId);
          return "The applicant now sees the review-and-submit card.";
        },
      },
    });
    if (text) await addMessage(s, appId, "assistant", text, {}, turnId);
    else s.bus.publish(channel, "assistant.cancel", { turnId });
  } catch (err) {
    s.log.error({ err, appId }, "intake turn failed");
    s.bus.publish(channel, "assistant.cancel", { turnId });
    // Degrade gracefully: the applicant can still submit and a person will read everything.
    const firstUser = msgs.find((m) => m.role === "user")?.content;
    app = await loadApplication(s, appId);
    if (!app.needSummary && firstUser) {
      app = await patchApplication(s, appId, { needSummary: firstUser.slice(0, 500) });
    }
    if (!app.readyToSubmit && firstUser) {
      app = await patchApplication(s, appId, { readyToSubmit: true });
    }
    await addMessage(
      s,
      appId,
      "assistant",
      say(
        app.language,
        "Sorry, I'm having trouble responding right now. You can keep adding details, upload documents, and submit your request below. A volunteer will read everything you wrote.",
        "Perdón, ahora mismo tengo problemas para responder. Puede seguir agregando detalles, subir documentos y enviar su solicitud abajo. Una persona voluntaria leerá todo lo que escribió.",
      ),
      { degraded: true },
      turnId,
    );
  }
  await publishApplication(s, appId);
}

async function applyRecordedDetails(
  s: Services,
  app: Application,
  fund: Fund,
  input: RecordDetailsInput,
): Promise<Application> {
  const facts: IntakeFacts = { ...app.facts };
  const patch: Partial<Application> = {};
  if (input.first_name) {
    facts.firstName = input.first_name;
    patch.applicantName = app.applicantName ?? input.first_name;
  }
  if (input.category) {
    const known = fund.rubric.categories.find((c) => c.key === input.category);
    if (!known) {
      throw new Error(
        `Unknown category "${input.category}". Use one of: ${fund.rubric.categories.map((c) => c.key).join(", ")}`,
      );
    }
    facts.category = known.key;
    patch.category = known.key;
  }
  if (input.amount_requested != null && input.amount_requested > 0) {
    const cents = toCents(input.amount_requested);
    facts.amountRequestedCents = cents;
    patch.amountRequestedCents = cents;
  }
  if (input.need_summary) {
    facts.needSummary = input.need_summary;
    patch.needSummary = input.need_summary;
  }
  if (input.urgency) facts.urgency = input.urgency;
  if (input.due_date) facts.dueDate = input.due_date;
  if (input.location) facts.location = input.location;
  if (input.payee_type) facts.payeeType = input.payee_type;
  if (input.payee_name) facts.payeeName = input.payee_name;
  if (input.household_size) facts.householdSize = input.household_size;
  if (input.other_support_tried) facts.otherSupportTried = input.other_support_tried;
  if (input.circumstances) facts.circumstances = input.circumstances;
  if (input.language) patch.language = input.language.slice(0, 8);
  patch.facts = facts;
  const updated = await patchApplication(s, app.id, patch);
  await publishApplication(s, app.id);
  return updated;
}

// ------------------------------------------------------------ documents

export async function addDocument(
  s: Services,
  app: Application,
  file: { filename: string; mimeType: string; data: Buffer },
): Promise<string> {
  if (!["intake", "needs_info", "submitted", "in_review"].includes(app.status)) {
    throw conflict("Documents can't be added to this request anymore.");
  }
  if (!ALLOWED_DOCUMENT_TYPES.includes(file.mimeType)) {
    throw badRequest("Please upload a photo (JPG, PNG, WEBP) or a PDF.");
  }
  if (file.data.length === 0) throw badRequest("The file is empty.");
  if (file.data.length > MAX_DOCUMENT_BYTES) throw badRequest("Files can be up to 10 MB.");
  const id = newId("doc");
  const filename = file.filename.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "document";
  await s.db.insert(documents).values({
    id,
    applicationId: app.id,
    filename,
    mimeType: file.mimeType,
    sizeBytes: file.data.length,
    sha256: sha256Hex(file.data),
    data: file.data,
  });
  await addMessage(s, app.id, "event", say(app.language, `Uploaded ${filename}`, `Archivo subido: ${filename}`), { ui: "document", documentId: id, hiddenFromAi: true });
  await audit(s.db, {
    fundId: app.fundId,
    entityType: "application",
    entityId: app.id,
    actorType: "applicant",
    action: "document.uploaded",
    summary: `Applicant uploaded ${filename}`,
  });
  await publishApplication(s, app.id);
  void s.jobs.run(app.id, "document-analysis", () => processDocument(s, id));
  return id;
}

export async function processDocument(s: Services, documentId: string): Promise<void> {
  const [doc] = await s.db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) return;
  const app = await loadApplication(s, doc.applicationId);
  let extraction = null;
  try {
    extraction = await s.ai.extractDocument({
      filename: doc.filename,
      mimeType: doc.mimeType,
      data: doc.data,
      statedNeed: app.needSummary,
      statedAmountCents: app.amountRequestedCents,
      category: app.category,
      applicantFirstName: app.facts.firstName ?? null,
    });
    await s.db.update(documents).set({ status: "ready", extraction }).where(eq(documents.id, documentId));
  } catch (err) {
    s.log.warn({ err, documentId }, "document analysis failed");
    await s.db.update(documents).set({ status: "failed" }).where(eq(documents.id, documentId));
  }
  const note = summarizeDocumentForChat(doc.filename, extraction);
  await addMessage(s, app.id, "event", note, {
    ui: "document_analyzed",
    documentId,
    amountCents: extraction?.amountCents ?? null,
    issuer: extraction?.issuer ?? null,
    title: extraction?.title ?? doc.filename,
  });
  await publishApplication(s, app.id);
  if (app.status === "intake" || app.status === "needs_info") {
    // Let the assistant acknowledge what it saw and continue the conversation.
    await runIntakeTurn(s, app.id);
  } else if (app.status === "in_review" || app.status === "submitted") {
    const { requestAssessment } = await import("./assessment.js");
    await requestAssessment(s, app.id, { reason: "new document added" });
  }
}

// --------------------------------------------------------- payout setup

export async function setPayoutDestination(
  s: Services,
  app: Application,
  input:
    | { method: "paypal_email"; receiver: string }
    | { method: "venmo_phone"; receiver: string }
    | { method: "paypal_account"; payerId: string; email: string | null; name: string | null; verified: boolean },
): Promise<Application> {
  if (["paying", "paid", "denied", "withdrawn"].includes(app.status)) {
    throw conflict("The payout destination can't be changed now.");
  }
  let patch: Partial<Application>;
  let display: string;
  if (input.method === "paypal_account") {
    patch = {
      payoutMethod: "paypal_account",
      payoutReceiver: input.payerId,
      payoutVerified: input.verified,
      paypalPayerId: input.payerId,
      paypalEmail: input.email,
      paypalName: input.name,
    };
    display = `PayPal account ${input.email ?? input.payerId}`;
  } else if (input.method === "paypal_email") {
    const email = input.receiver.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Please enter a valid email address.");
    patch = { payoutMethod: "paypal_email", payoutReceiver: email, payoutVerified: false };
    display = `PayPal email ${email}`;
  } else {
    const digits = normalizeReceiver("venmo_phone", input.receiver) ?? "";
    if (!/^\d{10}$/.test(digits)) throw badRequest("Please enter a 10-digit US mobile number for Venmo.");
    patch = { payoutMethod: "venmo_phone" as PayoutMethod, payoutReceiver: digits, payoutVerified: false };
    display = `Venmo phone •••${digits.slice(-4)}`;
  }
  const updated = await patchApplication(s, app.id, patch);
  await audit(s.db, {
    fundId: app.fundId,
    entityType: "application",
    entityId: app.id,
    actorType: "applicant",
    action: "payout.destination_set",
    summary: `Payout destination set: ${display}`,
    data: { method: input.method, verified: patch.payoutVerified },
  });
  await publishApplication(s, app.id);
  // If the request was approved while waiting for a destination, pay now.
  if (updated.status === "approved") {
    const { disburse } = await import("./disbursement.js");
    void s.jobs.run(app.id, "disburse", () => disburse(s, app.id, { actor: "system" }));
  }
  return updated;
}

// --------------------------------------------------------------- submit

export async function submitApplication(
  s: Services,
  app: Application,
  input: {
    consentPublicStory: boolean;
    category?: string | null;
    amountCents?: number | null;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  },
): Promise<Application> {
  if (app.status !== "intake") throw conflict("This request was already submitted.");
  const fund = await loadFund(s, app.fundId);
  const userMessages = (await loadMessages(s, app.id)).filter((m) => m.role === "user");
  if (userMessages.length === 0) throw badRequest("Please describe what you need help with first.");

  const patch: Partial<Application> = {
    consentPublicStory: input.consentPublicStory,
    applicantName: input.name?.trim() || app.applicantName,
    applicantEmail: input.email?.trim().toLowerCase() || app.applicantEmail,
    applicantPhone: input.phone?.trim() || app.applicantPhone,
  };
  if (input.category) {
    if (!fund.rubric.categories.some((c) => c.key === input.category)) throw badRequest("Unknown category.");
    patch.category = input.category;
  }
  if (input.amountCents != null) {
    if (input.amountCents <= 0) throw badRequest("Amount must be positive.");
    patch.amountRequestedCents = input.amountCents;
  }
  const category = patch.category ?? app.category;
  const amount = patch.amountRequestedCents ?? app.amountRequestedCents;
  if (!category) throw badRequest("Please choose what the money is for.");
  if (!amount) throw badRequest("Please enter how much you need.");
  if (!app.payoutMethod) throw badRequest("Please choose how you'd like to receive the money.");
  if (!app.needSummary) patch.needSummary = userMessages[0]!.content.slice(0, 500);

  const updated = await patchApplication(s, app.id, {
    ...patch,
    status: "submitted",
    submittedAt: new Date(),
    readyToSubmit: true,
  });
  await audit(s.db, {
    fundId: app.fundId,
    entityType: "application",
    entityId: app.id,
    actorType: "applicant",
    action: "application.submitted",
    summary: `Request submitted for ${formatMoney(amount, fund.currency)} (${category})`,
  });
  await addMessage(
    s,
    app.id,
    "event",
    say(
      app.language,
      "Request submitted. Tideover's AI caseworker is preparing it for a volunteer reviewer.",
      "Solicitud enviada. El asistente de Tideover la está preparando para la persona voluntaria que la revisará.",
    ),
    { ui: "submitted", hiddenFromAi: true },
  );
  s.bus.publish("staff", "case.submitted", caseSummary(updated, fund));
  await publishApplication(s, app.id);
  const { requestAssessment } = await import("./assessment.js");
  await requestAssessment(s, app.id, { reason: "submitted" });
  return updated;
}

export async function withdrawApplication(s: Services, app: Application): Promise<void> {
  if (["paying", "paid", "unclaimed", "denied", "withdrawn"].includes(app.status)) {
    throw conflict("This request can't be withdrawn.");
  }
  await patchApplication(s, app.id, { status: "withdrawn" });
  await audit(s.db, {
    fundId: app.fundId,
    entityType: "application",
    entityId: app.id,
    actorType: "applicant",
    action: "application.withdrawn",
    summary: "Applicant withdrew the request",
  });
  await addMessage(s, app.id, "event", say(app.language, "You withdrew this request.", "Usted retiró esta solicitud."), { ui: "notice", hiddenFromAi: true });
  await publishApplication(s, app.id);
}

export { patchApplication, missingFields };

export async function listApplicationsByStatus(s: Services, fundId: string, status: Application["status"]) {
  return s.db
    .select()
    .from(applications)
    .where(and(eq(applications.fundId, fundId), eq(applications.status, status)))
    .orderBy(asc(applications.decidedAt));
}
