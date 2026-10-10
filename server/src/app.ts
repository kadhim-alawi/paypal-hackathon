import { existsSync } from "node:fs";
import { resolve } from "node:path";
import compress from "@fastify/compress";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, LogController } from "fastify";
import { ZodError } from "zod";
import { type AiProvider, createAi } from "./ai/index.js";
import type { AppConfig } from "./config.js";
import { type DbHandle, openDatabase } from "./db/client.js";
import { startPayoutPoller } from "./domain/disbursement.js";
import { JobRunner } from "./domain/jobs.js";
import { handlePayPalWebhook } from "./domain/webhooks.js";
import { EventBus } from "./lib/events.js";
import { HttpError } from "./lib/errors.js";
import { mcpRoutes } from "./mcp/server.js";
import { createPayPalGateway, PayPalApiError, type PayPalGateway } from "./paypal/index.js";
import { SimulatedPayPalGateway } from "./paypal/simulator.js";
import { applicantRoutes } from "./routes/applicant.js";
import { donationRoutes } from "./routes/donations.js";
import { publicRoutes } from "./routes/public.js";
import { simulatorRoutes } from "./routes/simulator.js";
import { staffRoutes } from "./routes/staff.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { seedIfEmpty } from "./seed.js";
import type { Services } from "./services.js";

export interface BuildOptions {
  config: AppConfig;
  logger?: boolean | object;
  paypal?: PayPalGateway;
  ai?: AiProvider;
  /** Disable background loops and rate limits (tests). */
  test?: boolean;
}

export async function buildApp(opts: BuildOptions): Promise<{ app: FastifyInstance; services: Services; db: DbHandle }> {
  const { config } = opts;
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 12 * 1024 * 1024,
    trustProxy: true,
    logController: new LogController({ disableRequestLogging: true }),
  });

  const db = await openDatabase({ databaseUrl: config.databaseUrl, dataDir: config.dataDir });
  const bus = new EventBus();
  const paypal = opts.paypal ?? createPayPalGateway(config);
  const ai = opts.ai ?? createAi(config);
  const jobs = new JobRunner(app.log);
  const services: Services = { config, db: db.db, bus, paypal, ai, jobs, log: app.log };

  if (paypal instanceof SimulatedPayPalGateway) {
    // Simulated webhooks are delivered in-process (no signature to verify).
    paypal.onWebhook = (event) => handlePayPalWebhook(services, event, true).then(() => undefined);
  }

  await app.register(compress, { global: true, threshold: 1024, encodings: ["br", "gzip"] });
  await app.register(cors, { origin: config.corsOrigins, credentials: false });
  await app.register(formbody);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  if (!opts.test) {
    await app.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute" });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message, details: error.details });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "bad_request", message: "Invalid request", details: error.issues });
    }
    if (error instanceof PayPalApiError) {
      request.log.error({ err: error, debugId: error.debugId }, "PayPal API error");
      return reply.code(502).send({
        error: "paypal_error",
        message: `PayPal: ${error.message}${error.issue ? ` (${error.issue})` : ""}`,
        debugId: error.debugId,
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: "request_error", message: (error as Error).message });
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ error: "internal", message: "Something went wrong on our side." });
  });

  await publicRoutes(app, services);
  await applicantRoutes(app, services);
  await donationRoutes(app, services);
  await staffRoutes(app, services);
  await webhookRoutes(app, services);
  await simulatorRoutes(app, services);
  await mcpRoutes(app, services);

  // Flutter web build (single-page app) served from the same origin.
  const webDir = config.webDir ? resolve(config.webDir) : null;
  if (webDir && existsSync(resolve(webDir, "index.html"))) {
    await app.register(fastifyStatic, {
      root: webDir,
      prefix: "/",
      index: ["index.html"],
      setHeaders: (res, path) => {
        // Flutter's bootstrap and entry files must revalidate; everything else is versioned by the build.
        const revalidate = /(index\.html|flutter_bootstrap\.js|flutter_service_worker\.js|main\.dart\.(js|wasm|mjs)|version\.json|manifest\.json)$/.test(path);
        res.header("Cache-Control", revalidate ? "no-cache" : "public, max-age=86400");
      },
    });
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split("?")[0]!;
      if (req.method !== "GET" || /^\/(api|mcp|give|sim)(\/|$)/.test(path) || /\.[a-z0-9]{2,5}$/i.test(path)) {
        return reply.code(404).send({ error: "not_found", message: "Not found" });
      }
      return reply.header("Cache-Control", "no-cache").sendFile("index.html");
    });
  } else {
    app.get("/", async () => ({
      name: "Tideover API",
      docs: "See README.md. The Flutter web app is served here when WEB_DIR points at its build.",
    }));
  }

  if (config.seedDemo) {
    const seeded = await seedIfEmpty(services);
    if (seeded) app.log.info("Seeded demo data");
  }

  let stopPoller = () => {};
  if (!opts.test) stopPoller = startPayoutPoller(services);

  app.addHook("onClose", async () => {
    stopPoller();
    await jobs.idle();
    if (paypal instanceof SimulatedPayPalGateway) paypal.dispose();
    await db.close();
  });

  return { app, services, db };
}
