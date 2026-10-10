import type { AiProvider } from "./ai/index.js";
import type { AppConfig } from "./config.js";
import type { Db } from "./db/client.js";
import type { JobRunner } from "./domain/jobs.js";
import type { EventBus } from "./lib/events.js";
import type { PayPalGateway } from "./paypal/index.js";

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** Everything the domain layer needs, passed explicitly (no globals). */
export interface Services {
  config: AppConfig;
  db: Db;
  bus: EventBus;
  paypal: PayPalGateway;
  ai: AiProvider;
  jobs: JobRunner;
  log: Logger;
}
