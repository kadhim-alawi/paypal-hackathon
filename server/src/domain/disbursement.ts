import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { type Application, applications, type Fund, type Payout, payouts } from "../db/schema.js";
import { newId } from "../lib/ids.js";
import { formatMoney, toCents } from "../lib/money.js";
import { withLock } from "../lib/mutex.js";
import { mapPayoutStatus, PayPalApiError, type PayoutItem } from "../paypal/index.js";
import type { Services } from "../services.js";
import { addMessage, loadApplication, loadFund, patchApplication, publishApplication } from "./applications.js";
import { audit } from "./audit.js";
import { availableCents, postLedger } from "./ledger.js";
import type { PayoutStatus } from "./types.js";
import { minutesToCash, payoutLabel, payoutView } from "./views.js";

/** PayPal Payouts US domestic fee estimate: 2% (min $0.25, max $20). */
export const estimatePayoutFee = (cents: number) => Math.min(2000, Math.max(25, Math.round(cents * 0.02)));

const FINAL: PayoutStatus[] = ["success", "failed", "returned", "blocked", "canceled"];

function recipientFor(app: Application) {
  switch (app.payoutMethod) {
    case "paypal_account":
      return { recipientType: "PAYPAL_ID" as const, recipientWallet: "PAYPAL" as const, receiver: app.paypalPayerId! };
    case "venmo_phone":
      return { recipientType: "PHONE" as const, recipientWallet: "VENMO" as const, receiver: app.payoutReceiver! };
    default:
      return { recipientType: "EMAIL" as const, recipientWallet: "PAYPAL" as const, receiver: app.payoutReceiver! };
  }
}

/**
 * Sends an approved grant through PayPal Payouts.
 * Guarantees: never pays a request that isn't approved, never exceeds the
 * approved amount, never overdraws the fund (per-fund lock + ledger), and is
 * idempotent (sender_batch_id + PayPal-Request-Id).
 */
export async function disburse(s: Services, appId: string, opts: { actor: "staff" | "ai" | "system" | "donor" }) {
  let app = await loadApplication(s, appId);
  if (!["approved", "awaiting_funds", "payout_failed"].includes(app.status)) return;
  const fund = await loadFund(s, app.fundId);
  const amount = app.amountApprovedCents ?? 0;
  if (amount <= 0) return;

  if (!app.payoutMethod || !(app.paypalPayerId || app.payoutReceiver)) {
    if (app.status !== "approved") app = await patchApplication(s, app.id, { status: "approved" });
    await addMessage(
      s,
      app.id,
      "event",
      "Approved! Choose how you'd like to receive the money below and we'll send it right away.",
      { ui: "need_payout_destination", hiddenFromAi: true },
    );
    await publishApplication(s, app.id);
    return;
  }

  const payout = await withLock(`treasury:${fund.id}`, async () => {
    const existing = await s.db
      .select()
      .from(payouts)
      .where(and(eq(payouts.applicationId, app.id), inArray(payouts.status, ["pending", "processing", "held", "success", "unclaimed"])))
      .limit(1);
    if (existing[0]) return null; // already paying or paid: idempotent no-op

    const available = await availableCents(s.db, fund.id);
    const needed = amount + estimatePayoutFee(amount);
    if (available < needed) {
      if (app.status !== "awaiting_funds") {
        app = await patchApplication(s, app.id, { status: "awaiting_funds" });
        await audit(s.db, {
          fundId: fund.id,
          entityType: "application",
          entityId: app.id,
          actorType: "system",
          action: "payout.awaiting_funds",
          summary: `Fund balance ${formatMoney(available, fund.currency)} is below ${formatMoney(needed, fund.currency)}; request listed for donors`,
        });
        const text = await s.ai
          .decisionMessage({
            fundName: fund.name,
            language: app.language,
            firstName: app.facts.firstName,
            kind: "awaiting_funds",
            amountCents: amount,
            currency: fund.currency,
          })
          .catch(() => `Your request was approved. We'll send the money as soon as new donations arrive.`);
        await addMessage(s, app.id, "assistant", text, { ui: "awaiting_funds" });
        s.bus.publish(`fund:${fund.id}`, "need.added", { applicationId: app.id });
        await publishApplication(s, app.id);
      }
      return null;
    }

    const id = newId("pay");
    const recipient = recipientFor(app);
    const [row] = await s.db
      .insert(payouts)
      .values({
        id,
        applicationId: app.id,
        fundId: fund.id,
        amountCents: amount,
        currency: fund.currency,
        status: "pending",
        senderBatchId: `TDO_${id}`,
        method: app.payoutMethod!,
        receiver: recipient.receiver,
      })
      .returning();
    await patchApplication(s, app.id, { status: "paying" });
    return row!;
  });
  if (!payout) return;
  await publishApplication(s, app.id);
  await sendPayout(s, payout, app, fund, opts.actor);
}

async function sendPayout(s: Services, payout: Payout, app: Application, fund: Fund, actor: string): Promise<void> {
  const recipient = recipientFor(app);
  try {
    const batch = await s.paypal.createPayout({
      senderBatchId: payout.senderBatchId,
      senderItemId: payout.id,
      emailSubject: `${fund.name} sent you ${formatMoney(payout.amountCents, fund.currency)}`,
      emailMessage: `This is your emergency grant from ${fund.name} (request ${app.publicRef}). We hope it helps.`,
      note: `Emergency grant from ${fund.name}, request ${app.publicRef}`,
      amountCents: payout.amountCents,
      currency: payout.currency,
      ...recipient,
    });
    const [updated] = await s.db
      .update(payouts)
      .set({
        status: "processing",
        paypalBatchId: batch.batch_header.payout_batch_id,
        sentAt: new Date(),
        lastCheckedAt: new Date(),
      })
      .where(eq(payouts.id, payout.id))
      .returning();
    await postLedger(s.db, {
      fundId: fund.id,
      kind: "payout",
      amountCents: -payout.amountCents,
      refType: "payout",
      refId: payout.id,
      memo: `Grant ${app.publicRef}`,
    });
    await audit(s.db, {
      fundId: fund.id,
      entityType: "payout",
      entityId: payout.id,
      actorType: "system",
      actorName: `PayPal Payouts (${s.paypal.mode})`,
      action: "payout.sent",
      summary: `Sent ${formatMoney(payout.amountCents, fund.currency)} to ${payoutLabel(app) ?? "recipient"} via PayPal Payouts (batch ${batch.batch_header.payout_batch_id})`,
      data: { trigger: actor, batchStatus: batch.batch_header.batch_status },
    });
    await audit(s.db, {
      fundId: fund.id,
      entityType: "application",
      entityId: app.id,
      actorType: "system",
      action: "payout.sent",
      summary: `Payout sent through PayPal (batch ${batch.batch_header.payout_batch_id})`,
    });
    s.bus.publish("staff", "payout.updated", payoutView(updated!));
    await publishApplication(s, app.id);
    // Sandbox payouts usually settle within seconds; check again shortly.
    setTimeout(() => void s.jobs.run(app.id, "payout-sync", () => syncPayout(s, payout.id)), 1500).unref?.();
  } catch (err) {
    const transient = !(err instanceof PayPalApiError) || err.status >= 500 || err.status === 429;
    s.log.error({ err, payoutId: payout.id }, "PayPal payout request failed");
    if (transient) {
      // Leave it pending: the poller retries with the same idempotency key.
      await s.db.update(payouts).set({ lastCheckedAt: new Date(), errorMessage: String(err) }).where(eq(payouts.id, payout.id));
      return;
    }
    await failPayout(s, payout, app, fund, {
      code: err.issue ?? err.name,
      message: err.message,
      status: "failed",
    });
  }
}

async function failPayout(
  s: Services,
  payout: Payout,
  app: Application,
  fund: Fund,
  input: { code: string; message: string; status: PayoutStatus },
) {
  const [updated] = await s.db
    .update(payouts)
    .set({ status: input.status, errorCode: input.code, errorMessage: input.message, completedAt: new Date() })
    .where(eq(payouts.id, payout.id))
    .returning();
  if (payout.paypalBatchId) {
    // Money left the balance when the batch was accepted; it comes back on failure.
    await postLedger(s.db, {
      fundId: fund.id,
      kind: "payout_reversal",
      amountCents: payout.amountCents,
      refType: "payout",
      refId: payout.id,
      memo: `Payout ${input.status}: ${input.code}`,
    });
  }
  await patchApplication(s, app.id, { status: "payout_failed" });
  await audit(s.db, {
    fundId: fund.id,
    entityType: "payout",
    entityId: payout.id,
    actorType: "paypal",
    action: `payout.${input.status}`,
    summary: `Payout ${input.status}: ${input.code} ${input.message}`,
  });
  await addMessage(
    s,
    app.id,
    "assistant",
    "We approved your request, but PayPal couldn't deliver the money to the account you gave us. Please double-check your payout details below, or reply here and our team will help.",
    { ui: "payout_failed" },
  );
  s.bus.publish("staff", "payout.updated", payoutView(updated!));
  await publishApplication(s, app.id);
}

/** Pulls the latest status of a payout from PayPal (poller + post-send check). */
export async function syncPayout(s: Services, payoutId: string): Promise<void> {
  const [payout] = await s.db.select().from(payouts).where(eq(payouts.id, payoutId)).limit(1);
  if (!payout || FINAL.includes(payout.status)) return;
  const app = await loadApplication(s, payout.applicationId);
  const fund = await loadFund(s, payout.fundId);

  if (!payout.paypalBatchId) {
    // A transient error left it pending: retry with the same idempotency key.
    await sendPayout(s, payout, app, fund, "retry");
    return;
  }
  const batch = await s.paypal.getPayoutBatch(payout.paypalBatchId);
  const item = batch.items?.[0];
  if (!item) {
    await s.db.update(payouts).set({ lastCheckedAt: new Date() }).where(eq(payouts.id, payout.id));
    return;
  }
  await applyPayoutItem(s, payout.id, item);
}

/** Applies a PayPal payout item (from polling or a webhook) to Tideover's state. */
export async function applyPayoutItem(s: Services, payoutId: string, item: PayoutItem): Promise<void> {
  await withLock(`payout:${payoutId}`, async () => {
    const [payout] = await s.db.select().from(payouts).where(eq(payouts.id, payoutId)).limit(1);
    if (!payout) return;
    const status = mapPayoutStatus(item.transaction_status);
    const feeCents = item.payout_item_fee?.value ? toCents(item.payout_item_fee.value) : null;
    const base = {
      paypalItemId: item.payout_item_id,
      paypalTransactionId: payout.paypalTransactionId ?? item.transaction_id ?? null,
      paypalTransactionStatus: item.transaction_status ?? null,
      feeCents: feeCents ?? payout.feeCents,
      lastCheckedAt: new Date(),
    };
    if (status === payout.status || status === "processing") {
      await s.db.update(payouts).set(base).where(eq(payouts.id, payout.id));
      return;
    }
    if (FINAL.includes(payout.status) && !(payout.status === "success" && status === "returned")) return;

    const app = await loadApplication(s, payout.applicationId);
    const fund = await loadFund(s, payout.fundId);

    if (status === "failed" || status === "blocked" || status === "returned") {
      await s.db.update(payouts).set(base).where(eq(payouts.id, payout.id));
      await failPayout(s, { ...payout, ...base }, app, fund, {
        code: item.errors?.name ?? item.transaction_status ?? "FAILED",
        message: item.errors?.message ?? "PayPal could not complete the payout",
        status,
      });
      return;
    }

    const [updated] = await s.db
      .update(payouts)
      .set({ ...base, status, completedAt: status === "success" ? new Date() : null })
      .where(eq(payouts.id, payout.id))
      .returning();
    if (feeCents) {
      await postLedger(s.db, {
        fundId: fund.id,
        kind: "payout_fee",
        amountCents: -feeCents,
        refType: "payout",
        refId: payout.id,
        memo: "PayPal Payouts fee",
      });
    }
    s.bus.publish("staff", "payout.updated", payoutView(updated!));

    if (status === "success") {
      const paid = await patchApplication(s, app.id, { status: "paid", paidAt: new Date() });
      const minutes = minutesToCash(paid);
      await audit(s.db, {
        fundId: fund.id,
        entityType: "application",
        entityId: app.id,
        actorType: "paypal",
        action: "payout.succeeded",
        summary: `PayPal confirmed ${formatMoney(payout.amountCents, fund.currency)} delivered${minutes != null ? ` (${Math.round(minutes)} min after submission)` : ""}`,
      });
      const text = await s.ai
        .decisionMessage({
          fundName: fund.name,
          language: app.language,
          firstName: app.facts.firstName,
          kind: "paid",
          amountCents: payout.amountCents,
          currency: fund.currency,
          payoutLabel: payoutLabel(app),
        })
        .catch(() => `${formatMoney(payout.amountCents, fund.currency)} has been sent. We hope this helps.`);
      await addMessage(s, app.id, "assistant", text, { ui: "paid", amountCents: payout.amountCents });
      s.bus.publish(`fund:${fund.id}`, "grant.paid", {
        applicationId: app.id,
        amountCents: payout.amountCents,
        minutesToCash: minutes,
      });
      const { writePublicStory } = await import("./funds.js");
      void s.jobs.run(`story:${app.id}`, "public-story", () => writePublicStory(s, app.id));
    } else if (status === "unclaimed") {
      await patchApplication(s, app.id, { status: "unclaimed", paidAt: new Date() });
      await audit(s.db, {
        fundId: fund.id,
        entityType: "application",
        entityId: app.id,
        actorType: "paypal",
        action: "payout.unclaimed",
        summary: "PayPal sent the money, but the recipient has no PayPal account yet (unclaimed)",
      });
      await addMessage(
        s,
        app.id,
        "assistant",
        `We sent ${formatMoney(payout.amountCents, fund.currency)}! PayPal emailed instructions to ${payoutLabel(app) ?? "you"}. To receive it, sign up for a free PayPal account with that same email or phone within 30 days.`,
        { ui: "unclaimed" },
      );
    }
    await publishApplication(s, app.id);
  });
}

/** Finds the payout a PayPal webhook resource refers to. */
export async function findPayoutForItem(s: Services, item: PayoutItem): Promise<Payout | null> {
  const senderItemId = item.payout_item?.sender_item_id;
  const [row] = await s.db
    .select()
    .from(payouts)
    .where(
      or(
        item.payout_item_id ? eq(payouts.paypalItemId, item.payout_item_id) : undefined,
        senderItemId ? eq(payouts.id, senderItemId) : undefined,
        item.payout_batch_id ? eq(payouts.paypalBatchId, item.payout_batch_id) : undefined,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** After new money arrives, pay approved requests that were waiting on funds (oldest first). */
export async function fundAwaitingNeeds(s: Services, fundId: string, preferApplicationId?: string | null) {
  const waiting = await s.db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.fundId, fundId), eq(applications.status, "awaiting_funds")))
    .orderBy(asc(applications.decidedAt));
  const ordered = preferApplicationId
    ? [...waiting.filter((w) => w.id === preferApplicationId), ...waiting.filter((w) => w.id !== preferApplicationId)]
    : waiting;
  for (const { id } of ordered) {
    await s.jobs.run(id, "disburse", () => disburse(s, id, { actor: "donor" }));
  }
}

/** Background safety net: re-checks in-flight payouts (webhooks may be delayed or missing). */
export function startPayoutPoller(s: Services): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const staleUnclaimed = new Date(Date.now() - 10 * 60_000);
      const due = await s.db
        .select({ id: payouts.id, applicationId: payouts.applicationId })
        .from(payouts)
        .where(
          or(
            inArray(payouts.status, ["pending", "processing", "held"]),
            and(eq(payouts.status, "unclaimed"), or(isNull(payouts.lastCheckedAt), lt(payouts.lastCheckedAt, staleUnclaimed))),
          ),
        )
        .limit(50);
      for (const p of due) {
        await s.jobs.run(p.applicationId, "payout-sync", () => syncPayout(s, p.id));
      }
    } catch (err) {
      s.log.error({ err }, "payout poller tick failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), s.config.payoutPollIntervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
