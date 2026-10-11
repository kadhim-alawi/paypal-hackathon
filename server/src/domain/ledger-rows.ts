import { desc, eq, inArray } from "drizzle-orm";
import { applications, donations, funds, ledgerEntries, payouts } from "../db/schema.js";
import type { Services } from "../services.js";
import type { LedgerKind } from "./types.js";

/**
 * One row per money movement, flattened for the treasurer's Ledger grid: the
 * spreadsheet a fund's treasurer would otherwise keep by hand, built from the
 * append-only ledger and joined to the PayPal records behind each entry.
 */
export interface LedgerRow {
  id: string;
  /** YYYY-MM-DD, for date filters. */
  date: string;
  /** YYYY-MM, for grouping by month. */
  month: string;
  at: string;
  fund: string;
  type: string;
  direction: "In" | "Out";
  /** Always positive, in dollars. */
  amount: number;
  /** Signed effect on the fund's balance, in dollars. */
  net: number;
  category: string | null;
  party: string | null;
  method: string | null;
  channel: string | null;
  caseRef: string | null;
  paypalId: string | null;
  status: string | null;
  memo: string | null;
}

const TYPE: Record<LedgerKind, string> = {
  donation: "Donation",
  donation_fee: "PayPal fee (donation)",
  refund: "Refund",
  payout: "Grant",
  payout_fee: "PayPal fee (payout)",
  payout_reversal: "Returned grant",
  adjustment: "Adjustment",
};

const METHOD: Record<string, string> = {
  paypal_account: "PayPal account",
  paypal_email: "PayPal email",
  venmo_phone: "Venmo",
};

export async function ledgerRows(s: Services, limit = 5000): Promise<LedgerRow[]> {
  const entries = await s.db
    .select({ e: ledgerEntries, fundName: funds.name, rubric: funds.rubric })
    .from(ledgerEntries)
    .innerJoin(funds, eq(funds.id, ledgerEntries.fundId))
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(limit);

  const donationIds = entries.filter((r) => r.e.refType === "donation" && r.e.refId).map((r) => r.e.refId!);
  const payoutIds = entries.filter((r) => r.e.refType === "payout" && r.e.refId).map((r) => r.e.refId!);
  const donationRows = donationIds.length
    ? await s.db.select().from(donations).where(inArray(donations.id, [...new Set(donationIds)]))
    : [];
  const payoutRows = payoutIds.length
    ? await s.db
        .select({ p: payouts, ref: applications.publicRef, category: applications.category })
        .from(payouts)
        .innerJoin(applications, eq(applications.id, payouts.applicationId))
        .where(inArray(payouts.id, [...new Set(payoutIds)]))
    : [];
  const needRefs = donationRows.filter((d) => d.applicationId).map((d) => d.applicationId!);
  const needRows = needRefs.length
    ? await s.db
        .select({ id: applications.id, ref: applications.publicRef })
        .from(applications)
        .where(inArray(applications.id, [...new Set(needRefs)]))
    : [];
  const donationById = new Map(donationRows.map((d) => [d.id, d]));
  const payoutById = new Map(payoutRows.map((r) => [r.p.id, r]));
  const needRefById = new Map(needRows.map((n) => [n.id, n.ref]));

  return entries.map(({ e, fundName, rubric }) => {
    const cents = e.amountCents;
    const iso = e.createdAt.toISOString();
    const row: LedgerRow = {
      id: e.id,
      date: iso.slice(0, 10),
      month: iso.slice(0, 7),
      at: iso,
      fund: fundName,
      type: TYPE[e.kind] ?? e.kind,
      direction: cents >= 0 ? "In" : "Out",
      amount: Math.abs(cents) / 100,
      net: cents / 100,
      category: null,
      party: null,
      method: null,
      channel: null,
      caseRef: null,
      paypalId: null,
      status: null,
      memo: e.memo,
    };
    const d = e.refType === "donation" && e.refId ? donationById.get(e.refId) : undefined;
    if (d) {
      row.party = d.anonymous ? `${d.donorName ?? "Donor"} (anonymous publicly)` : (d.donorName ?? d.donorEmail ?? "Donor");
      row.method = "PayPal checkout";
      row.channel = d.source === "agent" ? "AI agent" : "Web";
      row.category = d.applicationId ? "Sponsored need" : "General fund";
      row.caseRef = d.applicationId ? (needRefById.get(d.applicationId) ?? null) : null;
      row.paypalId = d.paypalCaptureId;
      row.status = d.status;
    }
    const p = e.refType === "payout" && e.refId ? payoutById.get(e.refId) : undefined;
    if (p) {
      const label = rubric.categories.find((c) => c.key === p.category)?.label;
      row.category = label ?? p.category ?? null;
      row.party = `Applicant (${p.ref})`;
      row.method = METHOD[p.p.method] ?? p.p.method;
      row.channel = "Staff";
      row.caseRef = p.ref;
      row.paypalId = p.p.paypalTransactionId ?? p.p.paypalBatchId;
      row.status = p.p.status;
    }
    if (e.kind === "adjustment") row.channel = "Staff";
    return row;
  });
}
