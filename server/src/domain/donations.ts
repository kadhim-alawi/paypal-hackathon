import { eq } from "drizzle-orm";
import { type Donation, donations, type Fund } from "../db/schema.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { newId } from "../lib/ids.js";
import { formatMoney, toCents } from "../lib/money.js";
import { withLock } from "../lib/mutex.js";
import { approvalUrl, type FundingSource, type PayPalOrder } from "../paypal/index.js";
import type { Services } from "../services.js";
import { loadApplication, loadFund, loadFundBySlug } from "./applications.js";
import { audit } from "./audit.js";
import { fundAwaitingNeeds } from "./disbursement.js";
import { postLedger } from "./ledger.js";
import { donationView } from "./views.js";

export const MIN_DONATION_CENTS = 100;
export const MAX_DONATION_CENTS = 1_000_000;

export async function loadDonation(s: Services, id: string): Promise<Donation> {
  const [row] = await s.db.select().from(donations).where(eq(donations.id, id)).limit(1);
  if (!row) throw notFound("Donation");
  return row;
}

export async function createDonation(
  s: Services,
  input: {
    fundSlug: string;
    amountCents: number;
    applicationId?: string | null;
    donorName?: string | null;
    donorMessage?: string | null;
    anonymous?: boolean;
    source?: "web" | "agent";
    agentName?: string | null;
  },
): Promise<{ donation: Donation; checkoutUrl: string }> {
  const fund = await loadFundBySlug(s, input.fundSlug);
  const amount = Math.round(input.amountCents);
  if (!Number.isFinite(amount) || amount < MIN_DONATION_CENTS) throw badRequest("The minimum gift is $1.");
  if (amount > MAX_DONATION_CENTS) throw badRequest("For gifts over $10,000 please contact the fund.");
  if (input.applicationId) {
    const app = await loadApplication(s, input.applicationId);
    if (app.fundId !== fund.id || app.status !== "awaiting_funds") {
      throw conflict("That need has already been funded. Your gift can still go to the fund.");
    }
  }
  const [donation] = await s.db
    .insert(donations)
    .values({
      id: newId("don"),
      fundId: fund.id,
      applicationId: input.applicationId ?? null,
      amountCents: amount,
      currency: fund.currency,
      donorName: input.donorName?.trim().slice(0, 80) || null,
      donorMessage: input.donorMessage?.trim().slice(0, 280) || null,
      anonymous: input.anonymous ?? false,
      source: input.source ?? "web",
      agentName: input.agentName?.slice(0, 60) ?? null,
    })
    .returning();
  return { donation: donation!, checkoutUrl: `${s.config.publicUrl}/give/checkout/${donation!.id}` };
}

/** Creates the PayPal order for a donation (JS SDK buttons or redirect flow). */
export async function createDonationOrder(
  s: Services,
  donationId: string,
  opts: { flow: "buttons" | "redirect"; fundingSource?: FundingSource },
): Promise<PayPalOrder> {
  const donation = await loadDonation(s, donationId);
  if (donation.status === "captured") throw conflict("This gift was already completed. Thank you!");
  const fund = await loadFund(s, donation.fundId);
  const order = await s.paypal.createOrder({
    referenceId: donation.id,
    description: donation.applicationId
      ? `Gift to ${fund.name}: fund an approved emergency grant`
      : `Gift to ${fund.name}`,
    amountCents: donation.amountCents,
    currency: donation.currency,
    brandName: `Tideover · ${fund.name}`,
    // One PayPal order per donation, flow and funding source.
    requestId: `${donation.id}-${opts.flow}-${opts.fundingSource ?? "paypal"}`,
    flow: opts.flow,
    fundingSource: opts.fundingSource,
    returnUrl: `${s.config.publicUrl}/api/donations/${donation.id}/return`,
    cancelUrl: `${s.config.publicUrl}/f/${fund.slug}?gift=cancelled`,
  });
  await s.db.update(donations).set({ paypalOrderId: order.id, status: "created" }).where(eq(donations.id, donation.id));
  return order;
}

export function orderApprovalUrl(order: PayPalOrder): string {
  const url = approvalUrl(order);
  if (!url) throw new Error("PayPal did not return an approval link");
  return url;
}

/**
 * Captures an approved PayPal order. Safe to call from the browser callback,
 * the redirect return URL and the webhook: whichever comes first wins.
 */
export async function captureDonation(s: Services, donationId: string, orderId?: string): Promise<Donation> {
  return withLock(`donation:${donationId}`, async () => {
    const donation = await loadDonation(s, donationId);
    if (donation.status === "captured") return donation;
    const paypalOrderId = orderId ?? donation.paypalOrderId;
    if (!paypalOrderId) throw badRequest("No PayPal order for this gift yet.");
    if (donation.paypalOrderId && orderId && donation.paypalOrderId !== orderId) {
      // The JS SDK can create a fresh order per funding source; trust the order the buyer approved
      // only if it belongs to this donation.
      const check = await s.paypal.getOrder(orderId);
      if (check.purchase_units?.[0]?.custom_id !== donation.id) throw badRequest("Order does not match this gift.");
    }
    const order = await s.paypal.captureOrder(paypalOrderId, `${donation.id}-capture`);
    return recordCapture(s, donation, order);
  });
}

export async function recordCapture(s: Services, donation: Donation, order: PayPalOrder): Promise<Donation> {
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (order.status !== "COMPLETED" || !capture || capture.status !== "COMPLETED") {
    await s.db.update(donations).set({ status: "failed" }).where(eq(donations.id, donation.id));
    throw conflict("PayPal did not complete the payment. No money was taken.");
  }
  const fund = await loadFund(s, donation.fundId);
  const gross = toCents(capture.amount.value);
  const fee = capture.seller_receivable_breakdown?.paypal_fee
    ? toCents(capture.seller_receivable_breakdown.paypal_fee.value)
    : 0;
  const payer = order.payer ?? {};
  const wallet = order.payment_source?.paypal ?? order.payment_source?.venmo;
  const name =
    donation.donorName ??
    ([payer.name?.given_name ?? wallet?.name?.given_name, payer.name?.surname ?? wallet?.name?.surname]
      .filter(Boolean)
      .join(" ") ||
      null);
  const [updated] = await s.db
    .update(donations)
    .set({
      status: "captured",
      paypalOrderId: order.id,
      paypalCaptureId: capture.id,
      feeCents: fee,
      netCents: gross - fee,
      donorName: name,
      donorEmail: payer.email_address ?? wallet?.email_address ?? null,
      capturedAt: new Date(),
    })
    .where(eq(donations.id, donation.id))
    .returning();
  await postLedger(s.db, {
    fundId: fund.id,
    kind: "donation",
    amountCents: gross,
    refType: "donation",
    refId: donation.id,
    memo: `PayPal capture ${capture.id}`,
  });
  if (fee) {
    await postLedger(s.db, {
      fundId: fund.id,
      kind: "donation_fee",
      amountCents: -fee,
      refType: "donation",
      refId: donation.id,
      memo: "PayPal processing fee",
    });
  }
  await audit(s.db, {
    fundId: fund.id,
    entityType: "donation",
    entityId: donation.id,
    actorType: donation.source === "agent" ? "agent" : "donor",
    actorName: name ?? "Anonymous donor",
    action: "donation.captured",
    summary: `${formatMoney(gross, fund.currency)} donation captured via PayPal (capture ${capture.id}, fee ${formatMoney(fee, fund.currency)})${donation.source === "agent" ? ` - initiated by AI agent ${donation.agentName ?? ""}` : ""}`,
  });
  s.bus.publish(`fund:${fund.id}`, "donation.captured", donationView(updated!, { staff: false }));
  s.bus.publish("staff", "donation.captured", donationView(updated!, { staff: true }));
  // New money: pay the sponsored need first, then anyone else waiting.
  void fundAwaitingNeeds(s, fund.id, donation.applicationId);
  return updated!;
}

export async function refundDonation(
  s: Services,
  donationId: string,
  actor: { id: string; name: string },
  reason: string,
): Promise<Donation> {
  const donation = await loadDonation(s, donationId);
  if (donation.status !== "captured" || !donation.paypalCaptureId) throw conflict("Only completed gifts can be refunded.");
  const fund: Fund = await loadFund(s, donation.fundId);
  const refund = await s.paypal.refundCapture(donation.paypalCaptureId, {
    currency: donation.currency,
    note: reason || `Refund from ${fund.name}`,
    requestId: `${donation.id}-refund`,
  });
  if (refund.status !== "COMPLETED" && refund.status !== "PENDING") throw conflict(`PayPal refund ${refund.status}`);
  const [updated] = await s.db
    .update(donations)
    .set({ status: "refunded" })
    .where(eq(donations.id, donation.id))
    .returning();
  await postLedger(s.db, {
    fundId: fund.id,
    kind: "refund",
    amountCents: -donation.amountCents,
    refType: "donation",
    refId: donation.id,
    memo: `Refund ${refund.id}`,
  });
  await audit(s.db, {
    fundId: fund.id,
    entityType: "donation",
    entityId: donation.id,
    actorType: "staff",
    actorId: actor.id,
    actorName: actor.name,
    action: "donation.refunded",
    summary: `${actor.name} refunded ${formatMoney(donation.amountCents, fund.currency)} (PayPal refund ${refund.id}): ${reason}`,
  });
  return updated!;
}
