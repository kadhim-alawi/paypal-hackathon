import { describe, expect, it } from "vitest";
import { HeuristicAi } from "../src/ai/heuristic.js";

describe("offline decision messages", () => {
  const ai = new HeuristicAi();
  const base = { fundName: "Eastside", currency: "USD", amountCents: 38_000, payoutLabel: "your PayPal account (m•••a@example.com)" };

  it("stay entirely in Spanish for Spanish-speaking applicants", async () => {
    const approved = await ai.decisionMessage({ ...base, language: "es", kind: "approved" });
    const paid = await ai.decisionMessage({ ...base, language: "es", kind: "paid" });
    for (const text of [approved, paid]) {
      expect(text).toContain("su cuenta de PayPal (m•••a@example.com)");
      expect(text).not.toMatch(/your/i);
    }
  });

  it("keep the English label for English speakers", async () => {
    const paid = await ai.decisionMessage({ ...base, language: "en", kind: "paid" });
    expect(paid).toBe("$380.00 has been sent to your PayPal account (m•••a@example.com). We hope this helps.");
  });
});
