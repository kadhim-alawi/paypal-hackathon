import { toCents, toPayPalValue } from "../lib/money.js";
import {
  type CreateOrderInput,
  type CreatePayoutInput,
  PayPalApiError,
  type PayPalGateway,
  type PayPalIdentity,
  type PayPalOrder,
  type PayPalRefund,
  type PayoutBatch,
  type PayoutItem,
  type TransactionSummary,
  type WebhookEvent,
  type WebhookHeaders,
} from "./types.js";

interface RestOptions {
  mode: "sandbox" | "live";
  clientId: string;
  clientSecret: string;
  webhookId?: string;
  fetchImpl?: typeof fetch;
}

const API_BASE = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
} as const;

/**
 * Donations need no shipping address. The experience context depends on how the
 * buyer approves: in the JS SDK popup (per funding source) or via redirect.
 */
function paymentSourceFor(input: CreateOrderInput): Record<string, unknown> {
  const brand_name = input.brandName.slice(0, 127);
  if (input.flow === "redirect") {
    return {
      payment_source: {
        paypal: {
          experience_context: {
            brand_name,
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    };
  }
  switch (input.fundingSource) {
    case "venmo":
      return { payment_source: { venmo: { experience_context: { brand_name, shipping_preference: "NO_SHIPPING" } } } };
    case "paypal":
    case "paylater":
      return {
        payment_source: {
          paypal: { experience_context: { brand_name, shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" } },
        },
      };
    default:
      // Card fields or unknown funding source: leave payment_source to the JS SDK.
      return { application_context: { brand_name, shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" } };
  }
}

const WEB_BASE = {
  sandbox: "https://www.sandbox.paypal.com",
  live: "https://www.paypal.com",
} as const;

/** Real PayPal REST client (sandbox or live). Plain fetch, no hidden magic. */
export class RestPayPalGateway implements PayPalGateway {
  readonly mode: "sandbox" | "live";
  readonly clientId: string;
  private readonly clientSecret: string;
  private readonly webhookId?: string;
  private readonly fetchImpl: typeof fetch;
  private token: { value: string; expiresAt: number } | null = null;
  private tokenPromise: Promise<string> | null = null;

  constructor(opts: RestOptions) {
    this.mode = opts.mode;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.webhookId = opts.webhookId;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private get apiBase(): string {
    return API_BASE[this.mode];
  }

  private basicAuth(): string {
    return `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    if (!this.tokenPromise) {
      this.tokenPromise = (async () => {
        const res = await this.fetchImpl(`${this.apiBase}/v1/oauth2/token`, {
          method: "POST",
          headers: {
            Authorization: this.basicAuth(),
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: "grant_type=client_credentials",
        });
        const body = (await res.json().catch(() => ({}))) as {
          access_token?: string;
          expires_in?: number;
          error?: string;
          error_description?: string;
        };
        if (!res.ok || !body.access_token) {
          throw new PayPalApiError(
            res.status,
            body.error ?? "AUTHENTICATION_FAILURE",
            body.error_description ?? "Could not obtain a PayPal access token",
          );
        }
        // Refresh a minute early to avoid racing the expiry.
        this.token = {
          value: body.access_token,
          expiresAt: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000,
        };
        return body.access_token;
      })().finally(() => {
        this.tokenPromise = null;
      });
    }
    return this.tokenPromise;
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    opts: { body?: unknown; requestId?: string; prefer?: string; retryOn401?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
      Accept: "application/json",
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
    if (opts.prefer) headers.Prefer = opts.prefer;

    const res = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });

    if (res.status === 401 && opts.retryOn401 !== false) {
      this.token = null;
      return this.request<T>(method, path, { ...opts, retryOn401: false });
    }

    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      throw new PayPalApiError(
        res.status,
        String(json.name ?? json.error ?? "PAYPAL_ERROR"),
        String(json.message ?? json.error_description ?? `PayPal ${method} ${path} failed (${res.status})`),
        json.debug_id as string | undefined,
        json.details as PayPalApiError["details"],
      );
    }
    return json as T;
  }

  createOrder(input: CreateOrderInput): Promise<PayPalOrder> {
    return this.request<PayPalOrder>("POST", "/v2/checkout/orders", {
      requestId: input.requestId,
      prefer: "return=representation",
      body: {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.referenceId,
            custom_id: input.referenceId,
            description: input.description.slice(0, 127),
            amount: { currency_code: input.currency, value: toPayPalValue(input.amountCents) },
          },
        ],
        ...paymentSourceFor(input),
      },
    });
  }

  getOrder(orderId: string): Promise<PayPalOrder> {
    return this.request<PayPalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  }

  captureOrder(orderId: string, requestId: string): Promise<PayPalOrder> {
    return this.request<PayPalOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      requestId,
      prefer: "return=representation",
      body: {},
    });
  }

  refundCapture(
    captureId: string,
    input: { amountCents?: number; currency: string; note: string; requestId: string },
  ): Promise<PayPalRefund> {
    return this.request<PayPalRefund>("POST", `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
      requestId: input.requestId,
      prefer: "return=representation",
      body: {
        ...(input.amountCents !== undefined
          ? { amount: { currency_code: input.currency, value: toPayPalValue(input.amountCents) } }
          : {}),
        note_to_payer: input.note.slice(0, 255),
      },
    });
  }

  createPayout(input: CreatePayoutInput): Promise<PayoutBatch> {
    return this.request<PayoutBatch>("POST", "/v1/payments/payouts", {
      requestId: input.senderBatchId,
      body: {
        sender_batch_header: {
          sender_batch_id: input.senderBatchId,
          email_subject: input.emailSubject.slice(0, 255),
          email_message: input.emailMessage.slice(0, 1000),
          recipient_type: input.recipientType,
        },
        items: [
          {
            recipient_type: input.recipientType,
            recipient_wallet: input.recipientWallet,
            receiver: input.receiver,
            sender_item_id: input.senderItemId,
            note: input.note.slice(0, 4000),
            amount: { currency: input.currency, value: toPayPalValue(input.amountCents) },
          },
        ],
      },
    });
  }

  getPayoutBatch(batchId: string): Promise<PayoutBatch> {
    return this.request<PayoutBatch>("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}?fields=batch_header,items`);
  }

  getPayoutItem(itemId: string): Promise<PayoutItem> {
    return this.request<PayoutItem>("GET", `/v1/payments/payouts-item/${encodeURIComponent(itemId)}`);
  }

  cancelUnclaimedPayoutItem(itemId: string): Promise<PayoutItem> {
    return this.request<PayoutItem>("POST", `/v1/payments/payouts-item/${encodeURIComponent(itemId)}/cancel`, {
      body: {},
    });
  }

  async verifyWebhookSignature(headers: WebhookHeaders, event: WebhookEvent): Promise<boolean> {
    if (!this.webhookId) return false;
    const res = await this.request<{ verification_status?: string }>(
      "POST",
      "/v1/notifications/verify-webhook-signature",
      {
        body: {
          auth_algo: headers["paypal-auth-algo"],
          cert_url: headers["paypal-cert-url"],
          transmission_id: headers["paypal-transmission-id"],
          transmission_sig: headers["paypal-transmission-sig"],
          transmission_time: headers["paypal-transmission-time"],
          webhook_id: this.webhookId,
          webhook_event: event,
        },
      },
    );
    return res.verification_status === "SUCCESS";
  }

  buildLoginUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      flowEntry: "static",
      client_id: this.clientId,
      response_type: "code",
      scope: "openid profile email https://uri.paypal.com/services/paypalattributes",
      redirect_uri: redirectUri,
      state,
    });
    return `${WEB_BASE[this.mode]}/signin/authorize?${params.toString()}`;
  }

  async exchangeLoginCode(code: string, redirectUri: string): Promise<PayPalIdentity> {
    const tokenRes = await this.fetchImpl(`${this.apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: this.basicAuth(),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString(),
    });
    const token = (await tokenRes.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenRes.ok || !token.access_token) {
      throw new PayPalApiError(
        tokenRes.status,
        token.error ?? "INVALID_GRANT",
        token.error_description ?? "Log in with PayPal failed",
      );
    }

    const infoRes = await this.fetchImpl(`${this.apiBase}/v1/identity/oauth2/userinfo?schema=paypalv1.1`, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
    });
    const info = (await infoRes.json().catch(() => ({}))) as {
      payer_id?: string;
      user_id?: string;
      name?: string;
      email?: string;
      verified_account?: boolean | string;
      emails?: Array<{ value?: string; primary?: boolean; confirmed?: boolean }>;
    };
    if (!infoRes.ok || !(info.payer_id ?? info.user_id)) {
      throw new PayPalApiError(infoRes.status, "USERINFO_FAILED", "Could not read PayPal account details");
    }
    const primaryEmail = info.emails?.find((e) => e.primary)?.value ?? info.emails?.[0]?.value ?? info.email;
    return {
      payerId: info.payer_id ?? info.user_id!,
      email: primaryEmail ?? null,
      name: info.name ?? null,
      verifiedAccount: info.verified_account === true || info.verified_account === "true",
    };
  }

  async listTransactions(input: { start: Date; end: Date; pageSize?: number }): Promise<TransactionSummary[]> {
    const params = new URLSearchParams({
      start_date: input.start.toISOString().replace(/\.\d{3}Z$/, "Z"),
      end_date: input.end.toISOString().replace(/\.\d{3}Z$/, "Z"),
      fields: "transaction_info,payer_info",
      page_size: String(input.pageSize ?? 100),
    });
    const res = await this.request<{
      transaction_details?: Array<{
        transaction_info?: {
          transaction_id?: string;
          transaction_event_code?: string;
          transaction_status?: string;
          transaction_amount?: { currency_code?: string; value?: string };
          fee_amount?: { currency_code?: string; value?: string };
          transaction_initiation_date?: string;
          custom_field?: string;
          transaction_note?: string;
        };
        payer_info?: { email_address?: string; payer_name?: { alternate_full_name?: string; given_name?: string; surname?: string } };
      }>;
    }>("GET", `/v1/reporting/transactions?${params.toString()}`);
    return (res.transaction_details ?? []).map((d) => {
      const t = d.transaction_info ?? {};
      const name = d.payer_info?.payer_name;
      return {
        transactionId: t.transaction_id ?? "",
        eventCode: t.transaction_event_code ?? "",
        status: t.transaction_status ?? "",
        amountCents: t.transaction_amount?.value ? toCents(t.transaction_amount.value) : 0,
        currency: t.transaction_amount?.currency_code ?? "USD",
        feeCents: t.fee_amount?.value ? toCents(t.fee_amount.value) : null,
        initiatedAt: t.transaction_initiation_date ?? "",
        payerEmail: d.payer_info?.email_address ?? null,
        payerName: name?.alternate_full_name ?? ([name?.given_name, name?.surname].filter(Boolean).join(" ") || null),
        customField: t.custom_field ?? null,
        note: t.transaction_note ?? null,
      };
    });
  }
}
