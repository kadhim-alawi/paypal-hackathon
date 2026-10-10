import { describe, expect, it } from "vitest";
import { RestPayPalGateway } from "../src/paypal/rest.js";
import { PayPalApiError } from "../src/paypal/types.js";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})),
      body: init?.body as string | undefined,
    });
    const next = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { impl, calls };
}

const TOKEN = { body: { access_token: "A21AA-token", expires_in: 32400 } };

describe("RestPayPalGateway wire format", () => {
  it("creates an order with idempotency key, representation preference and no-shipping context", async () => {
    const { impl, calls } = fakeFetch([TOKEN, { status: 201, body: { id: "5O190127TN364715T", status: "PAYER_ACTION_REQUIRED" } }]);
    const pp = new RestPayPalGateway({ mode: "sandbox", clientId: "cid", clientSecret: "sec", fetchImpl: impl });
    const order = await pp.createOrder({
      referenceId: "don_1",
      description: "Gift",
      amountCents: 4250,
      currency: "USD",
      brandName: "Tideover · Eastside",
      requestId: "don_1-redirect-paypal",
      flow: "redirect",
      returnUrl: "https://x/return",
      cancelUrl: "https://x/cancel",
    });
    expect(order.id).toBe("5O190127TN364715T");
    expect(calls[0]!.url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(calls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from("cid:sec").toString("base64")}`);
    expect(calls[0]!.body).toBe("grant_type=client_credentials");
    const create = calls[1]!;
    expect(create.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    expect(create.headers.Authorization).toBe("Bearer A21AA-token");
    expect(create.headers["PayPal-Request-Id"]).toBe("don_1-redirect-paypal");
    expect(create.headers.Prefer).toBe("return=representation");
    const body = JSON.parse(create.body!);
    expect(body).toEqual({
      intent: "CAPTURE",
      purchase_units: [{ reference_id: "don_1", custom_id: "don_1", description: "Gift", amount: { currency_code: "USD", value: "42.50" } }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Tideover · Eastside",
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            return_url: "https://x/return",
            cancel_url: "https://x/cancel",
          },
        },
      },
    });
  });

  it("uses a Venmo experience context for the Venmo button", async () => {
    const { impl, calls } = fakeFetch([TOKEN, { status: 201, body: { id: "O1", status: "CREATED" } }]);
    const pp = new RestPayPalGateway({ mode: "live", clientId: "c", clientSecret: "s", fetchImpl: impl });
    await pp.createOrder({
      referenceId: "d",
      description: "x",
      amountCents: 100,
      currency: "USD",
      brandName: "B",
      requestId: "r",
      flow: "buttons",
      fundingSource: "venmo",
      returnUrl: "",
      cancelUrl: "",
    });
    expect(calls[1]!.url).toBe("https://api-m.paypal.com/v2/checkout/orders");
    expect(JSON.parse(calls[1]!.body!).payment_source).toEqual({
      venmo: { experience_context: { brand_name: "B", shipping_preference: "NO_SHIPPING" } },
    });
  });

  it("caches the access token across calls", async () => {
    const { impl, calls } = fakeFetch([TOKEN, { body: { id: "A" } }, { body: { id: "B" } }]);
    const pp = new RestPayPalGateway({ mode: "sandbox", clientId: "c", clientSecret: "s", fetchImpl: impl });
    await pp.getOrder("A");
    await pp.getOrder("B");
    expect(calls.filter((c) => c.url.endsWith("/v1/oauth2/token"))).toHaveLength(1);
  });

  it("sends payouts with sender_batch_id idempotency and Venmo wallet", async () => {
    const { impl, calls } = fakeFetch([
      TOKEN,
      { status: 201, body: { batch_header: { payout_batch_id: "5UXD2E8A7EBQJ", batch_status: "PENDING" } } },
    ]);
    const pp = new RestPayPalGateway({ mode: "sandbox", clientId: "c", clientSecret: "s", fetchImpl: impl });
    const batch = await pp.createPayout({
      senderBatchId: "TDO_pay_1",
      senderItemId: "pay_1",
      emailSubject: "You got money",
      emailMessage: "Hi",
      recipientType: "PHONE",
      recipientWallet: "VENMO",
      receiver: "5125550134",
      amountCents: 28_640,
      currency: "USD",
      note: "Emergency grant",
    });
    expect(batch.batch_header.payout_batch_id).toBe("5UXD2E8A7EBQJ");
    const req = calls[1]!;
    expect(req.url).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts");
    expect(req.headers["PayPal-Request-Id"]).toBe("TDO_pay_1");
    expect(JSON.parse(req.body!)).toEqual({
      sender_batch_header: {
        sender_batch_id: "TDO_pay_1",
        email_subject: "You got money",
        email_message: "Hi",
        recipient_type: "PHONE",
      },
      items: [
        {
          recipient_type: "PHONE",
          recipient_wallet: "VENMO",
          receiver: "5125550134",
          sender_item_id: "pay_1",
          note: "Emergency grant",
          amount: { currency: "USD", value: "286.40" },
        },
      ],
    });
  });

  it("maps PayPal error bodies to PayPalApiError with issue and debug id", async () => {
    const { impl } = fakeFetch([
      TOKEN,
      {
        status: 422,
        body: {
          name: "UNPROCESSABLE_ENTITY",
          message: "The requested action could not be performed.",
          debug_id: "f2b3c1d",
          details: [{ issue: "ORDER_NOT_APPROVED", description: "Payer has not yet approved the Order for payment." }],
        },
      },
    ]);
    const pp = new RestPayPalGateway({ mode: "sandbox", clientId: "c", clientSecret: "s", fetchImpl: impl });
    const err = await pp.captureOrder("O1", "r").catch((e) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err.status).toBe(422);
    expect(err.issue).toBe("ORDER_NOT_APPROVED");
    expect(err.debugId).toBe("f2b3c1d");
  });

  it("retries once with a fresh token on 401", async () => {
    const { impl, calls } = fakeFetch([TOKEN, { status: 401, body: { error: "invalid_token" } }, TOKEN, { body: { id: "A" } }]);
    const pp = new RestPayPalGateway({ mode: "sandbox", clientId: "c", clientSecret: "s", fetchImpl: impl });
    const order = await pp.getOrder("A");
    expect(order.id).toBe("A");
    expect(calls.filter((c) => c.url.endsWith("/v1/oauth2/token"))).toHaveLength(2);
  });

  it("verifies webhooks through PayPal's verification API", async () => {
    const { impl, calls } = fakeFetch([TOKEN, { body: { verification_status: "SUCCESS" } }]);
    const pp = new RestPayPalGateway({ mode: "sandbox", clientId: "c", clientSecret: "s", webhookId: "WH-1", fetchImpl: impl });
    const ok = await pp.verifyWebhookSignature(
      {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem",
        "paypal-transmission-id": "t1",
        "paypal-transmission-sig": "sig",
        "paypal-transmission-time": "2026-10-10T00:00:00Z",
      },
      { id: "WH-EV", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} },
    );
    expect(ok).toBe(true);
    const body = JSON.parse(calls[1]!.body!);
    expect(body.webhook_id).toBe("WH-1");
    expect(body.transmission_sig).toBe("sig");
    expect(body.webhook_event.id).toBe("WH-EV");
  });

  it("refuses to verify webhooks without a configured webhook id", async () => {
    const { impl } = fakeFetch([]);
    const pp = new RestPayPalGateway({ mode: "sandbox", clientId: "c", clientSecret: "s", fetchImpl: impl });
    expect(await pp.verifyWebhookSignature({}, { id: "x", event_type: "y", resource: {} })).toBe(false);
  });

  it("Log in with PayPal: builds the authorize URL and reads verified identity", async () => {
    const { impl, calls } = fakeFetch([
      { body: { access_token: "user-token" } },
      {
        body: {
          user_id: "https://www.paypal.com/webapps/auth/identity/user/abc",
          payer_id: "WDJJHEBZ4X2LY",
          name: "Maria Lopez",
          verified_account: "true",
          emails: [{ value: "maria@example.com", primary: true, confirmed: true }],
        },
      },
    ]);
    const pp = new RestPayPalGateway({ mode: "sandbox", clientId: "cid", clientSecret: "s", fetchImpl: impl });
    const url = new URL(pp.buildLoginUrl("st", "https://app/cb"));
    expect(url.origin + url.pathname).toBe("https://www.sandbox.paypal.com/signin/authorize");
    expect(url.searchParams.get("scope")).toContain("https://uri.paypal.com/services/paypalattributes");
    const id = await pp.exchangeLoginCode("CODE", "https://app/cb");
    expect(id).toEqual({ payerId: "WDJJHEBZ4X2LY", email: "maria@example.com", name: "Maria Lopez", verifiedAccount: true });
    expect(calls[0]!.body).toContain("grant_type=authorization_code");
    expect(calls[1]!.url).toBe("https://api-m.sandbox.paypal.com/v1/identity/oauth2/userinfo?schema=paypalv1.1");
  });
});
