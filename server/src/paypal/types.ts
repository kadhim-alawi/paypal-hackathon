/**
 * The subset of PayPal's REST APIs Tideover uses, typed by their wire format.
 * Field names follow PayPal's OpenAPI specs (Orders v2, Payments v2, Payouts v1,
 * Notifications v1, Identity v1, Reporting v1).
 */

export interface Money {
  currency_code: string;
  value: string;
}

export interface LinkDescription {
  href: string;
  rel: string;
  method?: string;
}

export interface CaptureBreakdown {
  gross_amount?: Money;
  paypal_fee?: Money;
  net_amount?: Money;
}

export interface Capture {
  id: string;
  status: "COMPLETED" | "DECLINED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | "FAILED";
  amount: Money;
  custom_id?: string;
  seller_receivable_breakdown?: CaptureBreakdown;
  create_time?: string;
}

export interface PurchaseUnit {
  reference_id?: string;
  custom_id?: string;
  description?: string;
  amount?: Money;
  payments?: { captures?: Capture[] };
}

export interface PayPalOrder {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  links?: LinkDescription[];
  payer?: {
    name?: { given_name?: string; surname?: string };
    email_address?: string;
    payer_id?: string;
  };
  payment_source?: {
    paypal?: {
      email_address?: string;
      account_id?: string;
      name?: { given_name?: string; surname?: string };
    };
    venmo?: {
      email_address?: string;
      account_id?: string;
      user_name?: string;
      name?: { given_name?: string; surname?: string };
    };
    card?: { name?: string; last_digits?: string; brand?: string };
  };
  purchase_units?: PurchaseUnit[];
  create_time?: string;
  update_time?: string;
}

export type FundingSource = "paypal" | "venmo" | "paylater" | "card";

export interface CreateOrderInput {
  referenceId: string;
  description: string;
  amountCents: number;
  currency: string;
  brandName: string;
  requestId: string;
  /**
   * "buttons": order created from the PayPal JS SDK callback; the buyer approves
   * in PayPal's popup. "redirect": full-page redirect to PayPal and back.
   */
  flow: "buttons" | "redirect";
  fundingSource?: FundingSource;
  returnUrl: string;
  cancelUrl: string;
}

/** The URL the buyer must visit to approve an order. */
export function approvalUrl(order: PayPalOrder): string | undefined {
  return order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
}

export interface PayPalRefund {
  id: string;
  status: "CANCELLED" | "FAILED" | "PENDING" | "COMPLETED";
  amount?: Money;
}

export type PayoutRecipientType = "EMAIL" | "PHONE" | "PAYPAL_ID";
export type PayoutWallet = "PAYPAL" | "VENMO";

export interface CreatePayoutInput {
  senderBatchId: string;
  senderItemId: string;
  emailSubject: string;
  emailMessage: string;
  recipientType: PayoutRecipientType;
  recipientWallet: PayoutWallet;
  receiver: string;
  amountCents: number;
  currency: string;
  note: string;
}

export type PayoutBatchStatus = "DENIED" | "PENDING" | "PROCESSING" | "SUCCESS" | "CANCELED";

export type PayoutTransactionStatus =
  | "SUCCESS"
  | "FAILED"
  | "PENDING"
  | "UNCLAIMED"
  | "RETURNED"
  | "ONHOLD"
  | "BLOCKED"
  | "REFUNDED"
  | "REVERSED";

export interface PayoutItem {
  payout_item_id: string;
  transaction_id?: string;
  transaction_status?: PayoutTransactionStatus;
  payout_item_fee?: { currency: string; value: string };
  payout_batch_id: string;
  payout_item: {
    recipient_type?: PayoutRecipientType;
    amount: { currency: string; value: string };
    note?: string;
    receiver: string;
    sender_item_id?: string;
    recipient_wallet?: PayoutWallet;
  };
  time_processed?: string;
  errors?: { name?: string; message?: string };
}

export interface PayoutBatch {
  batch_header: {
    payout_batch_id: string;
    batch_status: PayoutBatchStatus;
    time_created?: string;
    time_completed?: string;
    sender_batch_header?: { sender_batch_id?: string; email_subject?: string };
    amount?: { currency: string; value: string };
    fees?: { currency: string; value: string };
  };
  items?: PayoutItem[];
  links?: LinkDescription[];
}

export interface PayPalIdentity {
  payerId: string;
  email: string | null;
  name: string | null;
  verifiedAccount: boolean;
}

export interface TransactionSummary {
  transactionId: string;
  eventCode: string;
  status: string;
  amountCents: number;
  currency: string;
  feeCents: number | null;
  initiatedAt: string;
  payerEmail: string | null;
  payerName: string | null;
  customField: string | null;
  note: string | null;
}

export interface WebhookHeaders {
  "paypal-auth-algo"?: string;
  "paypal-cert-url"?: string;
  "paypal-transmission-id"?: string;
  "paypal-transmission-sig"?: string;
  "paypal-transmission-time"?: string;
}

export interface WebhookEvent {
  id: string;
  event_type: string;
  resource_type?: string;
  resource: Record<string, unknown>;
  summary?: string;
  create_time?: string;
}

export interface PayPalGateway {
  readonly mode: "sandbox" | "live" | "simulated";
  /** Public client id for the PayPal JS SDK (null in simulated mode). */
  readonly clientId: string | null;

  createOrder(input: CreateOrderInput): Promise<PayPalOrder>;
  getOrder(orderId: string): Promise<PayPalOrder>;
  captureOrder(orderId: string, requestId: string): Promise<PayPalOrder>;
  refundCapture(
    captureId: string,
    input: { amountCents?: number; currency: string; note: string; requestId: string },
  ): Promise<PayPalRefund>;

  createPayout(input: CreatePayoutInput): Promise<PayoutBatch>;
  getPayoutBatch(batchId: string): Promise<PayoutBatch>;
  getPayoutItem(itemId: string): Promise<PayoutItem>;
  cancelUnclaimedPayoutItem(itemId: string): Promise<PayoutItem>;

  verifyWebhookSignature(headers: WebhookHeaders, event: WebhookEvent): Promise<boolean>;

  buildLoginUrl(state: string, redirectUri: string): string;
  exchangeLoginCode(code: string, redirectUri: string): Promise<PayPalIdentity>;

  listTransactions(input: { start: Date; end: Date; pageSize?: number }): Promise<TransactionSummary[]>;
}

export class PayPalApiError extends Error {
  constructor(
    public readonly status: number,
    public override readonly name: string,
    message: string,
    public readonly debugId?: string,
    public readonly details?: Array<{ issue?: string; description?: string; field?: string }>,
  ) {
    super(message);
  }

  get issue(): string | undefined {
    return this.details?.[0]?.issue;
  }
}
