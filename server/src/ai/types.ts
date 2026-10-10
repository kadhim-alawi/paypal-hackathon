import type {
  Assessment,
  DocumentExtraction,
  FundRubric,
  IntakeFacts,
  RiskFlag,
} from "../domain/types.js";

export interface FundContext {
  name: string;
  region: string;
  currency: string;
  policyText: string;
  rubric: FundRubric;
}

export interface ChatTurn {
  role: "user" | "assistant" | "event";
  content: string;
}

/** Tool handlers the intake agent can call. Implemented by the domain layer. */
export interface IntakeToolHandlers {
  recordDetails(input: RecordDetailsInput): Promise<string>;
  requestDocument(input: { document_kind: string; reason: string }): Promise<string>;
  markReady(input: { summary_for_applicant: string }): Promise<string>;
}

export interface RecordDetailsInput {
  language?: string;
  first_name?: string;
  category?: string;
  amount_requested?: number;
  need_summary?: string;
  urgency?: IntakeFacts["urgency"];
  due_date?: string;
  location?: string;
  payee_type?: "self" | "vendor";
  payee_name?: string;
  household_size?: number;
  other_support_tried?: string;
  circumstances?: string;
}

export interface IntakeContext {
  fund: FundContext;
  publicRef: string;
  facts: IntakeFacts;
  documents: Array<{ filename: string; extraction: DocumentExtraction | null }>;
  history: ChatTurn[];
  tools: IntakeToolHandlers;
  onDelta: (text: string) => void;
}

export interface DocumentContext {
  filename: string;
  mimeType: string;
  data: Buffer;
  statedNeed?: string | null;
  statedAmountCents?: number | null;
  category?: string | null;
  applicantFirstName?: string | null;
}

export interface AssessmentContext {
  fund: FundContext;
  publicRef: string;
  facts: IntakeFacts;
  category: string | null;
  amountRequestedCents: number | null;
  needSummary: string | null;
  payout: { method: string | null; verified: boolean };
  transcript: ChatTurn[];
  documents: Array<{ filename: string; extraction: DocumentExtraction | null }>;
  riskFlags: RiskFlag[];
  priorGrants: { count: number; totalCents: number; lastPaidAt: string | null };
}

export interface DecisionMessageContext {
  fundName: string;
  language: string;
  firstName?: string | null;
  kind: "approved" | "denied" | "needs_info" | "paid" | "awaiting_funds";
  amountCents?: number | null;
  currency: string;
  reason?: string | null;
  questions?: string[];
  payoutLabel?: string | null;
}

export interface StoryContext {
  categoryLabel: string;
  amountCents: number;
  currency: string;
  region: string;
  needSummary: string;
  minutesToCash: number | null;
}

export interface CopilotTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(input: Record<string, unknown>): Promise<unknown>;
}

export interface CopilotContext {
  userName: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  tools: CopilotTool[];
  onDelta: (text: string) => void;
  onTool: (event: { name: string; input: unknown; ok: boolean; preview: string }) => void;
}

export interface AiProvider {
  readonly mode: "claude" | "heuristic";
  readonly model: string;
  intakeTurn(ctx: IntakeContext): Promise<string>;
  extractDocument(ctx: DocumentContext): Promise<DocumentExtraction>;
  assess(ctx: AssessmentContext): Promise<Assessment>;
  compilePolicy(input: { fundName: string; region: string; currency: string; policyText: string }): Promise<FundRubric>;
  writeStory(ctx: StoryContext): Promise<string>;
  decisionMessage(ctx: DecisionMessageContext): Promise<string>;
  copilotTurn(ctx: CopilotContext): Promise<string>;
}

export class AiUnavailableError extends Error {}
