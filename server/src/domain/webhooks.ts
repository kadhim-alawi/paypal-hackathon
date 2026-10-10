import { eq } from "drizzle-orm";
import { donations, payouts, webhookEvents } from "../db/schema.js";
import type { PayPalOrder, PayoutItem, WebhookEvent } from "../paypal/index.js";
import type { Services } from "../services.js";
import { audit } from "./audit.js";
import { applyPayoutItem, findPayoutForItem, syncPayout } from "./disbursement.js";
import { captureDonation, recordCapture } from "./donations.js";
import { postLedger } from "./ledger.js";

/**
 * Processes a PayPal webhook event exactly once (keyed by event id).
 * Webhooks make the system fast; the payout poller and synchronous capture
 * make it correct even when a webhook never arrives.
 */
export async function handlePayPalWebhook(s: Services, event: WebhookEvent, verified: boolean): Promise<"processed" | "duplicate" | "ignored"> {
  const inserted = await s.db
    .insert(webhookEvents)
    .values({
      id: event.id,
      eventType: event.event_type,
      resourceId: typeof event.resource?.id === "string" ? event.resource.id : null,
      verified,
      payload: event as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (inserted.length === 0) return "duplicate";
  if (!verified) {
    await s.db.update(webhookEvents).set({ error: "signature verification failed" }).where(eq(webhookEvents.id, event.id));
    return "ignored";
  }

  try {
    const type = event.event_type;
    const resource = event.resource ?? {};
    if (type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
      const item = resource as unknown as PayoutItem;
      const payout = await findPayoutForItem(s, item);
      if (payout) await s.jobs.run(payout.applicationId, "payout-webhook", () => applyPayoutItem(s, payout.id, item));
    } else if (type.startsWith("PAYMENT.PAYOUTSBATCH.")) {
      const batchId = (resource as { batch_header?: { payout_batch_id?: string } }).batch_header?.payout_batch_id;
      if (batchId) {
        const rows = await s.db.select().from(payouts).where(eq(payouts.paypalBatchId, batchId));
        for (const p of rows) await s.jobs.run(p.applicationId, "payout-sync", () => syncPayout(s, p.id));
      }
    } else if (type === "CHECKOUT.ORDER.APPROVED") {
      // The buyer approved but our capture call may never have happened (closed tab).
      const order = resource as unknown as PayPalOrder;
      const donationId = order.purchase_units?.[0]?.custom_id;
      if (donationId) await captureDonation(s, donationId, order.id).catch((err) => s.log.warn({ err }, "webhook capture"));
    } else if (type === "PAYMENT.CAPTURE.COMPLETED") {
      const donationId = resource.custom_id as string | undefined;
      const orderId = (resource.supplementary_data as { related_ids?: { order_id?: string } } | undefined)?.related_ids
        ?.order_id;
      if (donationId && orderId) {
        const [donation] = await s.db.select().from(donations).where(eq(donations.id, donationId)).limit(1);
        if (donation && donation.status !== "captured") {
          const order = await s.paypal.getOrder(orderId);
          if (order.status === "COMPLETED") await recordCapture(s, donation, order);
        }
      }
    } else if (type === "PAYMENT.CAPTURE.REFUNDED" || type === "PAYMENT.CAPTURE.REVERSED") {
      const captureId = resource.id as string | undefined;
      if (captureId) {
        const [donation] = await s.db.select().from(donations).where(eq(donations.paypalCaptureId, captureId)).limit(1);
        if (donation && donation.status === "captured") {
          await s.db.update(donations).set({ status: "refunded" }).where(eq(donations.id, donation.id));
          await postLedger(s.db, {
            fundId: donation.fundId,
            kind: "refund",
            amountCents: -donation.amountCents,
            refType: "donation",
            refId: donation.id,
            memo: `${type} (webhook)`,
          });
          await audit(s.db, {
            fundId: donation.fundId,
            entityType: "donation",
            entityId: donation.id,
            actorType: "paypal",
            action: "donation.refunded",
            summary: `PayPal reported the capture as ${type.split(".").pop()!.toLowerCase()}`,
          });
        }
      }
    } else {
      await s.db.update(webhookEvents).set({ processedAt: new Date(), error: "unhandled type" }).where(eq(webhookEvents.id, event.id));
      return "ignored";
    }
    await s.db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, event.id));
    return "processed";
  } catch (err) {
    s.log.error({ err, eventId: event.id }, "webhook processing failed");
    await s.db.update(webhookEvents).set({ error: String(err) }).where(eq(webhookEvents.id, event.id));
    return "ignored";
  }
}
