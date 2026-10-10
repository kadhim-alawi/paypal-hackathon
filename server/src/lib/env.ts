import { existsSync } from "node:fs";

// Local development: read server/.env when present (production uses real env vars).
if (existsSync(".env")) process.loadEnvFile(".env");
