import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Assessment, DocumentExtraction, FundRubric } from "../domain/types.js";
import { toCents } from "../lib/money.js";
import {
  assessmentSystemPrompt,
  copilotSystemPrompt,
  DECISION_SYSTEM_PROMPT,
  DOCUMENT_SYSTEM_PROMPT,
  intakeSystemPrompt,
  POLICY_SYSTEM_PROMPT,
  STORY_SYSTEM_PROMPT,
} from "./prompts.js";
import {
  type AiProvider,
  AiUnavailableError,
  type AssessmentContext,
  type ChatTurn,
  type CopilotContext,
  type DecisionMessageContext,
  type DocumentContext,
  type IntakeContext,
  type StoryContext,
} from "./types.js";
import { normalizeRubric, renderAssessmentCase, summarizeDocumentForChat } from "./shared.js";

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaToolUnion = Anthropic.Beta.Messages.BetaToolUnion;
type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
type BetaToolResultBlockParam = Anthropic.Beta.Messages.BetaToolResultBlockParam;
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// ------------------------------------------------------------ schemas

const DocumentSchema = z.object({
  docType: z.enum(["bill", "estimate", "invoice", "notice", "receipt", "pay_stub", "letter", "photo", "other"]),
  title: z.string(),
  issuer: z.string().nullable(),
  recipientName: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  dueDate: z.string().nullable(),
  documentDate: z.string().nullable(),
  summary: z.string(),
  legible: z.boolean(),
  consistencyNotes: z.array(z.string()),
  redFlags: z.array(z.string()),
});

const AssessmentSchema = z.object({
  summary: z.string(),
  recommendation: z.enum(["approve", "deny", "needs_info"]),
  recommendedAmount: z.number(),
  confidence: z.number(),
  criteria: z.array(
    z.object({
      id: z.string(),
      verdict: z.enum(["met", "not_met", "unclear"]),
      evidence: z.string(),
    }),
  ),
  documentFindings: z.array(z.string()),
  questionsForApplicant: z.array(z.string()),
  riskNotes: z.array(z.string()),
  reviewerNote: z.string(),
});

const RubricSchema = z.object({
  summary: z.string(),
  categories: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      maxAmount: z.number(),
      examples: z.array(z.string()),
      evidence: z.array(z.string()),
    }),
  ),
  criteria: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      kind: z.enum(["required", "preferred", "disqualifying"]),
    }),
  ),
  requiredInfo: z.array(z.string()),
  maxGrant: z.number(),
  cooldownDays: z.number().int(),
});

const RecordDetailsInput = z.object({
  language: z.string().min(2).max(8).optional(),
  first_name: z.string().max(60).optional(),
  category: z.string().max(60).optional(),
  amount_requested: z.number().nonnegative().max(1_000_000).optional(),
  need_summary: z.string().max(600).optional(),
  urgency: z.enum(["today", "this_week", "this_month", "flexible"]).optional(),
  due_date: z.string().max(20).optional(),
  location: z.string().max(120).optional(),
  payee_type: z.enum(["self", "vendor"]).optional(),
  payee_name: z.string().max(120).optional(),
  household_size: z.number().int().min(1).max(30).optional(),
  other_support_tried: z.string().max(400).optional(),
  circumstances: z.string().max(600).optional(),
});
const RequestDocumentInput = z.object({ document_kind: z.string().min(1).max(120), reason: z.string().max(300) });
const MarkReadyInput = z.object({ summary_for_applicant: z.string().max(800) });

// ------------------------------------------------------------- tools

const INTAKE_TOOLS: BetaToolUnion[] = [
  {
    name: "record_details",
    description:
      "Save facts learned about the applicant's request. Call whenever you learn something new; include only fields you learned. need_summary must be in English and must not contain names.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        language: { type: "string", description: "ISO 639-1 code of the language the applicant is writing in, e.g. en, es, vi." },
        first_name: { type: "string", description: "Applicant's first name, if they shared it." },
        category: { type: "string", description: "One of the fund's category keys." },
        amount_requested: { type: "number", description: "Amount needed in the fund's currency, e.g. 380.00" },
        need_summary: { type: "string", description: "One or two neutral English sentences describing the need. No names." },
        urgency: { type: "string", enum: ["today", "this_week", "this_month", "flexible"] },
        due_date: { type: "string", description: "YYYY-MM-DD if a deadline was mentioned." },
        location: { type: "string", description: "City or ZIP code." },
        payee_type: { type: "string", enum: ["self", "vendor"], description: "Whether money goes to the applicant or straight to a vendor." },
        payee_name: { type: "string", description: "Vendor name when payee_type is vendor." },
        household_size: { type: "integer" },
        other_support_tried: { type: "string" },
        circumstances: { type: "string", description: "Relevant context in English, e.g. 'car needed to get to work'." },
      },
    },
  },
  {
    name: "request_document",
    description:
      "Show the applicant an upload button for a supporting document (bill, estimate, notice, receipt). Call at most once per document kind.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        document_kind: { type: "string", description: "e.g. 'repair estimate', 'shut-off notice'" },
        reason: { type: "string", description: "Short reason shown to the applicant, in their language." },
      },
      required: ["document_kind", "reason"],
    },
  },
  {
    name: "mark_ready",
    description:
      "Mark the request as complete enough to submit. The app then shows the applicant a review-and-submit card and asks how they want to receive money.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary_for_applicant: {
          type: "string",
          description: "Short recap of the request in the applicant's language, shown on the review card.",
        },
      },
      required: ["summary_for_applicant"],
    },
  },
];

// ------------------------------------------------------------ helpers

function textOf(content: BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Converts stored chat turns into Messages API turns (must start with a user turn). */
function toMessages(history: ChatTurn[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const turn of history) {
    const role = turn.role === "assistant" ? "assistant" : "user";
    const text = turn.role === "event" ? `[Tideover system note] ${turn.content}` : turn.content;
    if (!text.trim()) continue;
    if (out.length === 0 && role === "assistant") {
      out.push({ role: "user", content: "[Tideover system note] The applicant opened the help form." });
    }
    out.push({ role, content: text });
  }
  if (out.length === 0) out.push({ role: "user", content: "[Tideover system note] The applicant opened the help form." });
  return out;
}

function mediaBlock(ctx: DocumentContext): Anthropic.Beta.Messages.BetaContentBlockParam {
  const data = ctx.data.toString("base64");
  if (ctx.mimeType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  const supported = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
  const mediaType = supported.find((m) => m === ctx.mimeType);
  if (!mediaType) throw new AiUnavailableError(`Unsupported document type ${ctx.mimeType}`);
  return { type: "image", source: { type: "base64", media_type: mediaType, data } };
}

/**
 * Claude implementation of the AI layer.
 * Defaults to claude-opus-5-5, where adaptive thinking is always on and effort is
 * the control, tuned per task. Thinking counts toward max_tokens, so budgets
 * leave room for it.
 */
export class ClaudeAi implements AiProvider {
  readonly mode = "claude" as const;
  private readonly client: Anthropic;

  constructor(
    opts: { apiKey: string; baseUrl: string; fetch?: typeof fetch },
    readonly model: string,
  ) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl,
      maxRetries: opts.fetch ? 0 : 3,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  /** Server-side refusal fallback ("default" routing) on models that support it. */
  private fallback(): { betas?: Anthropic.Beta.AnthropicBeta[]; fallbacks?: "default" } {
    if (/^claude-(opus-5|sonnet-5-5|fable-5)/.test(this.model)) {
      return { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
    }
    return {};
  }

  private async plainText(system: string, user: string, effort: Effort, maxTokens = 8000): Promise<string> {
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort },
      ...this.fallback(),
    });
    if (res.stop_reason === "refusal") throw new AiUnavailableError("The model declined this request");
    // A cut-off message must never reach an applicant; callers fall back to templates.
    if (res.stop_reason === "max_tokens") throw new AiUnavailableError("Reply was truncated");
    return textOf(res.content).trim();
  }

  // ------------------------------------------------------------ intake

  async intakeTurn(ctx: IntakeContext): Promise<string> {
    const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [
      { type: "text", text: intakeSystemPrompt(ctx.fund), cache_control: { type: "ephemeral" } },
    ];
    const messages = toMessages(ctx.history);
    let full = "";
    let jsonRetries = 0;

    for (let iteration = 0; iteration < 6; iteration++) {
      let startedThisIteration = false;
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: 16000,
        system,
        tools: INTAKE_TOOLS,
        messages,
        output_config: { effort: "low" },
        ...this.fallback(),
      });
      stream.on("text", (delta) => {
        if (!startedThisIteration && full && !/\s$/.test(full)) {
          full += "\n\n";
          ctx.onDelta("\n\n");
        }
        startedThisIteration = true;
        full += delta;
        ctx.onDelta(delta);
      });

      let message: Anthropic.Beta.Messages.BetaMessage;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        continue; // unparseable streamed tool input: re-issue the turn
      }

      if (message.stop_reason === "refusal") break;
      const toolUses = message.content.filter(
        (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use",
      );
      if (toolUses.length === 0) break;
      if (message.stop_reason === "max_tokens") throw new AiUnavailableError("Intake reply was truncated");

      messages.push({ role: "assistant", content: message.content });
      const results: BetaToolResultBlockParam[] = [];
      for (const use of toolUses) {
        results.push(await this.runIntakeTool(ctx, use));
      }
      messages.push({ role: "user", content: results });
    }
    return full.trim();
  }

  private async runIntakeTool(
    ctx: IntakeContext,
    use: Anthropic.Beta.Messages.BetaToolUseBlock,
  ): Promise<BetaToolResultBlockParam> {
    const fail = (content: string): BetaToolResultBlockParam => ({
      type: "tool_result",
      tool_use_id: use.id,
      is_error: true,
      content,
    });
    try {
      switch (use.name) {
        case "record_details": {
          const parsed = RecordDetailsInput.safeParse(use.input);
          if (!parsed.success) return fail(`Invalid input: ${parsed.error.message}`);
          return { type: "tool_result", tool_use_id: use.id, content: await ctx.tools.recordDetails(parsed.data) };
        }
        case "request_document": {
          const parsed = RequestDocumentInput.safeParse(use.input);
          if (!parsed.success) return fail(`Invalid input: ${parsed.error.message}`);
          return { type: "tool_result", tool_use_id: use.id, content: await ctx.tools.requestDocument(parsed.data) };
        }
        case "mark_ready": {
          const parsed = MarkReadyInput.safeParse(use.input);
          if (!parsed.success) return fail(`Invalid input: ${parsed.error.message}`);
          return { type: "tool_result", tool_use_id: use.id, content: await ctx.tools.markReady(parsed.data) };
        }
        default:
          return fail(`Unknown tool ${use.name}`);
      }
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  // --------------------------------------------------------- documents

  async extractDocument(ctx: DocumentContext): Promise<DocumentExtraction> {
    const stated = [
      ctx.statedNeed ? `Stated need: ${ctx.statedNeed}` : null,
      ctx.statedAmountCents != null ? `Stated amount: ${(ctx.statedAmountCents / 100).toFixed(2)}` : null,
      ctx.category ? `Category: ${ctx.category}` : null,
      ctx.applicantFirstName ? `Applicant first name: ${ctx.applicantFirstName}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      system: DOCUMENT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            mediaBlock(ctx),
            {
              type: "text",
              text: `File name: ${ctx.filename}\n${stated || "The applicant has not described the need yet."}\n\nExtract the document's facts and check them against the stated need.`,
            },
          ],
        },
      ],
      output_config: { effort: "medium", format: betaZodOutputFormat(DocumentSchema) },
      ...this.fallback(),
    });
    if (res.stop_reason === "refusal") throw new AiUnavailableError("The model declined to read this document");
    const out = res.parsed_output;
    if (!out) throw new AiUnavailableError("Document extraction returned no result");
    return {
      docType: out.docType,
      title: out.title,
      issuer: out.issuer,
      recipientName: out.recipientName,
      amountCents: out.amount != null ? toCents(out.amount) : null,
      currency: out.currency,
      dueDate: out.dueDate,
      documentDate: out.documentDate,
      summary: out.summary,
      legible: out.legible,
      consistencyNotes: out.consistencyNotes,
      redFlags: out.redFlags,
    };
  }

  // -------------------------------------------------------- assessment

  async assess(ctx: AssessmentContext): Promise<Assessment> {
    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      system: [{ type: "text", text: assessmentSystemPrompt(ctx.fund), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: renderAssessmentCase(ctx) }],
      output_config: { effort: "high", format: betaZodOutputFormat(AssessmentSchema) },
      ...this.fallback(),
    });
    if (res.stop_reason === "refusal") throw new AiUnavailableError("The model declined to assess this case");
    const out = res.parsed_output;
    if (!out) throw new AiUnavailableError("Assessment returned no result");
    const criteriaText = new Map(ctx.fund.rubric.criteria.map((c) => [c.id, c.text]));
    return {
      model: this.model,
      summary: out.summary,
      recommendation: out.recommendation,
      recommendedAmountCents: Math.max(0, toCents(out.recommendedAmount)),
      confidence: Math.min(1, Math.max(0, out.confidence)),
      criteria: out.criteria.map((c) => ({ ...c, text: criteriaText.get(c.id) ?? c.id })),
      documentFindings: out.documentFindings,
      questionsForApplicant: out.questionsForApplicant.slice(0, 3),
      riskNotes: out.riskNotes,
      reviewerNote: out.reviewerNote,
      createdAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------ policy

  async compilePolicy(input: {
    fundName: string;
    region: string;
    currency: string;
    policyText: string;
  }): Promise<FundRubric> {
    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 12000,
      system: POLICY_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Fund: ${input.fundName}\nRegion: ${input.region}\nCurrency: ${input.currency}\n\n<policy>\n${input.policyText}\n</policy>`,
        },
      ],
      output_config: { effort: "high", format: betaZodOutputFormat(RubricSchema) },
      ...this.fallback(),
    });
    if (res.stop_reason === "refusal") throw new AiUnavailableError("The model declined to compile this policy");
    const out = res.parsed_output;
    if (!out) throw new AiUnavailableError("Policy compilation returned no result");
    return normalizeRubric({
      summary: out.summary,
      categories: out.categories.map((c) => ({
        key: c.key,
        label: c.label,
        maxCents: toCents(c.maxAmount),
        examples: c.examples,
        evidence: c.evidence,
      })),
      criteria: out.criteria,
      requiredInfo: out.requiredInfo,
      maxGrantCents: toCents(out.maxGrant),
      cooldownDays: out.cooldownDays,
    });
  }

  // -------------------------------------------------- short generations

  async writeStory(ctx: StoryContext): Promise<string> {
    const text = await this.plainText(
      STORY_SYSTEM_PROMPT,
      `Category: ${ctx.categoryLabel}\nAmount: ${(ctx.amountCents / 100).toFixed(2)} ${ctx.currency}\nRegion: ${ctx.region}\nNeed (internal, may contain details you must not repeat): ${ctx.needSummary}\n${ctx.minutesToCash != null ? `Minutes from request to cash: ${Math.round(ctx.minutesToCash)}` : ""}`,
      "low",
      4000,
    );
    return text.replace(/^["']|["']$/g, "");
  }

  async decisionMessage(ctx: DecisionMessageContext): Promise<string> {
    const lines = [
      `Language: ${ctx.language}`,
      `Fund: ${ctx.fundName}`,
      `Recipient first name: ${ctx.firstName ?? "unknown"}`,
      `Message type: ${ctx.kind}`,
      ctx.amountCents != null ? `Amount: ${(ctx.amountCents / 100).toFixed(2)} ${ctx.currency}` : null,
      ctx.payoutLabel ? `Money goes to: ${ctx.payoutLabel}` : null,
      ctx.reason ? `Reason / context: ${ctx.reason}` : null,
      ctx.questions?.length ? `Questions to ask:\n${ctx.questions.map((q) => `- ${q}`).join("\n")}` : null,
    ].filter(Boolean);
    return this.plainText(DECISION_SYSTEM_PROMPT, lines.join("\n"), "low", 4000);
  }

  // ----------------------------------------------------------- copilot

  async copilotTurn(ctx: CopilotContext): Promise<string> {
    const tools: BetaToolUnion[] = ctx.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
      eager_input_streaming: true,
    }));
    const byName = new Map(ctx.tools.map((t) => [t.name, t]));
    const messages: BetaMessageParam[] = ctx.history.map((m) => ({ role: m.role, content: m.content }));
    messages.push({ role: "user", content: `[Today is ${new Date().toISOString().slice(0, 10)}]` });
    // Fold the date note into the last user turn so roles still alternate cleanly.
    const last = messages.pop()!;
    const prev = messages[messages.length - 1];
    if (prev && prev.role === "user" && typeof prev.content === "string") {
      prev.content = `${prev.content}\n\n${last.content as string}`;
    } else {
      messages.push(last);
    }

    let full = "";
    for (let iteration = 0; iteration < 8; iteration++) {
      let startedThisIteration = false;
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: 16000,
        system: [{ type: "text", text: copilotSystemPrompt(ctx.userName), cache_control: { type: "ephemeral" } }],
        tools,
        messages,
        output_config: { effort: "medium" },
        ...this.fallback(),
      });
      stream.on("text", (delta) => {
        if (!startedThisIteration && full && !/\s$/.test(full)) {
          full += "\n\n";
          ctx.onDelta("\n\n");
        }
        startedThisIteration = true;
        full += delta;
        ctx.onDelta(delta);
      });
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") break;
      const toolUses = message.content.filter(
        (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use",
      );
      if (toolUses.length === 0) break;
      if (message.stop_reason === "max_tokens") break;

      messages.push({ role: "assistant", content: message.content });
      const results = await Promise.all(
        toolUses.map(async (use): Promise<BetaToolResultBlockParam> => {
          const tool = byName.get(use.name);
          if (!tool) return { type: "tool_result", tool_use_id: use.id, is_error: true, content: "Unknown tool" };
          try {
            const result = await tool.run((use.input ?? {}) as Record<string, unknown>);
            const json = JSON.stringify(result ?? null);
            const content = json.length > 24_000 ? `${json.slice(0, 24_000)}… (truncated)` : json;
            ctx.onTool({ name: use.name, input: use.input, ok: true, preview: content.slice(0, 280) });
            return { type: "tool_result", tool_use_id: use.id, content };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            ctx.onTool({ name: use.name, input: use.input, ok: false, preview: msg.slice(0, 280) });
            return { type: "tool_result", tool_use_id: use.id, is_error: true, content: msg };
          }
        }),
      );
      messages.push({ role: "user", content: results });
    }
    return full.trim();
  }
}

export { summarizeDocumentForChat };
