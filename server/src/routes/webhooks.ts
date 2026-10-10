import type { FastifyInstance } from "fastify";
import { handlePayPalWebhook } from "../domain/webhooks.js";
import type { WebhookEvent, WebhookHeaders } from "../paypal/index.js";
import type { Services } from "../services.js";

export async function webhookRoutes(app: FastifyInstance, s: Services) {
  /**
   * PayPal webhook receiver. Every event is verified with PayPal's
   * verify-webhook-signature API before it can change anything.
   */
  app.post("/api/webhooks/paypal", { config: { rateLimit: false } }, async (req, reply) => {
    const event = req.body as WebhookEvent;
    if (!event?.id || !event.event_type) return reply.code(400).send({ error: "invalid event" });
    let verified = false;
    try {
      verified = await s.paypal.verifyWebhookSignature(req.headers as WebhookHeaders, event);
    } catch (err) {
      req.log.warn({ err }, "webhook verification call failed");
    }
    const result = await handlePayPalWebhook(s, event, verified);
    // 200 even when ignored, so PayPal doesn't retry an event we've recorded.
    return { result };
  });
}
