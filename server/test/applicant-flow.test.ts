import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HeuristicAi } from "../src/ai/heuristic.js";
import type { AssessmentContext } from "../src/ai/types.js";
import { applications, auditEvents, funds, payouts } from "../src/db/schema.js";
import { fundBalanceCents } from "../src/domain/ledger.js";
import { makeApp, multipartBody, settle, staffToken, type TestCtx } from "./helpers.js";

const estimate = readFileSync(new URL("../../demo-assets/eastside-auto-estimate-380.jpg", import.meta.url));

async function startRequest(ctx: TestCtx, slug = "eastside") {
  const res = await ctx.app.inject({ method: "POST", url: `/api/funds/${slug}/applications`, payload: {} });
  expect(res.statusCode).toBe(201);
  const { id, token, publicRef } = res.json();
  expect(publicRef).toMatch(/^TDO-[0-9A-Z]{5}$/);
  const headers = { "x-applicant-token": token };
  return { id: id as string, token: token as string, headers };
}

async function connectPayPal(ctx: TestCtx, id: string, headers: Record<string, string>, persona = "maria") {
  const start = await ctx.app.inject({ method: "GET", url: `/api/applications/${id}/paypal/connect`, headers });
  expect(start.statusCode).toBe(200);
  const loginUrl = new URL(start.json().url);
  expect(loginUrl.pathname).toBe("/sim/paypal/login");
  const consent = await ctx.app.inject({
    method: "POST",
    url: "/sim/paypal/login",
    payload: {
      state: loginUrl.searchParams.get("state"),
      redirect_uri: loginUrl.searchParams.get("redirect_uri"),
      persona,
    },
  });
  expect(consent.statusCode).toBe(302);
  const callback = new URL(consent.headers.location as string);
  const done = await ctx.app.inject({ method: "GET", url: `${callback.pathname}${callback.search}` });
  expect(done.statusCode).toBe(302);
  expect(done.headers.location).toContain(`/r/${id}?paypal=connected`);
}

async function writeRequest(ctx: TestCtx, id: string, headers: Record<string, string>) {
  const say = async (content: string) => {
    const r = await ctx.app.inject({ method: "POST", url: `/api/applications/${id}/messages`, headers, payload: { content } });
    expect(r.statusCode).toBe(202);
    await settle(ctx);
  };
  await say("My car broke down and I need $380 for a brake repair so I can get to work. I live in 78741 and need it this week.");
  const upload = multipartBody("eastside-auto-estimate-380.jpg", "image/jpeg", estimate);
  const up = await ctx.app.inject({
    method: "POST",
    url: `/api/applications/${id}/documents`,
    headers: { ...headers, ...upload.headers },
    payload: upload.payload,
  });
  expect(up.statusCode).toBe(201);
  await settle(ctx);
}

describe("applicant journey", () => {
  let ctx: TestCtx;
  beforeEach(async () => {
    ctx = await makeApp();
  });
  afterEach(async () => ctx.close());

  it("goes from a chat message to PayPal cash, with a human approval", async () => {
    const { id, headers } = await startRequest(ctx);

    await writeRequest(ctx, id, headers);
    let view = (await ctx.app.inject({ method: "GET", url: `/api/applications/${id}`, headers })).json();
    expect(view.request.category).toBe("car_repair");
    expect(view.request.amountRequestedCents).toBe(38_000);
    expect(view.readyToSubmit).toBe(true);
    expect(view.documents).toHaveLength(1);
    expect(view.documents[0].status).toBe("ready");

    // Submitting without a payout destination is refused.
    const early = await ctx.app.inject({ method: "POST", url: `/api/applications/${id}/submit`, headers, payload: {} });
    expect(early.statusCode).toBe(400);

    await connectPayPal(ctx, id, headers);
    view = (await ctx.app.inject({ method: "GET", url: `/api/applications/${id}`, headers })).json();
    expect(view.payout.method).toBe("paypal_account");
    expect(view.payout.verified).toBe(true);

    const submit = await ctx.app.inject({
      method: "POST",
      url: `/api/applications/${id}/submit`,
      headers,
      payload: { consentPublicStory: true },
    });
    expect(submit.statusCode).toBe(200);
    await settle(ctx);

    const [afterAssess] = await ctx.s.db.select().from(applications).where(eq(applications.id, id));
    expect(afterAssess!.status).toBe("in_review");
    expect(afterAssess!.aiRecommendation).toBe("approve");
    expect(afterAssess!.amountRecommendedCents).toBe(38_000);

    const [fund] = await ctx.s.db.select().from(funds).where(eq(funds.slug, "eastside"));
    const before = await fundBalanceCents(ctx.s.db, fund!.id);

    const token = await staffToken(ctx.app, "reviewer");
    const caseView = await ctx.app.inject({
      method: "GET",
      url: `/api/staff/cases/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(caseView.statusCode).toBe(200);
    expect(caseView.json().assessment.recommendation).toBe("approve");

    const approve = await ctx.app.inject({
      method: "POST",
      url: `/api/staff/cases/${id}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amountCents: 38_000 },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().status).toBe("approved");
    await settle(ctx);

    const [paid] = await ctx.s.db.select().from(applications).where(eq(applications.id, id));
    expect(paid!.status).toBe("paid");
    expect(paid!.paidAt).toBeTruthy();
    const [payout] = await ctx.s.db.select().from(payouts).where(eq(payouts.applicationId, id));
    expect(payout!.status).toBe("success");
    expect(payout!.method).toBe("paypal_account");
    expect(payout!.receiver).toBe("SIMMARIA7Q2L4");
    expect(payout!.feeCents).toBe(760);
    expect(await fundBalanceCents(ctx.s.db, fund!.id)).toBe(before - 38_000 - 760);

    view = (await ctx.app.inject({ method: "GET", url: `/api/applications/${id}`, headers })).json();
    expect(view.status).toBe("paid");
    expect(view.timeline.map((t: { state: string }) => t.state)).toEqual(["done", "done", "done", "done"]);
    expect(view.messages.some((m: { meta: { ui?: string } }) => m.meta.ui === "paid")).toBe(true);

    const trail = await ctx.s.db.select().from(auditEvents).where(eq(auditEvents.entityId, id));
    const actions = trail.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["application.submitted", "ai.assessed", "decision.approved", "payout.sent", "payout.succeeded"]));

    // Public transparency feed shows the grant (anonymized story written after payout).
    const pub = (await ctx.app.inject({ method: "GET", url: "/api/funds/eastside" })).json();
    expect(pub.stats.peopleHelped).toBe(11);
    expect(pub.feed[0].kind).toBe("grant");
    expect(JSON.stringify(pub)).not.toContain("SIMMARIA7Q2L4");
  });

  it("auto-approves a small, verified, well-documented request when the fund allows it", async () => {
    class ConfidentAi extends HeuristicAi {
      override async assess(c: AssessmentContext) {
        const a = await super.assess(c);
        return { ...a, confidence: 0.94 };
      }
    }
    await ctx.close();
    ctx = await makeApp({}, new ConfidentAi());
    await ctx.s.db.update(funds).set({ autoApproveLimitCents: 50_000 }).where(eq(funds.slug, "eastside"));

    const { id, headers } = await startRequest(ctx);
    await writeRequest(ctx, id, headers);
    await connectPayPal(ctx, id, headers);
    const submit = await ctx.app.inject({ method: "POST", url: `/api/applications/${id}/submit`, headers, payload: {} });
    expect(submit.statusCode).toBe(200);
    await settle(ctx);

    const [row] = await ctx.s.db.select().from(applications).where(eq(applications.id, id));
    expect(row!.status).toBe("paid");
    const trail = await ctx.s.db.select().from(auditEvents).where(eq(auditEvents.entityId, id));
    expect(trail.find((a) => a.action === "decision.approved")?.actorName).toBe("Tideover policy engine");
  });

  it("never auto-approves an unverified payout destination", async () => {
    class ConfidentAi extends HeuristicAi {
      override async assess(c: AssessmentContext) {
        return { ...(await super.assess(c)), confidence: 0.99 };
      }
    }
    await ctx.close();
    ctx = await makeApp({}, new ConfidentAi());
    await ctx.s.db.update(funds).set({ autoApproveLimitCents: 50_000 }).where(eq(funds.slug, "eastside"));
    const { id, headers } = await startRequest(ctx);
    await writeRequest(ctx, id, headers);
    const put = await ctx.app.inject({
      method: "PUT",
      url: `/api/applications/${id}/payout`,
      headers,
      payload: { method: "venmo_phone", receiver: "(512) 555-0134" },
    });
    expect(put.statusCode).toBe(200);
    await ctx.app.inject({ method: "POST", url: `/api/applications/${id}/submit`, headers, payload: {} });
    await settle(ctx);
    const [row] = await ctx.s.db.select().from(applications).where(eq(applications.id, id));
    expect(row!.status).toBe("in_review");
    expect(row!.payoutReceiver).toBe("5125550134");
  });

  it("rejects requests without the private token", async () => {
    const { id } = await startRequest(ctx);
    const res = await ctx.app.inject({ method: "GET", url: `/api/applications/${id}` });
    expect(res.statusCode).toBe(401);
    const bad = await ctx.app.inject({ method: "GET", url: `/api/applications/${id}`, headers: { "x-applicant-token": "nope" } });
    expect(bad.statusCode).toBe(401);
  });

  it("does not let a staff member approve above the category cap", async () => {
    const cases = await ctx.s.db.select().from(applications).where(eq(applications.status, "in_review"));
    const car = cases.find((c) => c.category === "car_repair")!;
    const token = await staffToken(ctx.app);
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/staff/cases/${car.id}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amountCents: 90_000 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("cap");
  });
});
