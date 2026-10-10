import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

// Opens the database (running migrations) and seeds demo data if it's empty.
const { app } = await buildApp({ config: { ...loadConfig(), seedDemo: true }, test: true });
await app.close();
console.log("Database ready.");
