/**
 * Live check of every PayPal API Tideover uses, against your sandbox app.
 *
 *   PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... \
 *   PAYPAL_TEST_RECEIVER=sb-personal@personal.example.com \
 *   npm run verify:paypal
 *
 * PAYPAL_TEST_RECEIVER is the email of a sandbox *personal* account
 * (developer.paypal.com → Sandbox → Accounts).
 */
import "../lib/env.js";
import { RestPayPalGateway } from "../paypal/rest.js";
import { approvalUrl, PayPalApiError } from "../paypal/types.js";

const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
const receiver = process.env.PAYPAL_TEST_RECEIVER;
const mode = (process.env.PAYPAL_MODE === "live" ? "live" : "sandbox") as "sandbox" | "live";
if (!clientId || !clientSecret) {
  console.error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
  process.exit(1);
}
if (mode === "live") {
  console.error("Refusing to run against live PayPal. This script moves (test) money.");
  process.exit(1);
}

const pp = new RestPayPalGateway({ mode, clientId, clientSecret, webhookId: process.env.PAYPAL_WEBHOOK_ID });
const ok = (m: string) => console.log(`  ✓ ${m}`);
const step = (m: string) => console.log(`\n▸ ${m}`);
const stamp = Date.now().toString(36);

try {
  step("Orders v2: create a $1.00 donation order (redirect flow)");
  const order = await pp.createOrder({
    referenceId: `verify_${stamp}`,
    description: "Tideover verification order",
    amountCents: 100,
    currency: "USD",
    brandName: "Tideover · verification",
    requestId: `verify-${stamp}`,
    flow: "redirect",
    returnUrl: "https://example.com/return",
    cancelUrl: "https://example.com/cancel",
  });
  ok(`order ${order.id} status ${order.status}`);
  ok(`buyer approval link: ${approvalUrl(order)}`);
  const again = await pp.getOrder(order.id);
  ok(`GET order works (status ${again.status})`);

  step("Orders v2: create a JS SDK (buttons) order for Venmo");
  const venmo = await pp.createOrder({
    referenceId: `verify_v_${stamp}`,
    description: "Tideover verification order (Venmo)",
    amountCents: 100,
    currency: "USD",
    brandName: "Tideover",
    requestId: `verify-v-${stamp}`,
    flow: "buttons",
    fundingSource: "venmo",
    returnUrl: "",
    cancelUrl: "",
  });
  ok(`order ${venmo.id} status ${venmo.status}`);

  if (receiver) {
    step(`Payouts v1: send $1.00 to ${receiver}`);
    const batch = await pp.createPayout({
      senderBatchId: `TDO_verify_${stamp}`,
      senderItemId: `verify_${stamp}`,
      emailSubject: "Tideover verification payout",
      emailMessage: "Sandbox test",
      recipientType: "EMAIL",
      recipientWallet: "PAYPAL",
      receiver,
      amountCents: 100,
      currency: "USD",
      note: "Tideover sandbox verification",
    });
    ok(`batch ${batch.batch_header.payout_batch_id} ${batch.batch_header.batch_status}`);
    const dup = await pp.createPayout({
      senderBatchId: `TDO_verify_${stamp}`,
      senderItemId: `verify_${stamp}`,
      emailSubject: "dup",
      emailMessage: "dup",
      recipientType: "EMAIL",
      recipientWallet: "PAYPAL",
      receiver,
      amountCents: 100,
      currency: "USD",
      note: "dup",
    }).catch((e: unknown) => e);
    ok(
      dup instanceof PayPalApiError
        ? `duplicate sender_batch_id rejected (${dup.name}) — no double payment`
        : `duplicate request returned the original batch ${(dup as { batch_header: { payout_batch_id: string } }).batch_header.payout_batch_id}`,
    );
    for (let i = 0; i < 20; i++) {
      const b = await pp.getPayoutBatch(batch.batch_header.payout_batch_id);
      const item = b.items?.[0];
      console.log(`    … batch ${b.batch_header.batch_status}, item ${item?.transaction_status ?? "?"}`);
      if (item && item.transaction_status && item.transaction_status !== "PENDING") {
        ok(`payout item ${item.payout_item_id} → ${item.transaction_status} (fee ${item.payout_item_fee?.value ?? "?"})`);
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  } else {
    console.log("\n▸ Payouts: skipped (set PAYPAL_TEST_RECEIVER to a sandbox personal account email)");
  }

  step("Reporting: transaction search (last 7 days)");
  try {
    const txns = await pp.listTransactions({ start: new Date(Date.now() - 7 * 86_400_000), end: new Date() });
    ok(`${txns.length} transactions (sandbox search can lag up to 3 hours)`);
  } catch (e) {
    console.log(`  ! transaction search unavailable: ${(e as Error).message}. Enable "Transaction search" for the app in the developer dashboard.`);
  }

  step("Webhooks: signature verification endpoint");
  if (process.env.PAYPAL_WEBHOOK_ID) {
    const verified = await pp.verifyWebhookSignature(
      {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270",
        "paypal-transmission-id": "00000000-0000-0000-0000-000000000000",
        "paypal-transmission-sig": "invalid",
        "paypal-transmission-time": new Date().toISOString(),
      },
      { id: "WH-TEST", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} },
    ).catch((e: Error) => e);
    ok(verified === false ? "forged event correctly rejected" : `unexpected result: ${String(verified)}`);
  } else {
    console.log("  (set PAYPAL_WEBHOOK_ID to check)");
  }

  step("Log in with PayPal");
  ok(`authorize URL: ${pp.buildLoginUrl("state123", "https://your-host/api/paypal/login/callback")}`);
  console.log("    Enable 'Log in with PayPal' for the app and add the return URL above (with your host).");

  console.log("\nAll reachable PayPal APIs responded as expected.");
} catch (e) {
  if (e instanceof PayPalApiError) {
    console.error(`\n✗ PayPal ${e.status} ${e.name}: ${e.message} (debug_id ${e.debugId ?? "?"})`, e.details ?? "");
  } else {
    console.error("\n✗", e);
  }
  process.exit(1);
}
