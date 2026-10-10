/** Shared domain types (also persisted as JSON columns). */

export type ApplicationStatus =
  | "intake" // chatting with the intake assistant, not submitted yet
  | "submitted" // submitted; AI caseworker is preparing the case file
  | "needs_info" // waiting for the applicant to answer follow-up questions
  | "in_review" // in the human review queue
  | "approved" // approved; waiting for a payout destination
  | "awaiting_funds" // approved but the fund is short; shown to donors as a sponsorable need
  | "paying" // payout is in flight at PayPal
  | "paid"
  | "unclaimed" // payout sent, recipient still has to claim it at PayPal
  | "payout_failed"
  | "denied"
  | "withdrawn";

export const OPEN_STATUSES: ApplicationStatus[] = [
  "submitted",
  "needs_info",
  "in_review",
  "approved",
  "awaiting_funds",
  "paying",
];

export type PayoutMethod = "paypal_account" | "paypal_email" | "venmo_phone";

export interface RubricCategory {
  key: string;
  label: string;
  maxCents: number;
  examples: string[];
  evidence: string[];
}

export interface RubricCriterion {
  id: string;
  text: string;
  kind: "required" | "preferred" | "disqualifying";
}

export interface FundRubric {
  summary: string;
  categories: RubricCategory[];
  criteria: RubricCriterion[];
  requiredInfo: string[];
  maxGrantCents: number;
  cooldownDays: number;
}

export interface IntakeFacts {
  firstName?: string;
  category?: string;
  amountRequestedCents?: number;
  needSummary?: string;
  urgency?: "today" | "this_week" | "this_month" | "flexible";
  dueDate?: string;
  location?: string;
  payeeType?: "self" | "vendor";
  payeeName?: string;
  householdSize?: number;
  otherSupportTried?: string;
  circumstances?: string;
}

export interface CriterionVerdict {
  id: string;
  text: string;
  verdict: "met" | "not_met" | "unclear";
  evidence: string;
}

export interface Assessment {
  model: string;
  summary: string;
  recommendation: "approve" | "deny" | "needs_info";
  recommendedAmountCents: number;
  confidence: number;
  criteria: CriterionVerdict[];
  documentFindings: string[];
  questionsForApplicant: string[];
  riskNotes: string[];
  reviewerNote: string;
  createdAt: string;
}

export type RiskSeverity = "info" | "warn" | "block";

export interface RiskFlag {
  code: string;
  severity: RiskSeverity;
  message: string;
  relatedApplicationId?: string;
}

export type DocType =
  | "bill"
  | "estimate"
  | "invoice"
  | "notice"
  | "receipt"
  | "pay_stub"
  | "letter"
  | "photo"
  | "other";

export interface DocumentExtraction {
  docType: DocType;
  title: string;
  issuer: string | null;
  recipientName: string | null;
  amountCents: number | null;
  currency: string | null;
  dueDate: string | null;
  documentDate: string | null;
  summary: string;
  legible: boolean;
  consistencyNotes: string[];
  redFlags: string[];
}

export type PayoutStatus =
  | "pending"
  | "processing"
  | "success"
  | "unclaimed"
  | "failed"
  | "returned"
  | "blocked"
  | "held"
  | "canceled";

export type DonationStatus = "created" | "approved" | "captured" | "refunded" | "failed" | "canceled";

export type LedgerKind =
  | "donation"
  | "donation_fee"
  | "refund"
  | "payout"
  | "payout_fee"
  | "payout_reversal"
  | "adjustment";

export type ActorType = "ai" | "staff" | "system" | "applicant" | "donor" | "paypal" | "agent";

export type StaffRole = "admin" | "reviewer";
