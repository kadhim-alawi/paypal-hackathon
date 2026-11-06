import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { applications } from "../src/db/schema.js";
import { makeApp } from "./helpers.js";

const sandbox = { PAYPAL_MODE: "sandbox", PAYPAL_CLIENT_ID: "test-id", PAYPAL_CLIENT_SECRET: "test-secret" };

async function waitingNeed(env: Record<string, string>) {
  const ctx = await makeApp(env);
  try {
    const [need] = await ctx.s.db.select().from(applications).where(eq(applications.status, "awaiting_funds"));
    return need!;
  } finally {
    await ctx.close();
  }
}

describe("seeded approved need under real PayPal", () => {
  it("pays a real sandbox account by email, not the simulator's made-up payer id", async () => {
    const need = await waitingNeed({ ...sandbox, DEMO_RECEIVER_EMAIL: "judge@personal.example.com" });
    expect(need.payoutMethod).toBe("paypal_email");
    expect(need.payoutReceiver).toBe("judge@personal.example.com");
    expect(need.paypalPayerId).toBeNull();
  });

  it("never uses a made-up payer id even without DEMO_RECEIVER_EMAIL", async () => {
    const need = await waitingNeed(sandbox);
    expect(need.payoutMethod).toBe("paypal_email");
    expect(need.paypalPayerId).toBeNull();
  });

  it("keeps the simulator's verified payer id offline", async () => {
    const need = await waitingNeed({});
    expect(need.payoutMethod).toBe("paypal_account");
    expect(need.paypalPayerId).toBe("SIMDEVPAT8K3N");
  });
});
