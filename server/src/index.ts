import "./lib/env.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app, services } = await buildApp({
  config,
  logger: config.isProduction
    ? { level: "info" }
    : { level: "info", transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } },
});

await app.listen({ port: config.port, host: config.host });
app.log.info(
  `Tideover ready on ${config.publicUrl} · PayPal: ${services.paypal.mode} · AI: ${services.ai.mode} (${services.ai.model})`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} received, shutting down`);
    void app.close().then(() => process.exit(0));
  });
}
