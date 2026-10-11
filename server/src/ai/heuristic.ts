import type { Assessment, DocumentExtraction, FundRubric, RubricCategory } from "../domain/types.js";
import { formatMoney, toCents } from "../lib/money.js";
import { heuristicGridQuery } from "./grid-heuristic.js";
import { normalizeRubric } from "./shared.js";
import type {
  AiProvider,
  AssessmentContext,
  CopilotContext,
  GridQueryContext,
  GridQueryResult,
  DecisionMessageContext,
  DocumentContext,
  IntakeContext,
  RecordDetailsInput,
  StoryContext,
} from "./types.js";

/**
 * Deterministic, rule-based stand-in for the AI layer. It keeps the whole product
 * usable offline and makes the test-suite reproducible. It is intentionally simple;
 * the real experience runs on Claude (AI_MODE=claude).
 */

const CATEGORY_KEYWORDS: Array<[RegExp, string[]]> = [
  [/\b(car|auto|mechanic|tire|brake|transmission|bus pass|transport|carro|coche|mec[aá]nico|llanta)\b/i, ["car", "transport", "vehicle"]],
  [/\b(rent|evict|landlord|housing|deposit|renta|alquiler|desalojo|vivienda)\b/i, ["rent", "housing"]],
  [/\b(electric|power|utility|utilities|gas bill|water bill|shut ?off|luz|electricidad|agua|servicios)\b/i, ["utilit", "power", "energy"]],
  [/\b(medic|prescription|pharmacy|doctor|hospital|dental|medicina|receta|farmacia)\b/i, ["medical", "health"]],
  [/\b(food|grocer|meal|hungry|comida|mercado|despensa)\b/i, ["food", "grocer"]],
  [/\b(child ?care|daycare|babysit|guarder[ií]a)\b/i, ["child"]],
  [/\b(laptop|textbook|tuition|school|book|computer|computadora|escuela)\b/i, ["school", "student", "education"]],
];

const SPANISH = /\b(necesito|ayuda|carro|coche|renta|gracias|hola|por favor|pagar|dinero|trabajo|luz)\b/i;

function detectLanguage(text: string): "en" | "es" {
  return SPANISH.test(text) ? "es" : "en";
}

function findCategory(text: string, categories: RubricCategory[]): RubricCategory | undefined {
  for (const [re, hints] of CATEGORY_KEYWORDS) {
    if (!re.test(text)) continue;
    const match = categories.find((c) => hints.some((h) => `${c.key} ${c.label}`.toLowerCase().includes(h)));
    if (match) return match;
  }
  return undefined;
}

function findAmount(text: string): number | undefined {
  const m = text.match(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/) ??
    text.match(/\b(\d{2,5}(?:\.\d{1,2})?)\s?(?:dollars|d[oó]lares|usd)\b/i);
  if (!m) return undefined;
  return Number.parseFloat(m[1]!.replace(/,/g, ""));
}

function findLocation(text: string): string | undefined {
  const zip = text.match(/\b\d{5}\b/);
  if (zip) return zip[0];
  const city = text.match(/\b(?:in|en|from|de)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/);
  return city?.[1];
}

function findUrgency(text: string): RecordDetailsInput["urgency"] | undefined {
  if (/\b(today|tonight|now|hoy|ahora|urgent|urgente)\b/i.test(text)) return "today";
  if (/\b(this week|tomorrow|friday|monday|esta semana|mañana|viernes|lunes)\b/i.test(text)) return "this_week";
  if (/\b(this month|end of month|este mes|fin de mes)\b/i.test(text)) return "this_month";
  return undefined;
}

const T = {
  en: {
    askNeed: "Thanks for reaching out. Can you tell me what happened and what the money would be for?",
    askAmount: "I'm sorry you're dealing with this. About how much do you need?",
    askLocation: "Thank you. What city or ZIP code are you in?",
    askUrgency: "Got it. How soon do you need the money? Is there a due date?",
    askDoc: (kind: string) => `If you have a ${kind}, a photo of it helps the reviewer. You can upload it with the button below, or skip this.`,
    ready: "You're all set. Please review your request below and submit it. A volunteer reviews every request, usually within hours.",
    docThanks: "Thank you, I've added that document to your request.",
    outOfScope: "I'm sorry, this fund may not cover that. You can still submit, or call 211 for other local help.",
  },
  es: {
    askNeed: "Gracias por escribir. ¿Me puede contar qué pasó y para qué necesita el dinero?",
    askAmount: "Siento mucho que esté pasando por esto. ¿Cuánto dinero necesita, más o menos?",
    askLocation: "Gracias. ¿En qué ciudad o código postal vive?",
    askUrgency: "Entendido. ¿Para cuándo necesita el dinero? ¿Hay una fecha límite?",
    askDoc: (kind: string) => `Si tiene un documento (${kind}), una foto ayuda a quien revisa su solicitud. Puede subirla con el botón de abajo, o saltar este paso.`,
    ready: "Ya está todo listo. Revise su solicitud abajo y envíela. Una persona voluntaria revisa cada solicitud, normalmente en unas horas.",
    docThanks: "Gracias, agregué ese documento a su solicitud.",
    outOfScope: "Lo siento, es posible que este fondo no cubra eso. Puede enviarla de todos modos o llamar al 211 para otra ayuda local.",
  },
};

/** Spanish names for common evidence documents (fund rubrics are usually written in English). */
const EVIDENCE_ES: Record<string, string> = {
  "repair estimate": "presupuesto de reparación",
  "repair quote": "presupuesto de reparación",
  "utility bill or shut-off notice": "factura o aviso de corte de servicio",
  "rent notice or lease ledger": "aviso de renta o estado de cuenta del alquiler",
  "rent notice or bill": "aviso de renta o factura",
  "pharmacy quote or medical bill": "cotización de farmacia o factura médica",
  "bookstore quote": "cotización de la librería",
};

async function streamOut(text: string, onDelta: (t: string) => void): Promise<string> {
  const words = text.split(/(\s+)/);
  for (const w of words) onDelta(w);
  return text;
}

export class HeuristicAi implements AiProvider {
  readonly mode = "heuristic" as const;
  readonly model = "tideover-heuristic-v1";

  async intakeTurn(ctx: IntakeContext): Promise<string> {
    const userText = ctx.history.filter((t) => t.role === "user").map((t) => t.content).join("\n");
    const last = [...ctx.history].reverse().find((t) => t.role !== "assistant");
    const lang = (ctx.facts as { language?: string }).language === "es" || detectLanguage(userText) === "es" ? "es" : "en";
    const t = T[lang];

    const update: RecordDetailsInput = { language: lang };
    const facts = { ...ctx.facts };
    if (!facts.category) {
      const cat = findCategory(userText, ctx.fund.rubric.categories);
      if (cat) update.category = cat.key;
    }
    if (facts.amountRequestedCents == null) {
      const amount = findAmount(userText);
      if (amount) update.amount_requested = amount;
    }
    if (!facts.location) {
      const loc = findLocation(userText);
      if (loc) update.location = loc;
    }
    if (!facts.urgency) {
      const urg = findUrgency(userText);
      if (urg) update.urgency = urg;
    }
    if (!facts.needSummary && userText.trim().length > 12) {
      const first = ctx.history.find((h) => h.role === "user")?.content ?? userText;
      update.need_summary = first.slice(0, 280);
    }
    await ctx.tools.recordDetails(update);

    const category = update.category ?? facts.category;
    const amount = update.amount_requested ?? (facts.amountRequestedCents != null ? facts.amountRequestedCents / 100 : undefined);
    const location = update.location ?? facts.location;
    const urgency = update.urgency ?? facts.urgency;
    const hasNeed = Boolean(update.need_summary ?? facts.needSummary);

    let reply: string;
    if (last?.role === "event" && last.content.includes("uploaded")) {
      reply = t.docThanks;
      if (category && amount && hasNeed) {
        await ctx.tools.markReady({ summary_for_applicant: `${formatMoney(Math.round(amount * 100), ctx.fund.currency)}` });
        reply = `${t.docThanks} ${t.ready}`;
      }
    } else if (!hasNeed) {
      reply = t.askNeed;
    } else if (!amount) {
      reply = t.askAmount;
    } else if (!location) {
      reply = t.askLocation;
    } else if (!urgency) {
      reply = t.askUrgency;
    } else if (!category) {
      reply = t.outOfScope;
    } else if (ctx.documents.length === 0 && !ctx.history.some((h) => h.role === "event" && h.content.includes("upload button"))) {
      const cat = ctx.fund.rubric.categories.find((c) => c.key === category);
      const evidence = cat?.evidence[0];
      const kind =
        lang === "es"
          ? (evidence ? (EVIDENCE_ES[evidence.toLowerCase()] ?? evidence) : "factura o presupuesto")
          : (evidence ?? "bill or estimate");
      await ctx.tools.requestDocument({ document_kind: kind, reason: t.askDoc(kind) });
      reply = t.askDoc(kind);
    } else {
      await ctx.tools.markReady({
        summary_for_applicant: `${formatMoney(Math.round(amount * 100), ctx.fund.currency)}`,
      });
      reply = t.ready;
    }
    return streamOut(reply, ctx.onDelta);
  }

  async extractDocument(ctx: DocumentContext): Promise<DocumentExtraction> {
    const amount = findAmount(ctx.filename.replace(/[-_]/g, " ").replace(/(\d+)\s(\d{2})\b/, "$1.$2"));
    const named = ctx.filename.match(/(\d{2,5}(?:[._]\d{2})?)/);
    const amountCents = amount != null ? toCents(amount) : named ? toCents(named[1]!.replace("_", ".")) : null;
    const notes: string[] = [];
    if (amountCents != null && ctx.statedAmountCents != null) {
      notes.push(
        amountCents === ctx.statedAmountCents
          ? "Amount matches the stated need."
          : `Document shows ${formatMoney(amountCents)} vs ${formatMoney(ctx.statedAmountCents)} requested.`,
      );
    }
    return {
      docType: /estimate|quote|presupuesto/i.test(ctx.filename) ? "estimate" : /notice|aviso/i.test(ctx.filename) ? "notice" : "bill",
      title: ctx.filename,
      issuer: null,
      recipientName: null,
      amountCents,
      currency: amountCents != null ? "USD" : null,
      dueDate: null,
      documentDate: null,
      summary: "Document received (offline mode: contents were not analysed by AI).",
      legible: true,
      consistencyNotes: notes,
      redFlags: [],
    };
  }

  async assess(ctx: AssessmentContext): Promise<Assessment> {
    const cat = ctx.fund.rubric.categories.find((c) => c.key === ctx.category);
    const docAmount = ctx.documents.map((d) => d.extraction?.amountCents).find((a): a is number => a != null);
    const blocks = ctx.riskFlags.filter((f) => f.severity === "block");
    const warns = ctx.riskFlags.filter((f) => f.severity === "warn");
    const requested = ctx.amountRequestedCents ?? 0;

    let recommendation: Assessment["recommendation"] = "approve";
    const questions: string[] = [];
    if (!cat) {
      recommendation = "needs_info";
      questions.push("Which of the fund's categories best describes what the money is for?");
    } else if (!requested) {
      recommendation = "needs_info";
      questions.push("How much money do you need?");
    } else if (blocks.length) {
      recommendation = "needs_info";
    }
    const cap = Math.min(cat?.maxCents ?? ctx.fund.rubric.maxGrantCents, ctx.fund.rubric.maxGrantCents);
    const amount = recommendation === "approve" ? Math.min(requested, cap, docAmount ?? requested) : 0;

    return {
      model: this.model,
      summary: `${cat?.label ?? "Uncategorized"} request for ${formatMoney(requested, ctx.fund.currency)}. ${ctx.needSummary ?? ""}`.trim(),
      recommendation,
      recommendedAmountCents: amount,
      confidence: recommendation === "approve" ? (warns.length ? 0.55 : 0.7) : 0.5,
      criteria: ctx.fund.rubric.criteria.map((c) => ({
        id: c.id,
        text: c.text,
        verdict: "unclear" as const,
        evidence: "Offline mode: not evaluated by AI.",
      })),
      documentFindings: ctx.documents.map((d) => d.extraction?.summary ?? `${d.filename}: not analysed`),
      questionsForApplicant: questions,
      riskNotes: [...blocks, ...warns].map((f) => f.message),
      reviewerNote: "Offline heuristic assessment: please review the details yourself.",
      createdAt: new Date().toISOString(),
    };
  }

  async compilePolicy(input: { fundName: string; currency: string; policyText: string }): Promise<FundRubric> {
    const text = input.policyText;
    const amounts = [...text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})*|\d+)/g)].map((m) => Number(m[1]!.replace(/,/g, "")));
    const maxGrant = amounts.length ? Math.max(...amounts) : 500;
    const catalog: Array<[RegExp, RubricCategory]> = [
      [/rent|housing|evict/i, { key: "rent", label: "Rent & housing", maxCents: maxGrant * 100, examples: ["Late rent", "Eviction prevention"], evidence: ["lease or rent notice"] }],
      [/utilit|electric|power|water|gas/i, { key: "utilities", label: "Utilities", maxCents: maxGrant * 100, examples: ["Shut-off notice"], evidence: ["utility bill"] }],
      [/car|transport|vehicle|bus/i, { key: "car_repair", label: "Car repair & transport", maxCents: maxGrant * 100, examples: ["Car repair to get to work"], evidence: ["repair estimate"] }],
      [/medic|prescription|health/i, { key: "medical", label: "Medical & prescriptions", maxCents: maxGrant * 100, examples: ["Prescription copay"], evidence: ["pharmacy receipt or bill"] }],
      [/food|grocer/i, { key: "food", label: "Food", maxCents: Math.min(maxGrant, 200) * 100, examples: ["Groceries"], evidence: [] }],
      [/child ?care/i, { key: "childcare", label: "Childcare", maxCents: maxGrant * 100, examples: ["Daycare payment"], evidence: ["childcare invoice"] }],
    ];
    const categories = catalog.filter(([re]) => re.test(text)).map(([, c]) => c);
    return normalizeRubric({
      summary: `${input.fundName} provides one-time emergency grants of up to ${formatMoney(maxGrant * 100, input.currency)}.`,
      categories: categories.length
        ? categories
        : [{ key: "emergency", label: "Emergency expense", maxCents: maxGrant * 100, examples: [], evidence: ["bill or estimate"] }],
      criteria: [
        { id: "c1", text: "The expense is urgent and one-time.", kind: "required" },
        { id: "c2", text: "The request fits one of the fund's categories.", kind: "required" },
        { id: "c3", text: "A document supports the amount.", kind: "preferred" },
      ],
      requiredInfo: [],
      maxGrantCents: maxGrant * 100,
      cooldownDays: 180,
    });
  }

  async writeStory(ctx: StoryContext): Promise<string> {
    const m = ctx.minutesToCash != null ? Math.max(1, Math.round(ctx.minutesToCash)) : null;
    const minutes = m != null ? ` in ${m} minute${m === 1 ? "" : "s"}` : "";
    return `A neighbor in ${ctx.region} received ${formatMoney(ctx.amountCents, ctx.currency)} for ${ctx.categoryLabel.toLowerCase()}${minutes}.`;
  }

  async decisionMessage(ctx: DecisionMessageContext): Promise<string> {
    const amount = ctx.amountCents != null ? formatMoney(ctx.amountCents, ctx.currency) : "";
    const es = ctx.language === "es";
    // payoutLabel is written in English for staff; translate its one English phrase.
    const to = es ? ctx.payoutLabel?.replace(/^your PayPal account/, "su cuenta de PayPal") : ctx.payoutLabel;
    switch (ctx.kind) {
      case "approved":
        return es
          ? `¡Buenas noticias! Su solicitud fue aprobada por ${amount}. Estamos enviando el dinero${to ? ` a ${to}` : ""}.`
          : `Good news: your request was approved for ${amount}. We're sending the money${to ? ` to ${to}` : ""} now.`;
      case "paid":
        return es
          ? `El dinero (${amount}) ya fue enviado${to ? ` a ${to}` : ""}. Esperamos que esto ayude.`
          : `${amount} has been sent${to ? ` to ${to}` : ""}. We hope this helps.`;
      case "awaiting_funds":
        return es
          ? `Su solicitud fue aprobada por ${amount}. El fondo está esperando nuevas donaciones; le avisaremos en cuanto se envíe el dinero.`
          : `Your request was approved for ${amount}. The fund is waiting on new donations; we'll send the money the moment it's available.`;
      case "needs_info":
        return es
          ? `Gracias. Para continuar necesitamos un poco más de información:\n${(ctx.questions ?? []).join("\n")}`
          : `Thank you. To keep going, we need a little more information:\n${(ctx.questions ?? []).join("\n")}`;
      case "denied":
        return es
          ? `Lo sentimos, no pudimos aprobar esta solicitud. ${ctx.reason ?? ""} Puede responder con más información o llamar al 211 para otra ayuda local.`
          : `We're sorry, we couldn't approve this request. ${ctx.reason ?? ""} You can reply with more information, or call 211 for other local help.`;
    }
  }

  async gridQuery(ctx: GridQueryContext): Promise<GridQueryResult> {
    return heuristicGridQuery(ctx);
  }

  async copilotTurn(ctx: CopilotContext): Promise<string> {
    const question = ctx.history[ctx.history.length - 1]?.content.toLowerCase() ?? "";
    const pick = (name: string) => ctx.tools.find((t) => t.name === name);
    const days = Number(/(\d+)\s*days?/.exec(question)?.[1] ?? 7);
    const plan: Array<[string, Record<string, unknown>]> = [];
    if (/reconcil|match|missing/.test(question)) plan.push(["reconcile_with_paypal", { days }]);
    if (/donat|donor|gift/.test(question)) plan.push(["list_donations", { limit: 100 }]);
    if (/payout|paid|sent/.test(question)) plan.push(["list_payouts", { limit: 10 }]);
    if (/pending|queue|review|waiting|decision/.test(question)) plan.push(["search_applications", { status: "in_review" }]);
    if (/transaction|paypal/.test(question) && !plan.some(([n]) => n === "reconcile_with_paypal")) {
      plan.push(["paypal_list_transactions", { days }]);
    }
    if (plan.length === 0) plan.push(["get_fund_overview", {}]);

    const parts: string[] = ["_Offline mode: this answer comes from simple rules, not AI._"];
    for (const [name, input] of plan) {
      const tool = pick(name);
      if (!tool) continue;
      try {
        const result = await tool.run(input);
        ctx.onTool({ name, input, ok: true, preview: JSON.stringify(result).slice(0, 280) });
        parts.push(describeToolResult(name, result));
      } catch (err) {
        ctx.onTool({ name, input, ok: false, preview: String(err) });
        parts.push(`I couldn't read ${name.replace(/_/g, " ")} just now.`);
      }
    }
    return streamOut(parts.join("\n\n"), ctx.onDelta);
  }
}

type Row = Record<string, unknown>;
const usd = (cents: unknown) => formatMoney(Number(cents ?? 0));
const rows = (x: unknown): Row[] => (Array.isArray(x) ? (x as Row[]) : []);
const duration = (minutes: number) => {
  const m = Math.max(1, Math.round(minutes));
  return m < 120 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} hours` : `${Math.round(m / 1440)} days`;
};
const plural = (n: unknown, word: string) => `${Number(n ?? 0)} ${word}${Number(n) === 1 ? "" : "s"}`;

/** Turns a copilot tool result into a short, readable answer. */
function describeToolResult(name: string, result: unknown): string {
  switch (name) {
    case "get_fund_overview":
      return [
        "**What each fund can still grant right now**",
        ...rows(result).map((f) => {
          const waiting = Number(f.awaitingCount ?? 0);
          const minutes = f.medianMinutesToCash == null ? "" : `, median ${duration(Number(f.medianMinutesToCash))} to cash`;
          return (
            `- **${f.fund}**: ${usd(f.availableCents)} available. Raised ${usd(f.raisedCents)}, granted ${usd(f.grantedCents)} to ${Number(f.peopleHelped) === 1 ? "1 person" : `${f.peopleHelped} people`}${minutes}.` +
            (waiting ? ` ${waiting} approved request${waiting === 1 ? "" : "s"} (${usd(f.awaitingCents)}) waiting on donations.` : "") +
            (Number(f.inReviewCount ?? 0) ? ` ${f.inReviewCount} in review.` : "")
          );
        }),
      ].join("\n");
    case "search_applications": {
      const list = rows(result).sort((a, b) => String(a.submittedAt ?? "").localeCompare(String(b.submittedAt ?? "")));
      if (list.length === 0) return "No requests are waiting for a decision.";
      return [
        `**${list.length} request${list.length === 1 ? "" : "s"} waiting for a decision, oldest first**`,
        ...list.slice(0, 10).map((a) => {
          const waited = a.submittedAt ? duration((Date.now() - Date.parse(String(a.submittedAt))) / 60_000) : "";
          return `- **${a.publicRef}** (${a.fundName}): ${a.categoryLabel}, ${usd(a.amountRequestedCents)} requested${waited ? `, waiting ${waited}` : ""}. AI suggests ${String(a.aiRecommendation ?? "review").replace(/_/g, " ")}; risk ${a.riskLevel}.`;
        }),
      ].join("\n");
    }
    case "list_donations": {
      const captured = rows(result).filter((d) => d.status === "captured");
      if (captured.length === 0) return "No captured donations yet.";
      const byDonor = new Map<string, { cents: number; n: number }>();
      for (const d of captured) {
        const who = String(d.donorName ?? d.donorEmail ?? "Unknown") + (d.anonymous ? " (anonymous publicly)" : "");
        const cur = byDonor.get(who) ?? { cents: 0, n: 0 };
        byDonor.set(who, { cents: cur.cents + Number(d.amountCents ?? 0), n: cur.n + 1 });
      }
      const top = [...byDonor.entries()].sort((a, b) => b[1].cents - a[1].cents).slice(0, 5);
      const agents = captured.filter((d) => d.source === "agent");
      const agentNames = [...new Set(agents.map((d) => String(d.agentName ?? "an AI agent")))];
      return [
        `**Top donors** (from the last ${captured.length} captured donations)`,
        ...top.map(([who, v]) => `- ${who}: ${usd(v.cents)} across ${v.n} gift${v.n === 1 ? "" : "s"}`),
        agents.length
          ? `${agents.length} donation${agents.length === 1 ? "" : "s"} (${usd(agents.reduce((s, d) => s + Number(d.amountCents ?? 0), 0))}) came through AI agents: ${agentNames.join(", ")}.`
          : "None of these came through AI agents.",
      ].join("\n");
    }
    case "list_payouts": {
      const list = rows(result);
      if (list.length === 0) return "No payouts yet.";
      return [
        "**Recent PayPal payouts**",
        ...list.map((p) => `- ${usd(p.amountCents)} to ${p.receiver}: ${p.status}${p.paypalTransactionId ? ` (PayPal ${p.paypalTransactionId})` : ""}`),
      ].join("\n");
    }
    case "reconcile_with_paypal": {
      const r = (result ?? {}) as Row;
      const missing = rows(r.missingAtPayPal);
      const unknown = rows(r.unknownToTideover);
      const imported = Number(r.recordsWithoutPayPalIds ?? 0);
      return [
        `**Reconciliation, last ${r.windowDays} days**`,
        `- PayPal reports ${plural(r.paypalTransactions, "transaction")}; Tideover recorded ${plural(r.tideoverDonations, "donation")} and ${plural(r.tideoverPayouts, "payout")} through PayPal.`,
        missing.length === 0 && unknown.length === 0 ? "- Everything matches in both directions." : "",
        ...missing.map((m) => `- ${m.kind === "donation" ? "Donation" : "Payout"} ${m.paypalId} (${usd(m.amountCents)}) is not in PayPal's history.`),
        ...unknown.map((t) => `- PayPal ${t.eventCode} ${t.paypalId} (${usd(t.amountCents)}) has no Tideover record.`),
        imported ? `- ${imported} imported record${imported === 1 ? "" : "s"} without PayPal ids (demo history) ${imported === 1 ? "was" : "were"} not compared.` : "",
        r.note ? `_${r.note}_` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "paypal_list_transactions": {
      const list = rows(result);
      if (list.length === 0) return "PayPal shows no transactions in that window.";
      return [
        `**${list.length} PayPal transactions**`,
        ...list.slice(0, 10).map((t) => `- ${String(t.initiatedAt).slice(0, 10)} · ${t.eventCode} · ${usd(t.amountCents)} · ${t.status}`),
      ].join("\n");
    }
    default:
      return JSON.stringify(result).slice(0, 1500);
  }
}
