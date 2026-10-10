import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export interface DbHandle {
  db: Db;
  kind: "postgres" | "pglite";
  close(): Promise<void>;
}

const here = dirname(fileURLToPath(import.meta.url));

/** Migrations live in server/drizzle (dev, via tsx) or dist/drizzle (built). */
function migrationsFolder(): string {
  const candidates = [resolve(here, "../../drizzle"), resolve(here, "../drizzle")];
  return candidates.find((p) => existsSync(join(p, "meta", "_journal.json"))) ?? candidates[0]!;
}

/**
 * Opens the database. With DATABASE_URL we use Postgres (production on Render);
 * without it we use PGlite, an embedded Postgres, so the app runs anywhere with
 * zero setup. `memory://` gives an ephemeral database for tests.
 */
export async function openDatabase(opts: { databaseUrl?: string; dataDir: string }): Promise<DbHandle> {
  const folder = migrationsFolder();
  if (opts.databaseUrl && !opts.databaseUrl.startsWith("memory://")) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const client = postgres(opts.databaseUrl, { max: 10, onnotice: () => {} });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: folder });
    return { db: db as unknown as Db, kind: "postgres", close: () => client.end() };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  let client: InstanceType<typeof PGlite>;
  if (opts.databaseUrl?.startsWith("memory://")) {
    client = new PGlite();
  } else {
    const dir = resolve(opts.dataDir, "pglite");
    mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
  }
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: folder });
  return { db: db as unknown as Db, kind: "pglite", close: () => client.close() };
}
