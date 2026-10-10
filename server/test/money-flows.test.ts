import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applications, donations, funds, payouts } from "../src/db/schema.js";
import { availableCents } from "../src/domain/ledger.js";
import { makeApp, settle, staffToken, type TestCtx } from "./helpers.js";

describe("donations, sponsored needs and the two-person rule", () => {
  let ctx: TestCtx;
  beforeEach(async () => {
    ctx = await makeApp();
  });
  afterEach(async () => ctx.close());

  async function give(slug: string, amountCents: number, applicationId?: string) {
    const created = await ctx.app.inject({
      method: "POST",
      url: `/api/funds/${slug}/donations`,
      payload: { amountCents, applicationId, donorName: "Alex Rivera" },
    });
    expect(created.statusCode).toBe(201);
    const { id, checkoutUrl } = created.json();
    expect(checkoutUrl).toBe(`http://tideover.test/give/checkout/${id}`);

    const page = await ctx.app.inject({ method: "GET", url: `/give/checkout/${id}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("simulator mode");

    // JS SDK createOrder → buyer approves at "PayPal" → onApprove capture.
    const order = await ctx.app.inject({ method: "POST", url: `/api/donations/${id}/order`, payload: { fundingSource: "venmo" } });
    expect(order.statusCode).toBe(200);
    const { orderId } = order.json();
    const early = await ctx.app.inject({ method: "POST", url: `/api/donations/${id}/capture`, payload: { orderId } });
    expect(early.statusCode).toBe(502); // ORDER_NOT_APPROVED from PayPal
    ctx.sim.approveOrder(orderId, "donor");
    const cap = await ctx.app.inject({ method: "POST", url: `/api/donations/${id}/capture`, payload: { orderId } });
    expect(cap.statusCode).toBe(200);
    expect(cap.json().redirect).toBe(`http://tideover.test/f/${slug}/thanks/${id}`);
    // Capturing twice is harmless.
    const again = await ctx.app.inject({ method: "POST", url: `/api/donations/${id}/capture`, payload: { orderId } });
    expect(again.statusCode).toBe(200);
    await settle(ctx);
    return id as string;
  }

  it("a sponsored need is paid out the moment the gift is captured", async () => {
    const pub = (await ctx.app.inject({ method: "GET", url: "/api/funds/riverside-college" })).json();
    expect(pub.needs).toHaveLength(1);
    const need = pub.needs[0];
    expect(need.amountCents).toBe(42_000);

    const donationId = await give("riverside-college", 42_000 + 1_300, need.id);
    const status = (await ctx.app.inject({ method: "GET", url: `/api/donations/${donationId}` })).json();
    expect(status.status).toBe("captured");
    expect(status.need.status).toBe("paid");

    const [d] = await ctx.s.db.select().from(donations).where(eq(donations.id, donationId));
    expect(d!.feeCents).toBe(Math.round(43_300 * 0.0199) + 49);
    expect(d!.donorEmail).toBe("alex.rivera@donor.example.com");
    const after = (await ctx.app.inject({ method: "GET", url: "/api/funds/riverside-college" })).json();
    expect(after.needs).toHaveLength(0);
    expect(after.feed.some((f: { kind: string }) => f.kind === "grant")).toBe(true);
  });

  it("requires two different reviewers above the dual-approval threshold, then waits for funds", async () => {
    const [darnell] = await ctx.s.db.select().from(applications).where(eq(applications.amountRequestedCents, 75_000));
    const admin = await staffToken(ctx.app, "admin");
    const reviewer = await staffToken(ctx.app, "reviewer");

    const first = await ctx.app.inject({
      method: "POST",
      url: `/api/staff/cases/${darnell!.id}/approve`,
      headers: { authorization: `Bearer ${admin}` },
      payload: { amountCents: 75_000 },
    });
    expect(first.json()).toMatchObject({ status: "pending_second_approval", approvals: 1, required: 2 });
    // The same person approving again doesn't count twice.
    const dup = await ctx.app.inject({
      method: "POST",
      url: `/api/staff/cases/${darnell!.id}/approve`,
      headers: { authorization: `Bearer ${admin}` },
      payload: { amountCents: 75_000 },
    });
    expect(dup.json().status).toBe("pending_second_approval");

    const second = await ctx.app.inject({
      method: "POST",
      url: `/api/staff/cases/${darnell!.id}/approve`,
      headers: { authorization: `Bearer ${reviewer}` },
      payload: { amountCents: 75_000 },
    });
    expect(second.json().status).toBe("approved");
    await settle(ctx);

    // Eastside has ~$992 available: $750 + fee fits, so it pays now.
    let [row] = await ctx.s.db.select().from(applications).where(eq(applications.id, darnell!.id));
    expect(row!.status).toBe("paid");

    // Next approval exceeds what's left: it becomes a sponsorable need instead of overdrawing.
    const [lucia] = await ctx.s.db.select().from(applications).where(eq(applications.amountRequestedCents, 28_640));
    const fundId = lucia!.fundId;
    expect(await availableCents(ctx.s.db, fundId)).toBeLessThan(28_640);
    await ctx.app.inject({
      method: "POST",
      url: `/api/staff/cases/${lucia!.id}/approve`,
      headers: { authorization: `Bearer ${reviewer}` },
      payload: {},
    });
    await settle(ctx);
    [row] = await ctx.s.db.select().from(applications).where(eq(applications.id, lucia!.id));
    expect(row!.status).toBe("awaiting_funds");
    expect(await ctx.s.db.select().from(payouts).where(eq(payouts.applicationId, lucia!.id))).toHaveLength(0);

    // A general gift to the fund releases it automatically.
    await give("eastside", 50_000);
    [row] = await ctx.s.db.select().from(applications).where(eq(applications.id, lucia!.id));
    expect(row!.status).toBe("paid");
    expect(await availableCents(ctx.s.db, fundId)).toBeGreaterThanOrEqual(0);
  });

  it("denial sends a reason and closes the case", async () => {
    const cases = await ctx.s.db.select().from(applications).where(eq(applications.status, "in_review"));
    const suspicious = cases.find((c) => c.category === "car_repair")!;
    const token = await staffToken(ctx.app, "reviewer");
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/staff/cases/${suspicious.id}/deny`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: "We couldn't verify the repair or the shop." },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await ctx.s.db.select().from(applications).where(eq(applications.id, suspicious.id));
    expect(row!.status).toBe("denied");
    const again = await ctx.app.inject({
      method: "POST",
      url: `/api/staff/cases/${suspicious.id}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(again.statusCode).toBe(409);
  });

  it("refuses gifts to a need that is already funded", async () => {
    const [need] = await ctx.s.db.select().from(applications).where(eq(applications.status, "awaiting_funds"));
    await ctx.s.db.update(applications).set({ status: "paid" }).where(eq(applications.id, need!.id));
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/funds/riverside-college/donations",
      payload: { amountCents: 42_000, applicationId: need!.id },
    });
    expect(res.statusCode).toBe(409);
  });

  it("dashboard and staff endpoints require a session", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/staff/dashboard" })).statusCode).toBe(401);
    const token = await staffToken(ctx.app);
    const dash = await ctx.app.inject({ method: "GET", url: "/api/staff/dashboard", headers: { authorization: `Bearer ${token}` } });
    expect(dash.statusCode).toBe(200);
    expect(dash.json().series).toHaveLength(14);
    expect(dash.json().byStatus.in_review).toBe(3);
  });

  it("only admins can change fund settings", async () => {
    const [fund] = await ctx.s.db.select().from(funds).where(eq(funds.slug, "eastside"));
    const reviewer = await staffToken(ctx.app, "reviewer");
    const denied = await ctx.app.inject({
      method: "PUT",
      url: `/api/staff/funds/${fund!.id}`,
      headers: { authorization: `Bearer ${reviewer}` },
      payload: { autoApproveLimitCents: 10_000 },
    });
    expect(denied.statusCode).toBe(403);
    const admin = await staffToken(ctx.app, "admin");
    const ok = await ctx.app.inject({
      method: "PUT",
      url: `/api/staff/funds/${fund!.id}`,
      headers: { authorization: `Bearer ${admin}` },
      payload: { autoApproveLimitCents: 10_000 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().autoApproveLimitCents).toBe(10_000);
  });
});
