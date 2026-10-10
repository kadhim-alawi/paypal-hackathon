import { describe, expect, it } from "vitest";
import { normalizeReceiver, textSimilarity } from "../src/domain/risk.js";
import { autoApprovalDecision, capAmount } from "../src/domain/assessment.js";
import { EASTSIDE_RUBRIC } from "../src/seed.js";
import type { Application, Fund } from "../src/db/schema.js";

const fund = {
  id: "fnd_1",
  rubric: EASTSIDE_RUBRIC,
  maxGrantCents: 75_000,
  autoApproveLimitCents: 20_000,
} as unknown as Fund;

describe("risk helpers", () => {
  it("normalizes receivers", () => {
    expect(normalizeReceiver("paypal_email", "  Maria@Example.COM ")).toBe("maria@example.com");
    expect(normalizeReceiver("venmo_phone", "+1 (512) 555-0134")).toBe("5125550134");
  });

  it("detects near-identical stories but not different ones", () => {
    const a = "Need 600 for transmission repair asap to get to work, please send to my paypal today thanks";
    const b = "need 600 for transmission repair asap to get to work. please send to my paypal today, thanks!";
    const c = "My electric bill has a shut-off notice and I have a newborn at home";
    expect(textSimilarity(a, b)).toBeGreaterThan(0.6);
    expect(textSimilarity(a, c)).toBeLessThan(0.1);
  });

  it("caps amounts by category and fund maximum", () => {
    expect(capAmount(fund, "food", 50_000)).toBe(15_000);
    expect(capAmount(fund, "rent", 99_000)).toBe(75_000);
    expect(capAmount(fund, "unknown", 99_000)).toBe(75_000);
  });
});

describe("auto-approval gate", () => {
  const app = { payoutMethod: "paypal_account", payoutVerified: true, category: "food" } as Application;
  const assessment = {
    model: "x",
    summary: "",
    recommendation: "approve" as const,
    recommendedAmountCents: 12_000,
    confidence: 0.9,
    criteria: [],
    documentFindings: [],
    questionsForApplicant: [],
    riskNotes: [],
    reviewerNote: "",
    createdAt: "",
  };

  it("passes a clean, small, verified request", () => {
    expect(autoApprovalDecision(fund, app, assessment, [], []).eligible).toBe(true);
  });

  it("blocks on any warning, low confidence, high amount or missing verification", () => {
    expect(autoApprovalDecision(fund, app, assessment, [{ code: "x", severity: "warn", message: "" }], []).eligible).toBe(false);
    expect(autoApprovalDecision(fund, app, { ...assessment, confidence: 0.6 }, [], []).eligible).toBe(false);
    expect(autoApprovalDecision(fund, app, { ...assessment, recommendedAmountCents: 30_000 }, [], []).eligible).toBe(false);
    expect(autoApprovalDecision(fund, { ...app, payoutVerified: false } as Application, assessment, [], []).eligible).toBe(false);
    expect(autoApprovalDecision({ ...fund, autoApproveLimitCents: 0 } as Fund, app, assessment, [], []).eligible).toBe(false);
  });

  it("requires a document when the category asks for evidence", () => {
    const car = { ...app, category: "car_repair" } as Application;
    const r = autoApprovalDecision(fund, car, assessment, [], []);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toContain("no supporting document");
  });
});
