import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copilotTools } from "../src/domain/copilot.js";
import { restoreSimulatorHistory } from "../src/paypal/restore.js";
import { SimulatedPayPalGateway } from "../src/paypal/simulator.js";
import { makeApp, settle, type TestCtx } from "./helpers.js";

describe("PayPal history across restarts and reconciliation", () => {
  let ctx: TestCtx;
  beforeEach(async () => {
    ctx = await makeApp();
  });
  afterEach(async () => ctx.close());

  /** A Riverside gift that sponsors the waiting need, so it also triggers a payout. */
  async function sponsorNeed(): Promise<{ donationId: string }> {
    const pub = (await ctx.app.inject({ method: "GET", url: "/api/funds/riverside-college" })).json();
    const need = pub.needs[0];
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/funds/riverside-college/donations",
      payload: { amountCents: need.amountCents + 1_300, applicationId: need.id, donorName: "Alex Rivera" },
    });
    const { id } = created.json();
    const { orderId } = (await ctx.app.inject({ method: "POST", url: `/api/donations/${id}/order`, payload: {} })).json();
    ctx.sim.approveOrder(orderId, "donor");
    expect((await ctx.app.inject({ method: "POST", url: `/api/donations/${id}/capture`, payload: { orderId } })).statusCode).toBe(200);
    await settle(ctx);
    return { donationId: id };
  }

  async function reconcile(paypal: SimulatedPayPalGateway) {
    const tools = await copilotTools({ ...ctx.s, paypal }, { id: "usr_test", role: "admin", name: "Test" } as never);
    return (await tools.find((t) => t.name === "reconcile_with_paypal")!.run({ days: 7 })) as {
      tideoverDonations: number;
      tideoverPayouts: number;
      missingAtPayPal: unknown[];
      unknownToTideover: Array<{ paypalId: string }>;
      recordsWithoutPayPalIds: number;
    };
  }

  it("a restarted simulator remembers captures and payouts, so refunds and reconciliation still work", async () => {
    const { donationId } = await sponsorNeed();

    // Seeded history carries simulated PayPal ids and was restored at boot, so it reconciles too.
    const before = await reconcile(ctx.sim);
    expect(before.tideoverDonations).toBeGreaterThan(1);
    expect(before.tideoverPayouts).toBeGreaterThan(1);
    expect(before.missingAtPayPal).toEqual([]);
    expect(before.unknownToTideover).toEqual([]);
    expect(before.recordsWithoutPayPalIds).toBe(0);

    // Simulate a process restart: a brand-new simulator knows nothing until restored.
    const fresh = new SimulatedPayPalGateway({ publicUrl: "http://tideover.test", payoutDelayMs: 0 });
    const lost = (await reconcile(fresh)).missingAtPayPal.length;
    expect(lost).toBe(before.tideoverDonations + before.tideoverPayouts);
    expect(await restoreSimulatorHistory(ctx.s.db, fresh)).toBeGreaterThanOrEqual(lost);
    expect((await reconcile(fresh)).missingAtPayPal).toEqual([]);

    // A payment PayPal has but Tideover never recorded is surfaced.
    const stray = await fresh.createOrder({
      referenceId: "stray",
      description: "Stray payment",
      amountCents: 1_000,
      currency: "USD",
      brandName: "Tideover",
      requestId: "stray-1",
      flow: "buttons",
      returnUrl: "http://tideover.test",
      cancelUrl: "http://tideover.test",
    });
    fresh.approveOrder(stray.id, "donor");
    const captured = await fresh.captureOrder(stray.id, "stray-cap");
    const strayId = captured.purchase_units![0]!.payments!.captures![0]!.id;
    expect((await reconcile(fresh)).unknownToTideover.map((t) => t.paypalId)).toEqual([strayId]);

    // The restored capture is refundable through the restarted gateway (copilot tool, confirmed).
    const tools = await copilotTools({ ...ctx.s, paypal: fresh }, { id: "usr_test", role: "admin", name: "Test" } as never);
    const refund = tools.find((t) => t.name === "refund_donation")!;
    expect(await refund.run({ donation_id: donationId, reason: "Donor asked", confirm: false })).toMatchObject({ confirmation_required: true });
    const done = (await refund.run({ donation_id: donationId, reason: "Donor asked", confirm: true })) as { ok: boolean; donation: { status: string } };
    expect(done.ok).toBe(true);
    expect(done.donation.status).toBe("refunded");
    fresh.dispose();
  });
});
