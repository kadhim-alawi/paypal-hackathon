import { and, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { type Application, applications, type DocumentRow, documents, type Fund } from "../db/schema.js";
import { formatMoney } from "../lib/money.js";
import type { RiskFlag } from "./types.js";

/** Normalizes payout receivers so "Maria@X.com " and "maria@x.com" match. */
export function normalizeReceiver(method: string | null, receiver: string | null): string | null {
  if (!receiver) return null;
  if (method === "venmo_phone") return receiver.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return receiver.trim().toLowerCase();
}

function shingles(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñü\s]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

export function textSimilarity(a: string, b: string): number {
  const x = shingles(a);
  const y = shingles(b);
  if (x.size < 3 || y.size < 3) return 0;
  let inter = 0;
  for (const s of x) if (y.has(s)) inter++;
  return inter / (x.size + y.size - inter);
}

const DAY = 86_400_000;

/**
 * Deterministic fraud and policy checks. These run before (and independently
 * of) the AI caseworker; the AI explains them, but cannot override them.
 */
export async function computeRiskFlags(
  db: Db,
  fund: Fund,
  app: Application,
  docs: DocumentRow[],
): Promise<RiskFlag[]> {
  const flags: RiskFlag[] = [];
  const receiver = normalizeReceiver(app.payoutMethod, app.payoutReceiver);
  const identityConds = [
    app.paypalPayerId ? eq(applications.paypalPayerId, app.paypalPayerId) : undefined,
    receiver ? eq(applications.payoutReceiver, receiver) : undefined,
  ].filter((c): c is NonNullable<typeof c> => Boolean(c));

  if (identityConds.length > 0) {
    const others = await db
      .select({
        id: applications.id,
        publicRef: applications.publicRef,
        status: applications.status,
        paidAt: applications.paidAt,
        fundId: applications.fundId,
      })
      .from(applications)
      .where(and(ne(applications.id, app.id), eq(applications.fundId, fund.id), or(...identityConds)));

    const cooldownStart = Date.now() - fund.cooldownDays * DAY;
    const recentGrant = others.find(
      (o) => ["paid", "paying", "unclaimed"].includes(o.status) && (o.paidAt?.getTime() ?? Date.now()) >= cooldownStart,
    );
    if (recentGrant) {
      flags.push({
        code: "cooldown_recent_grant",
        severity: "block",
        message: `The same payout account received a grant (${recentGrant.publicRef}) within the fund's ${fund.cooldownDays}-day cooldown.`,
        relatedApplicationId: recentGrant.id,
      });
    }
    const open = others.find((o) =>
      ["submitted", "needs_info", "in_review", "approved", "awaiting_funds"].includes(o.status),
    );
    if (open) {
      flags.push({
        code: "duplicate_open_request",
        severity: "warn",
        message: `Another open request (${open.publicRef}) uses the same payout account.`,
        relatedApplicationId: open.id,
      });
    }
  }

  if (docs.length > 0) {
    const reused = await db
      .select({ applicationId: documents.applicationId, publicRef: applications.publicRef })
      .from(documents)
      .innerJoin(applications, eq(applications.id, documents.applicationId))
      .where(
        and(
          inArray(
            documents.sha256,
            docs.map((d) => d.sha256),
          ),
          ne(documents.applicationId, app.id),
        ),
      )
      .limit(1);
    if (reused[0]) {
      flags.push({
        code: "duplicate_document",
        severity: "block",
        message: `An identical document file was already submitted with request ${reused[0].publicRef}.`,
        relatedApplicationId: reused[0].applicationId,
      });
    }
  }

  const story = app.needSummary ?? "";
  if (story.length > 40) {
    const recent = await db
      .select({ id: applications.id, publicRef: applications.publicRef, needSummary: applications.needSummary, receiver: applications.payoutReceiver })
      .from(applications)
      .where(
        and(
          ne(applications.id, app.id),
          gte(applications.createdAt, new Date(Date.now() - 30 * DAY)),
          sql`${applications.needSummary} is not null`,
        ),
      )
      .limit(500);
    const similar = recent.find(
      (r) => r.receiver !== receiver && textSimilarity(story, r.needSummary ?? "") >= 0.6,
    );
    if (similar) {
      flags.push({
        code: "similar_story",
        severity: "warn",
        message: `The description is nearly identical to request ${similar.publicRef} from a different payout account.`,
        relatedApplicationId: similar.id,
      });
    }
  }

  if (app.clientFingerprint) {
    const [row] = await db
      .select({ n: sql<string>`count(*)` })
      .from(applications)
      .where(
        and(
          eq(applications.clientFingerprint, app.clientFingerprint),
          ne(applications.id, app.id),
          gte(applications.createdAt, new Date(Date.now() - DAY)),
          ne(applications.status, "intake"),
        ),
      );
    if (Number(row?.n ?? 0) >= 2) {
      flags.push({
        code: "velocity_device",
        severity: "warn",
        message: `${Number(row!.n) + 1} requests were submitted from the same device/network in the last 24 hours.`,
      });
    }
  }

  const category = fund.rubric.categories.find((c) => c.key === app.category);
  const requested = app.amountRequestedCents ?? 0;
  const cap = Math.min(category?.maxCents ?? fund.maxGrantCents, fund.maxGrantCents);
  if (requested > cap) {
    flags.push({
      code: "amount_over_cap",
      severity: "warn",
      message: `Requested ${formatMoney(requested, fund.currency)} exceeds the ${category?.label ?? "fund"} cap of ${formatMoney(cap, fund.currency)}; any grant will be capped.`,
    });
  }

  const docAmounts = docs.map((d) => d.extraction?.amountCents).filter((a): a is number => a != null);
  if (requested > 0 && docAmounts.length > 0) {
    const closest = docAmounts.reduce((best, a) => (Math.abs(a - requested) < Math.abs(best - requested) ? a : best));
    const diff = Math.abs(closest - requested);
    if (diff > 2000 && diff / requested > 0.15) {
      flags.push({
        code: "doc_amount_mismatch",
        severity: "warn",
        message: `Documents show ${formatMoney(closest, fund.currency)} but ${formatMoney(requested, fund.currency)} was requested.`,
      });
    }
  }

  const redFlags = docs.flatMap((d) => d.extraction?.redFlags ?? []);
  if (redFlags.length > 0) {
    flags.push({ code: "doc_red_flags", severity: "warn", message: `Document check: ${redFlags.slice(0, 3).join("; ")}` });
  }

  if (docs.length === 0 && (category?.evidence.length ?? 0) > 0) {
    flags.push({
      code: "no_document",
      severity: "info",
      message: `No supporting document (the policy suggests: ${category!.evidence.join(", ")}).`,
    });
  }

  if (app.payoutMethod && app.payoutMethod !== "paypal_account") {
    flags.push({
      code: "unverified_payout",
      severity: "info",
      message: "Payout destination was typed in, not verified with Log in with PayPal.",
    });
  } else if (app.payoutMethod === "paypal_account" && !app.payoutVerified) {
    flags.push({
      code: "paypal_unverified_account",
      severity: "info",
      message: "The connected PayPal account is not a verified account.",
    });
  }

  return flags;
}
