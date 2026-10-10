import type { AppConfig } from "../config.js";
import { RestPayPalGateway } from "./rest.js";
import { SimulatedPayPalGateway } from "./simulator.js";
import type { PayPalGateway } from "./types.js";

export * from "./types.js";

export function createPayPalGateway(config: AppConfig): PayPalGateway {
  if (config.paypal.mode === "simulated") {
    return new SimulatedPayPalGateway({
      publicUrl: config.publicUrl,
      payoutDelayMs: config.simulatedPayoutDelayMs,
    });
  }
  return new RestPayPalGateway({
    mode: config.paypal.mode,
    clientId: config.paypal.clientId!,
    clientSecret: config.paypal.clientSecret!,
    webhookId: config.paypal.webhookId,
  });
}

/** Maps PayPal's payout item transaction_status onto Tideover's payout status. */
export function mapPayoutStatus(
  status: string | undefined,
): "processing" | "success" | "unclaimed" | "failed" | "returned" | "blocked" | "held" {
  switch (status) {
    case "SUCCESS":
      return "success";
    case "UNCLAIMED":
      return "unclaimed";
    case "FAILED":
    case "DENIED":
      return "failed";
    case "RETURNED":
    case "REFUNDED":
    case "REVERSED":
      return "returned";
    case "BLOCKED":
      return "blocked";
    case "ONHOLD":
      return "held";
    default:
      return "processing";
  }
}
