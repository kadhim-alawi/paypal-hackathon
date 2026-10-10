import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  ActorType,
  ApplicationStatus,
  Assessment,
  DocumentExtraction,
  DonationStatus,
  FundRubric,
  IntakeFacts,
  LedgerKind,
  PayoutMethod,
  PayoutStatus,
  RiskFlag,
  StaffRole,
} from "../domain/types.js";

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").$type<StaffRole>().notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const funds = pgTable("funds", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull(),
  description: text("description").notNull(),
  region: text("region").notNull(),
  currency: text("currency").notNull().default("USD"),
  policyText: text("policy_text").notNull(),
  rubric: jsonb("rubric").$type<FundRubric>().notNull(),
  maxGrantCents: integer("max_grant_cents").notNull(),
  autoApproveLimitCents: integer("auto_approve_limit_cents").notNull().default(0),
  approvalsRequired: integer("approvals_required").notNull().default(1),
  dualApprovalAboveCents: integer("dual_approval_above_cents").notNull().default(50_000),
  cooldownDays: integer("cooldown_days").notNull().default(180),
  status: text("status").$type<"open" | "paused">().notNull().default("open"),
  accentColor: text("accent_color").notNull().default("#0E7C66"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const applications = pgTable(
  "applications",
  {
    id: text("id").primaryKey(),
    fundId: text("fund_id")
      .notNull()
      .references(() => funds.id),
    publicRef: text("public_ref").notNull().unique(),
    accessTokenHash: text("access_token_hash").notNull(),
    status: text("status").$type<ApplicationStatus>().notNull().default("intake"),
    language: text("language").notNull().default("en"),
    applicantName: text("applicant_name"),
    applicantEmail: text("applicant_email"),
    applicantPhone: text("applicant_phone"),
    facts: jsonb("facts").$type<IntakeFacts>().notNull().default({}),
    category: text("category"),
    amountRequestedCents: integer("amount_requested_cents"),
    amountRecommendedCents: integer("amount_recommended_cents"),
    amountApprovedCents: integer("amount_approved_cents"),
    needSummary: text("need_summary"),
    readyToSubmit: boolean("ready_to_submit").notNull().default(false),
    assessment: jsonb("assessment").$type<Assessment>(),
    riskFlags: jsonb("risk_flags").$type<RiskFlag[]>().notNull().default([]),
    aiRecommendation: text("ai_recommendation"),
    aiConfidence: real("ai_confidence"),
    aiStatus: text("ai_status").$type<"idle" | "working" | "done" | "error">().notNull().default("idle"),
    payoutMethod: text("payout_method").$type<PayoutMethod>(),
    payoutReceiver: text("payout_receiver"),
    payoutVerified: boolean("payout_verified").notNull().default(false),
    paypalPayerId: text("paypal_payer_id"),
    paypalEmail: text("paypal_email"),
    paypalName: text("paypal_name"),
    consentPublicStory: boolean("consent_public_story").notNull().default(false),
    publicStory: text("public_story"),
    decisionNote: text("decision_note"),
    clientFingerprint: text("client_fingerprint"),
    submittedAt: ts("submitted_at"),
    decidedAt: ts("decided_at"),
    paidAt: ts("paid_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("applications_fund_status_idx").on(t.fundId, t.status),
    index("applications_payer_idx").on(t.paypalPayerId),
    index("applications_receiver_idx").on(t.payoutReceiver),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id),
    role: text("role").$type<"user" | "assistant" | "event">().notNull(),
    content: text("content").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_application_idx").on(t.applicationId, t.createdAt)],
);

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    data: bytea("data").notNull(),
    status: text("status").$type<"processing" | "ready" | "failed">().notNull().default("processing"),
    extraction: jsonb("extraction").$type<DocumentExtraction>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("documents_application_idx").on(t.applicationId), index("documents_sha_idx").on(t.sha256)],
);

export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id),
    reviewerId: text("reviewer_id").references(() => users.id),
    reviewerName: text("reviewer_name").notNull(),
    decision: text("decision").$type<"approve" | "deny" | "request_info" | "note">().notNull(),
    amountCents: integer("amount_cents"),
    note: text("note"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("reviews_application_idx").on(t.applicationId)],
);

export const donations = pgTable(
  "donations",
  {
    id: text("id").primaryKey(),
    fundId: text("fund_id")
      .notNull()
      .references(() => funds.id),
    applicationId: text("application_id").references(() => applications.id),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").$type<DonationStatus>().notNull().default("created"),
    donorName: text("donor_name"),
    donorEmail: text("donor_email"),
    donorMessage: text("donor_message"),
    anonymous: boolean("anonymous").notNull().default(false),
    source: text("source").$type<"web" | "agent">().notNull().default("web"),
    agentName: text("agent_name"),
    paypalOrderId: text("paypal_order_id").unique(),
    paypalCaptureId: text("paypal_capture_id"),
    feeCents: integer("fee_cents"),
    netCents: integer("net_cents"),
    createdAt: ts("created_at").notNull().defaultNow(),
    capturedAt: ts("captured_at"),
  },
  (t) => [index("donations_fund_idx").on(t.fundId, t.status)],
);

export const payouts = pgTable(
  "payouts",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id),
    fundId: text("fund_id")
      .notNull()
      .references(() => funds.id),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").$type<PayoutStatus>().notNull().default("pending"),
    senderBatchId: text("sender_batch_id").notNull().unique(),
    method: text("method").$type<PayoutMethod>().notNull(),
    receiver: text("receiver").notNull(),
    paypalBatchId: text("paypal_batch_id"),
    paypalItemId: text("paypal_item_id"),
    paypalTransactionId: text("paypal_transaction_id"),
    paypalTransactionStatus: text("paypal_transaction_status"),
    feeCents: integer("fee_cents"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: ts("created_at").notNull().defaultNow(),
    sentAt: ts("sent_at"),
    completedAt: ts("completed_at"),
    lastCheckedAt: ts("last_checked_at"),
  },
  (t) => [index("payouts_status_idx").on(t.status), index("payouts_application_idx").on(t.applicationId)],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    fundId: text("fund_id")
      .notNull()
      .references(() => funds.id),
    kind: text("kind").$type<LedgerKind>().notNull(),
    amountCents: integer("amount_cents").notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    memo: text("memo"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ledger_fund_idx").on(t.fundId),
    uniqueIndex("ledger_ref_kind_idx").on(t.kind, t.refType, t.refId),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    fundId: text("fund_id"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    summary: text("summary").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_created_idx").on(t.createdAt)],
);

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  resourceId: text("resource_id"),
  verified: boolean("verified").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  error: text("error"),
  receivedAt: ts("received_at").notNull().defaultNow(),
  processedAt: ts("processed_at"),
});

export const copilotMessages = pgTable(
  "copilot_messages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("copilot_user_idx").on(t.userId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Fund = typeof funds.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Donation = typeof donations.$inferSelect;
export type Payout = typeof payouts.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
