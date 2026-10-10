import { and, isNotNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { donations, payouts } from "../db/schema.js";
import type { SimulatedPayPalGateway, SimulatorHistory } from "./simulator.js";
import type { CreatePayoutInput, PayoutTransactionStatus } from "./types.js";

const RECIPIENT: Record<string, Pick<CreatePayoutInput, "recipientType" | "recipientWallet">> = {
  paypal_account: { recipientType: "PAYPAL_ID", recipientWallet: "PAYPAL" },
  venmo_phone: { recipientType: "PHONE", recipientWallet: "VENMO" },
  paypal_email: { recipientType: "EMAIL", recipientWallet: "PAYPAL" },
};

/**
 * The simulator keeps PayPal's side in memory. On boot, replay what Tideover
 * recorded so refunds, payout polling and transaction search keep working across
 * restarts. Only records that actually went through PayPal are replayed.
 */
export async function restoreSimulatorHistory(db: Db, paypal: SimulatedPayPalGateway): Promise<number> {
  const captured = await db
    .select()
    .from(donations)
    .where(and(isNotNull(donations.paypalOrderId), isNotNull(donations.paypalCaptureId)));
  // Settled payouts carry PayPal's transaction id; in-flight ones are still "processing".
  const sent = (await db.select().from(payouts).where(isNotNull(payouts.paypalBatchId))).filter(
    (p) => p.paypalTransactionId != null || p.status === "processing",
  );

  const history: SimulatorHistory = {
    captures: captured.map((d) => ({
      orderId: d.paypalOrderId!,
      captureId: d.paypalCaptureId!,
      amountCents: d.amountCents,
      currency: d.currency,
      feeCents: d.feeCents ?? 0,
      customId: d.id,
      payerEmail: d.donorEmail,
      payerName: d.donorName,
      capturedAt: d.capturedAt ?? d.createdAt,
      refunded: d.status === "refunded",
    })),
    payouts: sent.map((p) => ({
      batchId: p.paypalBatchId!,
      senderBatchId: p.senderBatchId,
      senderItemId: p.id,
      itemId: p.paypalItemId,
      transactionId: p.paypalTransactionId,
      transactionStatus: p.status === "processing" ? null : ((p.paypalTransactionStatus ?? "SUCCESS") as PayoutTransactionStatus),
      ...(RECIPIENT[p.method] ?? RECIPIENT.paypal_email!),
      receiver: p.receiver,
      amountCents: p.amountCents,
      currency: p.currency,
      feeCents: p.feeCents,
      note: "Emergency grant",
      createdAt: p.sentAt ?? p.createdAt,
      completedAt: p.completedAt,
    })),
  };
  paypal.restore(history);
  return history.captures.length + history.payouts.length;
}
