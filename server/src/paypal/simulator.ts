import { randomBytes } from "node:crypto";
import { toCents, toPayPalValue } from "../lib/money.js";
import {
  type Capture,
  type CreateOrderInput,
  type CreatePayoutInput,
  PayPalApiError,
  type PayPalGateway,
  type PayPalIdentity,
  type PayPalOrder,
  type PayPalRefund,
  type PayoutBatch,
  type PayoutItem,
  type PayoutTransactionStatus,
  type TransactionSummary,
  type WebhookEvent,
} from "./types.js";

/**
 * In-process emulation of the PayPal endpoints Tideover uses. It mirrors PayPal's
 * wire formats and state machines (order CREATED -> APPROVED -> COMPLETED, payout
 * PENDING -> SUCCESS/UNCLAIMED/FAILED, idempotency keys, error shapes) so the
 * same domain code runs against it and against the real sandbox.
 *
 * Simulated buyer/recipient personas mirror PayPal sandbox test accounts.
 */
export interface SimPersona {
  key: string;
  name: string;
  email: string;
  payerId: string;
  verified: boolean;
}

export const SIM_PERSONAS: SimPersona[] = [
  { key: "maria", name: "Maria Lopez", email: "maria.lopez@personal.example.com", payerId: "SIMMARIA7Q2L4", verified: true },
  { key: "dev", name: "Dev Patel", email: "dev.patel@personal.example.com", payerId: "SIMDEVPAT8K3N", verified: true },
  { key: "jordan", name: "Jordan Kim", email: "jordan.kim@personal.example.com", payerId: "SIMJORDAN2W9X", verified: false },
  { key: "donor", name: "Alex Rivera", email: "alex.rivera@donor.example.com", payerId: "SIMALEXRV5T6P", verified: true },
];

const id = (len = 17) =>
  randomBytes(len)
    .toString("base64")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase()
    .slice(0, len)
    .padEnd(len, "X");

/** PayPal US charity rate used for simulated captures: 1.99% + $0.49. */
export const simulatedCaptureFee = (cents: number) => Math.round(cents * 0.0199) + 49;
/** PayPal Payouts US domestic fee: 2% capped at $20, min $0.25. */
export const simulatedPayoutFee = (cents: number) => Math.min(2000, Math.max(25, Math.round(cents * 0.02)));

interface SimOrder {
  order: PayPalOrder;
  input: CreateOrderInput;
  captureRequestId?: string;
}

interface SimPayout {
  batch: PayoutBatch;
  input: CreatePayoutInput;
  settleAt: number;
  settled: boolean;
}

export interface SimulatorOptions {
  publicUrl: string;
  payoutDelayMs: number;
  /** Receives PayPal-style webhook events (delivered in-process). */
  onWebhook?: (event: WebhookEvent) => void | Promise<void>;
}

export class SimulatedPayPalGateway implements PayPalGateway {
  readonly mode = "simulated" as const;
  readonly clientId = null;
  private readonly orders = new Map<string, SimOrder>();
  private readonly orderByRequestId = new Map<string, string>();
  private readonly payouts = new Map<string, SimPayout>();
  private readonly payoutBySenderBatch = new Map<string, string>();
  private readonly itemToBatch = new Map<string, string>();
  private readonly captures = new Map<string, { capture: Capture; orderId: string }>();
  private readonly loginCodes = new Map<string, PayPalIdentity>();
  private readonly refunds = new Map<string, PayPalRefund>();
  private readonly timers = new Set<NodeJS.Timeout>();
  onWebhook?: (event: WebhookEvent) => void | Promise<void>;

  constructor(private readonly opts: SimulatorOptions) {
    this.onWebhook = opts.onWebhook;
  }

  // ---------------------------------------------------------------- Orders

  async createOrder(input: CreateOrderInput): Promise<PayPalOrder> {
    const existing = this.orderByRequestId.get(input.requestId);
    if (existing) return structuredClone(this.orders.get(existing)!.order);
    if (input.amountCents <= 0) {
      throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", "The requested action could not be performed.", id(13), [
        { issue: "AMOUNT_MUST_BE_POSITIVE", field: "/purchase_units/@reference_id=='default'/amount/value" },
      ]);
    }
    const orderId = id(17);
    const redirect = input.flow === "redirect";
    const order: PayPalOrder = {
      id: orderId,
      status: redirect ? "PAYER_ACTION_REQUIRED" : "CREATED",
      create_time: new Date().toISOString(),
      purchase_units: [
        {
          reference_id: input.referenceId,
          custom_id: input.referenceId,
          description: input.description,
          amount: { currency_code: input.currency, value: toPayPalValue(input.amountCents) },
        },
      ],
      links: [
        { href: `${this.opts.publicUrl}/sim/paypal/v2/checkout/orders/${orderId}`, rel: "self", method: "GET" },
        {
          href: `${this.opts.publicUrl}/sim/paypal/checkout?token=${orderId}`,
          rel: redirect ? "payer-action" : "approve",
          method: "GET",
        },
      ],
    };
    this.orders.set(orderId, { order, input });
    this.orderByRequestId.set(input.requestId, orderId);
    return structuredClone(order);
  }

  async getOrder(orderId: string): Promise<PayPalOrder> {
    const sim = this.orders.get(orderId);
    if (!sim) throw this.notFound("RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");
    return structuredClone(sim.order);
  }

  /** Called by the simulated PayPal approval page (what the buyer does at paypal.com). */
  approveOrder(orderId: string, personaKey: string): PayPalOrder {
    const sim = this.orders.get(orderId);
    if (!sim) throw this.notFound("RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");
    const persona = SIM_PERSONAS.find((p) => p.key === personaKey) ?? SIM_PERSONAS[3]!;
    if (sim.order.status === "COMPLETED") return structuredClone(sim.order);
    const [given, ...rest] = persona.name.split(" ");
    sim.order.status = "APPROVED";
    sim.order.payer = {
      name: { given_name: given, surname: rest.join(" ") },
      email_address: persona.email,
      payer_id: persona.payerId,
    };
    sim.order.payment_source = {
      paypal: {
        email_address: persona.email,
        account_id: persona.payerId,
        name: { given_name: given, surname: rest.join(" ") },
      },
    };
    return structuredClone(sim.order);
  }

  async captureOrder(orderId: string, requestId: string): Promise<PayPalOrder> {
    const sim = this.orders.get(orderId);
    if (!sim) throw this.notFound("RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");
    if (sim.order.status === "COMPLETED") {
      if (sim.captureRequestId === requestId) return structuredClone(sim.order);
      throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", "The requested action could not be performed.", id(13), [
        { issue: "ORDER_ALREADY_CAPTURED", description: "Order already captured." },
      ]);
    }
    if (sim.order.status !== "APPROVED") {
      throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", "The requested action could not be performed.", id(13), [
        { issue: "ORDER_NOT_APPROVED", description: "Payer has not yet approved the Order for payment." },
      ]);
    }
    const unit = sim.order.purchase_units![0]!;
    const gross = toCents(unit.amount!.value);
    const fee = simulatedCaptureFee(gross);
    const capture: Capture = {
      id: id(17),
      status: "COMPLETED",
      amount: { currency_code: unit.amount!.currency_code, value: unit.amount!.value },
      custom_id: unit.custom_id,
      create_time: new Date().toISOString(),
      seller_receivable_breakdown: {
        gross_amount: { currency_code: unit.amount!.currency_code, value: unit.amount!.value },
        paypal_fee: { currency_code: unit.amount!.currency_code, value: toPayPalValue(fee) },
        net_amount: { currency_code: unit.amount!.currency_code, value: toPayPalValue(gross - fee) },
      },
    };
    unit.payments = { captures: [capture] };
    sim.order.status = "COMPLETED";
    sim.captureRequestId = requestId;
    this.captures.set(capture.id, { capture, orderId });
    void this.emit({
      id: `WH-${id(17)}`,
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource_type: "capture",
      resource: { ...capture, supplementary_data: { related_ids: { order_id: orderId } } },
      summary: `Payment completed for ${unit.amount!.value} ${unit.amount!.currency_code}`,
      create_time: new Date().toISOString(),
    });
    return structuredClone(sim.order);
  }

  async refundCapture(
    captureId: string,
    input: { amountCents?: number; currency: string; note: string; requestId: string },
  ): Promise<PayPalRefund> {
    const existing = this.refunds.get(input.requestId);
    if (existing) return structuredClone(existing);
    const entry = this.captures.get(captureId);
    if (!entry) throw this.notFound("RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");
    if (entry.capture.status === "REFUNDED") {
      throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", "The requested action could not be performed.", id(13), [
        { issue: "CAPTURE_FULLY_REFUNDED", description: "The capture has already been fully refunded" },
      ]);
    }
    const amountCents = input.amountCents ?? toCents(entry.capture.amount.value);
    entry.capture.status = amountCents >= toCents(entry.capture.amount.value) ? "REFUNDED" : "PARTIALLY_REFUNDED";
    const refund: PayPalRefund = {
      id: id(17),
      status: "COMPLETED",
      amount: { currency_code: input.currency, value: toPayPalValue(amountCents) },
    };
    this.refunds.set(input.requestId, refund);
    return structuredClone(refund);
  }

  // ---------------------------------------------------------------- Payouts

  async createPayout(input: CreatePayoutInput): Promise<PayoutBatch> {
    const existing = this.payoutBySenderBatch.get(input.senderBatchId);
    if (existing) {
      const sim = this.payouts.get(existing)!;
      return { batch_header: structuredClone(sim.batch.batch_header), links: sim.batch.links };
    }
    if (input.recipientWallet === "VENMO" && input.recipientType !== "PHONE" && input.recipientType !== "EMAIL") {
      throw new PayPalApiError(422, "VALIDATION_ERROR", "Invalid request - see details", id(13), [
        { issue: "Venmo payouts require recipient_type PHONE or EMAIL", field: "items[0].recipient_type" },
      ]);
    }
    const batchId = id(13);
    const itemId = id(13);
    const batch: PayoutBatch = {
      batch_header: {
        payout_batch_id: batchId,
        batch_status: "PENDING",
        time_created: new Date().toISOString(),
        sender_batch_header: { sender_batch_id: input.senderBatchId, email_subject: input.emailSubject },
        amount: { currency: input.currency, value: toPayPalValue(input.amountCents) },
      },
      items: [
        {
          payout_item_id: itemId,
          payout_batch_id: batchId,
          transaction_status: "PENDING",
          payout_item: {
            recipient_type: input.recipientType,
            amount: { currency: input.currency, value: toPayPalValue(input.amountCents) },
            note: input.note,
            receiver: input.receiver,
            sender_item_id: input.senderItemId,
            recipient_wallet: input.recipientWallet,
          },
        },
      ],
      links: [
        { href: `${this.opts.publicUrl}/sim/paypal/v1/payments/payouts/${batchId}`, rel: "self", method: "GET" },
      ],
    };
    const sim: SimPayout = { batch, input, settleAt: Date.now() + this.opts.payoutDelayMs, settled: false };
    this.payouts.set(batchId, sim);
    this.payoutBySenderBatch.set(input.senderBatchId, batchId);
    this.itemToBatch.set(itemId, batchId);
    this.scheduleSettle(batchId);
    return { batch_header: structuredClone(batch.batch_header), links: batch.links };
  }

  private scheduleSettle(batchId: string): void {
    const sim = this.payouts.get(batchId)!;
    const delay = Math.max(0, sim.settleAt - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void this.settle(batchId);
    }, delay);
    timer.unref?.();
    this.timers.add(timer);
  }

  /** Outcome rules mirror sandbox behaviour for unknown/invalid receivers. */
  private outcomeFor(input: CreatePayoutInput): PayoutTransactionStatus {
    const receiver = input.receiver.toLowerCase();
    if (receiver.includes("unclaimed")) return "UNCLAIMED";
    if (receiver.includes("blocked")) return "BLOCKED";
    if (receiver.includes("fail")) return "FAILED";
    return "SUCCESS";
  }

  private async settle(batchId: string): Promise<void> {
    const sim = this.payouts.get(batchId);
    if (!sim || sim.settled) return;
    sim.settled = true;
    const item = sim.batch.items![0]!;
    const status = this.outcomeFor(sim.input);
    const fee = simulatedPayoutFee(sim.input.amountCents);
    item.transaction_status = status;
    item.time_processed = new Date().toISOString();
    if (status === "SUCCESS" || status === "UNCLAIMED") {
      item.transaction_id = id(17);
      item.payout_item_fee = { currency: sim.input.currency, value: toPayPalValue(fee) };
      sim.batch.batch_header.fees = { currency: sim.input.currency, value: toPayPalValue(fee) };
    }
    if (status === "FAILED") {
      item.errors = { name: "RECEIVER_UNREGISTERED", message: "Receiver is unregistered" };
    }
    if (status === "BLOCKED") {
      item.errors = { name: "RISK_DECLINE", message: "Transaction was declined by risk checks" };
    }
    sim.batch.batch_header.batch_status = "SUCCESS";
    sim.batch.batch_header.time_completed = new Date().toISOString();

    const itemEvent: Record<PayoutTransactionStatus, string> = {
      SUCCESS: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      UNCLAIMED: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
      FAILED: "PAYMENT.PAYOUTS-ITEM.FAILED",
      BLOCKED: "PAYMENT.PAYOUTS-ITEM.BLOCKED",
      RETURNED: "PAYMENT.PAYOUTS-ITEM.RETURNED",
      ONHOLD: "PAYMENT.PAYOUTS-ITEM.HELD",
      REFUNDED: "PAYMENT.PAYOUTS-ITEM.REFUNDED",
      REVERSED: "PAYMENT.PAYOUTS-ITEM.REFUNDED",
      PENDING: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
    };
    await this.emit({
      id: `WH-${id(17)}`,
      event_type: itemEvent[status],
      resource_type: "payouts_item",
      resource: structuredClone(item) as unknown as Record<string, unknown>,
      create_time: new Date().toISOString(),
    });
  }

  async getPayoutBatch(batchId: string): Promise<PayoutBatch> {
    const sim = this.payouts.get(batchId);
    if (!sim) throw this.notFound("INVALID_RESOURCE_ID", "INVALID_RESOURCE_ID");
    if (!sim.settled && Date.now() >= sim.settleAt) await this.settle(batchId);
    return structuredClone(sim.batch);
  }

  async getPayoutItem(itemId: string): Promise<PayoutItem> {
    const batchId = this.itemToBatch.get(itemId);
    if (!batchId) throw this.notFound("INVALID_RESOURCE_ID", "INVALID_RESOURCE_ID");
    const batch = await this.getPayoutBatch(batchId);
    return batch.items![0]!;
  }

  async cancelUnclaimedPayoutItem(itemId: string): Promise<PayoutItem> {
    const batchId = this.itemToBatch.get(itemId);
    if (!batchId) throw this.notFound("INVALID_RESOURCE_ID", "INVALID_RESOURCE_ID");
    const sim = this.payouts.get(batchId)!;
    const item = sim.batch.items![0]!;
    if (item.transaction_status !== "UNCLAIMED") {
      throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", "Only unclaimed items can be cancelled", id(13), [
        { issue: "ITEM_ALREADY_PROCESSED" },
      ]);
    }
    item.transaction_status = "RETURNED";
    return structuredClone(item);
  }

  // --------------------------------------------------------------- Webhooks

  async verifyWebhookSignature(): Promise<boolean> {
    // Simulated events are delivered in-process and never cross the network.
    return true;
  }

  private async emit(event: WebhookEvent): Promise<void> {
    try {
      await this.onWebhook?.(event);
    } catch {
      // Webhook consumers handle their own errors; polling is the safety net.
    }
  }

  // ---------------------------------------------------- Log in with PayPal

  buildLoginUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({ state, redirect_uri: redirectUri });
    return `${this.opts.publicUrl}/sim/paypal/login?${params.toString()}`;
  }

  /** Called by the simulated PayPal login page. */
  issueLoginCode(personaKey: string): string {
    const persona = SIM_PERSONAS.find((p) => p.key === personaKey) ?? SIM_PERSONAS[0]!;
    const code = `SIMCODE${id(20)}`;
    this.loginCodes.set(code, {
      payerId: persona.payerId,
      email: persona.email,
      name: persona.name,
      verifiedAccount: persona.verified,
    });
    return code;
  }

  async exchangeLoginCode(code: string): Promise<PayPalIdentity> {
    const identity = this.loginCodes.get(code);
    if (!identity) throw new PayPalApiError(400, "invalid_grant", "Invalid authorization code");
    this.loginCodes.delete(code);
    return identity;
  }

  // -------------------------------------------------------------- Reporting

  async listTransactions(input: { start: Date; end: Date }): Promise<TransactionSummary[]> {
    const out: TransactionSummary[] = [];
    for (const { capture, orderId } of this.captures.values()) {
      const at = new Date(capture.create_time ?? 0);
      if (at < input.start || at > input.end) continue;
      const order = this.orders.get(orderId)!.order;
      out.push({
        transactionId: capture.id,
        eventCode: "T0006",
        status: capture.status === "COMPLETED" ? "S" : "V",
        amountCents: toCents(capture.amount.value),
        currency: capture.amount.currency_code,
        feeCents: -toCents(capture.seller_receivable_breakdown?.paypal_fee?.value ?? "0"),
        initiatedAt: capture.create_time ?? "",
        payerEmail: order.payer?.email_address ?? null,
        payerName: [order.payer?.name?.given_name, order.payer?.name?.surname].filter(Boolean).join(" ") || null,
        customField: capture.custom_id ?? null,
        note: null,
      });
    }
    for (const sim of this.payouts.values()) {
      const item = sim.batch.items![0]!;
      if (!item.transaction_id) continue;
      const at = new Date(item.time_processed ?? 0);
      if (at < input.start || at > input.end) continue;
      out.push({
        transactionId: item.transaction_id,
        eventCode: "T0000",
        status: item.transaction_status === "SUCCESS" ? "S" : "P",
        amountCents: -sim.input.amountCents,
        currency: sim.input.currency,
        feeCents: item.payout_item_fee ? -toCents(item.payout_item_fee.value) : null,
        initiatedAt: item.time_processed ?? "",
        payerEmail: sim.input.receiver,
        payerName: null,
        customField: sim.input.senderItemId,
        note: sim.input.note,
      });
    }
    return out.sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt));
  }

  // ---------------------------------------------------------------- helpers

  /** Test helper: settle every in-flight payout immediately. */
  async flushPayouts(): Promise<void> {
    for (const [batchId, sim] of this.payouts) {
      if (!sim.settled) await this.settle(batchId);
    }
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private notFound(name: string, issue: string): PayPalApiError {
    return new PayPalApiError(404, name, "The specified resource does not exist.", id(13), [{ issue }]);
  }
}
