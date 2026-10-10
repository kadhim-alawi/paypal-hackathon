import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { ledgerEntries, payouts } from "../db/schema.js";
import { newId } from "../lib/ids.js";
import type { LedgerKind } from "./types.js";

/**
 * Double-entry is overkill for a single PayPal balance per fund; instead every
 * movement of the fund's money is one signed row. Rows are idempotent on
 * (kind, ref_type, ref_id), so webhook retries and pollers can't double-count.
 */
export async function postLedger(
  db: Db,
  entry: { fundId: string; kind: LedgerKind; amountCents: number; refType: string; refId: string; memo?: string },
): Promise<boolean> {
  const inserted = await db
    .insert(ledgerEntries)
    .values({ id: newId("led"), ...entry })
    .onConflictDoNothing({ target: [ledgerEntries.kind, ledgerEntries.refType, ledgerEntries.refId] })
    .returning({ id: ledgerEntries.id });
  return inserted.length > 0;
}

export async function fundBalanceCents(db: Db, fundId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountCents}), 0)` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.fundId, fundId));
  return Number(row?.total ?? 0);
}

/** Payouts created but not yet accepted by PayPal still commit the money. */
export async function committedPendingCents(db: Db, fundId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${payouts.amountCents}), 0)` })
    .from(payouts)
    .where(and(eq(payouts.fundId, fundId), inArray(payouts.status, ["pending"])));
  return Number(row?.total ?? 0);
}

export async function availableCents(db: Db, fundId: string): Promise<number> {
  return (await fundBalanceCents(db, fundId)) - (await committedPendingCents(db, fundId));
}
