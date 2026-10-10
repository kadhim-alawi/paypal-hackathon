import type { DocumentExtraction, FundRubric } from "../domain/types.js";
import { formatMoney } from "../lib/money.js";
import type { AssessmentContext } from "./types.js";

/** Makes model-produced rubrics safe to use: unique snake_case keys, sane caps, ids. */
export function normalizeRubric(rubric: FundRubric): FundRubric {
  const seen = new Set<string>();
  const maxGrantCents = Math.max(100, Math.round(rubric.maxGrantCents));
  const categories = rubric.categories
    .map((c) => {
      let key = c.key
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 40) || "other";
      while (seen.has(key)) key = `${key}_2`;
      seen.add(key);
      return {
        key,
        label: c.label.trim() || key,
        maxCents: Math.min(maxGrantCents, Math.max(100, Math.round(c.maxCents || maxGrantCents))),
        examples: c.examples.slice(0, 6),
        evidence: c.evidence.slice(0, 6),
      };
    })
    .slice(0, 12);
  const criteria = rubric.criteria.slice(0, 12).map((c, i) => ({
    id: /^c\d+$/.test(c.id) ? c.id : `c${i + 1}`,
    text: c.text.trim(),
    kind: c.kind,
  }));
  return {
    summary: rubric.summary.trim(),
    categories: categories.length
      ? categories
      : [{ key: "other", label: "Emergency expense", maxCents: maxGrantCents, examples: [], evidence: [] }],
    criteria,
    requiredInfo: rubric.requiredInfo.slice(0, 8),
    maxGrantCents,
    cooldownDays: Math.min(730, Math.max(0, Math.round(rubric.cooldownDays))),
  };
}

/** One-line description of an analysed document, fed back into the intake chat. */
export function summarizeDocumentForChat(filename: string, x: DocumentExtraction | null): string {
  if (!x) return `The applicant uploaded "${filename}", but it could not be analysed automatically. A reviewer will look at it.`;
  const parts = [`The applicant uploaded "${filename}": ${x.summary}`];
  if (x.amountCents != null) parts.push(`Amount shown: ${formatMoney(x.amountCents, x.currency ?? "USD")}.`);
  if (x.issuer) parts.push(`Issued by: ${x.issuer}.`);
  if (x.dueDate) parts.push(`Due: ${x.dueDate}.`);
  if (!x.legible) parts.push("Parts of it are hard to read; you may ask for a clearer photo.");
  if (x.consistencyNotes.length) parts.push(`Notes: ${x.consistencyNotes.join(" ")}`);
  return parts.join(" ");
}

/** Renders the case for the AI caseworker. Untrusted content is fenced in tags. */
export function renderAssessmentCase(ctx: AssessmentContext): string {
  const cur = ctx.fund.currency;
  const facts = ctx.facts;
  const lines: string[] = [];
  lines.push(`Case ${ctx.publicRef}`);
  lines.push(`Category: ${ctx.category ?? "not set"}`);
  lines.push(
    `Amount requested: ${ctx.amountRequestedCents != null ? formatMoney(ctx.amountRequestedCents, cur) : "not stated"}`,
  );
  lines.push(`Need (intake summary): ${ctx.needSummary ?? "not recorded"}`);
  if (facts.urgency) lines.push(`Urgency: ${facts.urgency}${facts.dueDate ? `, due ${facts.dueDate}` : ""}`);
  if (facts.location) lines.push(`Location: ${facts.location}`);
  if (facts.payeeType) lines.push(`Payee: ${facts.payeeType}${facts.payeeName ? ` (${facts.payeeName})` : ""}`);
  if (facts.householdSize) lines.push(`Household size: ${facts.householdSize}`);
  if (facts.otherSupportTried) lines.push(`Other support tried: ${facts.otherSupportTried}`);
  if (facts.circumstances) lines.push(`Circumstances: ${facts.circumstances}`);
  lines.push(
    `Payout destination: ${ctx.payout.method ?? "not chosen yet"}${ctx.payout.verified ? " (verified PayPal account via Log in with PayPal)" : ""}`,
  );
  lines.push(
    `Prior grants from this fund to the same PayPal account or receiver: ${ctx.priorGrants.count}${ctx.priorGrants.count ? ` totalling ${formatMoney(ctx.priorGrants.totalCents, cur)}, last paid ${ctx.priorGrants.lastPaidAt}` : ""}`,
  );

  lines.push("\n<risk_flags>");
  if (ctx.riskFlags.length === 0) lines.push("none");
  for (const f of ctx.riskFlags) lines.push(`- [${f.severity}] ${f.code}: ${f.message}`);
  lines.push("</risk_flags>");

  lines.push("\n<documents>");
  if (ctx.documents.length === 0) lines.push("No documents uploaded.");
  ctx.documents.forEach((d, i) => {
    const x = d.extraction;
    if (!x) {
      lines.push(`Document ${i + 1} (${d.filename}): could not be analysed.`);
      return;
    }
    lines.push(
      `Document ${i + 1} (${d.filename}): ${x.docType}, "${x.title}". Issuer: ${x.issuer ?? "unknown"}. Addressed to: ${x.recipientName ?? "unknown"}. Amount: ${x.amountCents != null ? formatMoney(x.amountCents, x.currency ?? cur) : "none"}. Date: ${x.documentDate ?? "unknown"}. Due: ${x.dueDate ?? "n/a"}. Legible: ${x.legible}. Summary: ${x.summary}. Consistency: ${x.consistencyNotes.join(" ") || "n/a"}. Red flags: ${x.redFlags.join(" ") || "none"}.`,
    );
  });
  lines.push("</documents>");

  const transcript = ctx.transcript.slice(-40);
  lines.push("\n<intake_transcript>");
  for (const t of transcript) {
    const who = t.role === "user" ? "Applicant" : t.role === "assistant" ? "Intake assistant" : "System";
    lines.push(`${who}: ${t.content}`);
  }
  lines.push("</intake_transcript>");
  lines.push("\nPrepare the case file.");
  return lines.join("\n");
}
