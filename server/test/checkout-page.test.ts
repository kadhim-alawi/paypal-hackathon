import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.js";

describe("hosted checkout page", () => {
  it("loads the PayPal JS SDK with Venmo and Pay Later, simulating a U.S. buyer only in sandbox", async () => {
    const ctx = await makeApp({ PAYPAL_MODE: "sandbox", PAYPAL_CLIENT_ID: "sb-client-id", PAYPAL_CLIENT_SECRET: "sb-secret" });
    try {
      const created = await ctx.app.inject({ method: "POST", url: "/api/funds/eastside/donations", payload: { amountCents: 2_500 } });
      expect(created.statusCode).toBe(201);
      const page = await ctx.app.inject({ method: "GET", url: `/give/checkout/${created.json().id}` });
      expect(page.statusCode).toBe(200);
      const sdk = /<script src="(https:\/\/www\.paypal\.com\/sdk\/js\?[^"]+)"/.exec(page.body)?.[1];
      expect(sdk).toBeDefined();
      const params = new URL(sdk!.replace(/&amp;/g, "&")).searchParams;
      expect(params.get("client-id")).toBe("sb-client-id");
      expect(params.get("intent")).toBe("capture");
      expect(params.get("enable-funding")).toBe("venmo,paylater");
      expect(params.get("buyer-country")).toBe("US");
    } finally {
      await ctx.close();
    }
  });
});
