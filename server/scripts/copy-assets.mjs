// Copies non-TS runtime assets (SQL migrations) next to the compiled output.
import { cpSync, existsSync } from "node:fs";

if (existsSync("drizzle")) {
  cpSync("drizzle", "dist/drizzle", { recursive: true });
}
