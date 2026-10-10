import type { FastifyInstance } from "fastify";
import type { AiProvider } from "../src/ai/types.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { SimulatedPayPalGateway } from "../src/paypal/simulator.js";
import type { Services } from "../src/services.js";

export interface TestCtx {
  app: FastifyInstance;
  s: Services;
  sim: SimulatedPayPalGateway;
  close(): Promise<void>;
}

export async function makeApp(overrides: Record<string, string> = {}, ai?: AiProvider): Promise<TestCtx> {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "memory://",
    PUBLIC_URL: "http://tideover.test",
    PAYPAL_MODE: "simulated",
    AI_MODE: "heuristic",
    SEED_DEMO: "true",
    SIMULATED_PAYOUT_DELAY_MS: "0",
    ...overrides,
  } as NodeJS.ProcessEnv);
  const { app, services } = await buildApp({ config, test: true, ai });
  await app.ready();
  return {
    app,
    s: services,
    sim: services.paypal as SimulatedPayPalGateway,
    close: () => app.close(),
  };
}

export async function staffToken(app: FastifyInstance, who: "admin" | "reviewer" = "admin"): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload:
      who === "admin"
        ? { email: "admin@tideover.app", password: "tideover-admin" }
        : { email: "reviewer@tideover.app", password: "tideover-review" },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  return res.json().token as string;
}

/** Waits for all background jobs and simulated PayPal settlement to finish. */
export async function settle(ctx: TestCtx): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await ctx.s.jobs.idle();
    await ctx.sim.flushPayouts();
    await new Promise((r) => setTimeout(r, 5));
  }
  await ctx.s.jobs.idle();
}

export function multipartBody(filename: string, mime: string, data: Buffer) {
  const boundary = `----tideover${Date.now()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
