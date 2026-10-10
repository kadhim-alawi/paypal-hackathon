import { z } from "zod";

/**
 * Runtime configuration, parsed once from the environment.
 *
 * PayPal mode:
 *  - "sandbox" / "live": real PayPal REST APIs (requires client id + secret).
 *  - "simulated": an in-process PayPal emulator. Used by the test-suite and for
 *    offline development. Every screen that is powered by the simulator says so.
 *
 * AI mode:
 *  - "claude": Anthropic Claude via the official SDK (requires ANTHROPIC_API_KEY).
 *  - "heuristic": deterministic rules used by tests and as an offline fallback.
 */
const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default("0.0.0.0"),
  PUBLIC_URL: z.string().url().optional(),
  /** Set automatically by Render. */
  RENDER_EXTERNAL_URL: z.string().url().optional(),
  DATABASE_URL: z.string().optional(),
  DATA_DIR: z.string().default("./data"),
  JWT_SECRET: z.string().min(16).optional(),
  CORS_ORIGINS: z.string().optional(),
  WEB_DIR: z.string().optional(),

  PAYPAL_MODE: z.enum(["sandbox", "live", "simulated"]).optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),

  AI_MODE: z.enum(["claude", "heuristic"]).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  TIDEOVER_ANTHROPIC_BASE_URL: z.string().url().optional(),
  CLAUDE_MODEL: z.string().default("claude-opus-5-5"),

  SEED_DEMO: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  ADMIN_EMAIL: z.string().email().default("admin@tideover.app"),
  ADMIN_PASSWORD: z.string().min(8).default("tideover-admin"),
  REVIEWER_EMAIL: z.string().email().default("reviewer@tideover.app"),
  REVIEWER_PASSWORD: z.string().min(8).default("tideover-review"),

  PAYOUT_POLL_INTERVAL_MS: z.coerce.number().int().default(4000),
  SIMULATED_PAYOUT_DELAY_MS: z.coerce.number().int().default(6000),
});

export type PayPalMode = "sandbox" | "live" | "simulated";
export type AiMode = "claude" | "heuristic";

export interface AppConfig {
  env: string;
  isProduction: boolean;
  port: number;
  host: string;
  publicUrl: string;
  databaseUrl?: string;
  dataDir: string;
  jwtSecret: string;
  corsOrigins: string[] | true;
  webDir?: string;
  paypal: {
    mode: PayPalMode;
    clientId?: string;
    clientSecret?: string;
    webhookId?: string;
  };
  ai: {
    mode: AiMode;
    apiKey?: string;
    baseUrl: string;
    model: string;
  };
  seedDemo: boolean;
  admin: { email: string; password: string };
  reviewer: { email: string; password: string };
  payoutPollIntervalMs: number;
  simulatedPayoutDelayMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  const isProduction = parsed.NODE_ENV === "production";

  const hasPayPalCreds = Boolean(parsed.PAYPAL_CLIENT_ID && parsed.PAYPAL_CLIENT_SECRET);
  const paypalMode: PayPalMode = parsed.PAYPAL_MODE ?? (hasPayPalCreds ? "sandbox" : "simulated");
  if (paypalMode !== "simulated" && !hasPayPalCreds) {
    throw new Error(`PAYPAL_MODE=${paypalMode} requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET`);
  }

  const aiMode: AiMode = parsed.AI_MODE ?? (parsed.ANTHROPIC_API_KEY ? "claude" : "heuristic");
  if (aiMode === "claude" && !parsed.ANTHROPIC_API_KEY) {
    throw new Error("AI_MODE=claude requires ANTHROPIC_API_KEY");
  }

  if (isProduction && !parsed.JWT_SECRET) {
    throw new Error("JWT_SECRET must be set in production");
  }

  const publicUrl = (parsed.PUBLIC_URL ?? parsed.RENDER_EXTERNAL_URL ?? `http://localhost:${parsed.PORT}`).replace(/\/$/, "");

  return {
    env: parsed.NODE_ENV,
    isProduction,
    port: parsed.PORT,
    host: parsed.HOST,
    publicUrl,
    databaseUrl: parsed.DATABASE_URL,
    dataDir: parsed.DATA_DIR,
    jwtSecret: parsed.JWT_SECRET ?? "tideover-dev-secret-change-me",
    corsOrigins: parsed.CORS_ORIGINS
      ? parsed.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
      : true,
    webDir: parsed.WEB_DIR,
    paypal: {
      mode: paypalMode,
      clientId: parsed.PAYPAL_CLIENT_ID,
      clientSecret: parsed.PAYPAL_CLIENT_SECRET,
      webhookId: parsed.PAYPAL_WEBHOOK_ID,
    },
    ai: {
      mode: aiMode,
      apiKey: parsed.ANTHROPIC_API_KEY,
      baseUrl: parsed.TIDEOVER_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
      model: parsed.CLAUDE_MODEL,
    },
    seedDemo: parsed.SEED_DEMO,
    admin: { email: parsed.ADMIN_EMAIL, password: parsed.ADMIN_PASSWORD },
    reviewer: { email: parsed.REVIEWER_EMAIL, password: parsed.REVIEWER_PASSWORD },
    payoutPollIntervalMs: parsed.PAYOUT_POLL_INTERVAL_MS,
    simulatedPayoutDelayMs: parsed.SIMULATED_PAYOUT_DELAY_MS,
  };
}
