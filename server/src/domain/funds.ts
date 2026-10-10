import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { applications, donations, type Fund, funds } from "../db/schema.js";
import { badRequest } from "../lib/errors.js";
import { formatMoney } from "../lib/money.js";
import { median } from "../lib/time.js";
import type { Services } from "../services.js";
import { loadApplication, loadFund } from "./applications.js";
import { audit } from "./audit.js";
import { availableCents } from "./ledger.js";
import type { FundRubric } from "./types.js";
import { minutesToCash } from "./views.js";

export interface FundStats {
  raisedCents: number;
  donationsCount: number;
  grantedCents: number;
  peopleHelped: number;
  medianMinutesToCash: number | null;
  availableCents: number;
  awaitingCount: number;
  awaitingCents: number;
  inReviewCount: number;
}

export async function fundStats(s: Services, fund: Fund): Promise<FundStats> {
  const [don] = await s.db
    .select({
      total: sql<string>`coalesce(sum(${donations.amountCents}), 0)`,
      n: sql<string>`count(*)`,
    })
    .from(donations)
    .where(and(eq(donations.fundId, fund.id), eq(donations.status, "captured")));
  const paid = await s.db
    .select({
      amount: applications.amountApprovedCents,
      submittedAt: applications.submittedAt,
      paidAt: applications.paidAt,
    })
    .from(applications)
    .where(and(eq(applications.fundId, fund.id), inArray(applications.status, ["paid", "unclaimed"])));
  const [awaiting] = await s.db
    .select({ n: sql<string>`count(*)`, total: sql<string>`coalesce(sum(${applications.amountApprovedCents}), 0)` })
    .from(applications)
    .where(and(eq(applications.fundId, fund.id), eq(applications.status, "awaiting_funds")));
  const [review] = await s.db
    .select({ n: sql<string>`count(*)` })
    .from(applications)
    .where(
      and(eq(applications.fundId, fund.id), inArray(applications.status, ["submitted", "in_review", "needs_info"])),
    );
  const minutes = paid.map((p) => minutesToCash(p)).filter((m): m is number => m != null);
  return {
    raisedCents: Number(don?.total ?? 0),
    donationsCount: Number(don?.n ?? 0),
    grantedCents: paid.reduce((sum, p) => sum + (p.amount ?? 0), 0),
    peopleHelped: paid.length,
    medianMinutesToCash: median(minutes),
    availableCents: await availableCents(s.db, fund.id),
    awaitingCount: Number(awaiting?.n ?? 0),
    awaitingCents: Number(awaiting?.total ?? 0),
    inReviewCount: Number(review?.n ?? 0),
  };
}

export function publicFund(fund: Fund, stats: FundStats) {
  return {
    id: fund.id,
    slug: fund.slug,
    name: fund.name,
    tagline: fund.tagline,
    description: fund.description,
    region: fund.region,
    currency: fund.currency,
    accentColor: fund.accentColor,
    status: fund.status,
    summary: fund.rubric.summary,
    categories: fund.rubric.categories.map((c) => ({ key: c.key, label: c.label, maxCents: c.maxCents, examples: c.examples })),
    maxGrantCents: fund.maxGrantCents,
    autoApproveLimitCents: fund.autoApproveLimitCents,
    stats,
  };
}

export type FeedItem =
  | { id: string; kind: "grant"; at: string; amountCents: number; text: string; categoryLabel: string; minutesToCash: number | null }
  | { id: string; kind: "donation"; at: string; amountCents: number; text: string; viaAgent: boolean }
  | { id: string; kind: "need"; at: string; amountCents: number; text: string; categoryLabel: string };

/** The public transparency feed: every grant and donation, anonymized. */
export async function fundFeed(s: Services, fund: Fund, limit = 30): Promise<FeedItem[]> {
  const grants = await s.db
    .select()
    .from(applications)
    .where(and(eq(applications.fundId, fund.id), inArray(applications.status, ["paid", "unclaimed"]), isNotNull(applications.paidAt)))
    .orderBy(desc(applications.paidAt))
    .limit(limit);
  const gifts = await s.db
    .select()
    .from(donations)
    .where(and(eq(donations.fundId, fund.id), eq(donations.status, "captured")))
    .orderBy(desc(donations.capturedAt))
    .limit(limit);
  const label = (key: string | null) => fund.rubric.categories.find((c) => c.key === key)?.label ?? "Emergency expense";
  const items: FeedItem[] = [
    ...grants.map((g) => {
      const minutes = minutesToCash(g);
      return {
        id: g.id,
        kind: "grant" as const,
        at: g.paidAt!.toISOString(),
        amountCents: g.amountApprovedCents ?? 0,
        categoryLabel: label(g.category),
        minutesToCash: minutes,
        text:
          g.publicStory ??
          `${label(g.category)} grant sent${minutes != null ? ` ${Math.max(1, Math.round(minutes))} min after the request` : ""}.`,
      };
    }),
    ...gifts.map((d) => ({
      id: d.id,
      kind: "donation" as const,
      at: (d.capturedAt ?? d.createdAt).toISOString(),
      amountCents: d.amountCents,
      viaAgent: d.source === "agent",
      text: `${d.anonymous || !d.donorName ? "Someone" : d.donorName.split(" ")[0]} gave ${formatMoney(d.amountCents, d.currency)}${d.source === "agent" ? ` through their AI assistant${d.agentName ? ` (${d.agentName})` : ""}` : ""}${d.applicationId ? " to fund a specific need" : ""}.`,
    })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** Approved requests waiting on donations, safe to show publicly. */
export async function sponsorableNeeds(s: Services, fund: Fund) {
  const rows = await s.db
    .select()
    .from(applications)
    .where(and(eq(applications.fundId, fund.id), eq(applications.status, "awaiting_funds")))
    .orderBy(applications.decidedAt);
  return rows.map((a) => {
    const cat = fund.rubric.categories.find((c) => c.key === a.category);
    return {
      id: a.id,
      categoryLabel: cat?.label ?? "Emergency expense",
      amountCents: a.amountApprovedCents ?? 0,
      approvedAt: a.decidedAt?.toISOString() ?? null,
      story: a.consentPublicStory && a.publicStory ? a.publicStory : null,
      location: a.consentPublicStory ? coarseLocation(a.facts.location) : null,
      urgency: a.facts.urgency ?? null,
    };
  });
}

function coarseLocation(loc: string | undefined): string | null {
  if (!loc) return null;
  if (/^\d{5}$/.test(loc)) return `${loc.slice(0, 3)}xx`;
  return loc.split(",")[0]!.trim().slice(0, 40);
}

/** Writes the anonymized one-line story shown on the public feed (consent only). */
export async function writePublicStory(s: Services, appId: string): Promise<void> {
  const app = await loadApplication(s, appId);
  if (!app.consentPublicStory || app.publicStory) return;
  const fund = await loadFund(s, app.fundId);
  const cat = fund.rubric.categories.find((c) => c.key === app.category);
  try {
    const story = await s.ai.writeStory({
      categoryLabel: cat?.label ?? "Emergency expense",
      amountCents: app.amountApprovedCents ?? 0,
      currency: fund.currency,
      region: fund.region,
      needSummary: app.needSummary ?? "",
      minutesToCash: minutesToCash(app),
    });
    if (!story || /@|\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(story)) return; // never publish contact details
    await s.db.update(applications).set({ publicStory: story.slice(0, 240) }).where(eq(applications.id, appId));
    s.bus.publish(`fund:${fund.id}`, "feed.updated", {});
  } catch (err) {
    s.log.warn({ err, appId }, "story generation failed");
  }
}

export interface FundSettingsInput {
  name?: string;
  tagline?: string;
  description?: string;
  region?: string;
  policyText?: string;
  rubric?: FundRubric;
  autoApproveLimitCents?: number;
  dualApprovalAboveCents?: number;
  status?: "open" | "paused";
  accentColor?: string;
}

export async function updateFundSettings(
  s: Services,
  fundId: string,
  input: FundSettingsInput,
  actor: { id: string; name: string },
): Promise<Fund> {
  const fund = await loadFund(s, fundId);
  const patch: Partial<Fund> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name.trim().slice(0, 120);
  if (input.tagline !== undefined) patch.tagline = input.tagline.trim().slice(0, 200);
  if (input.description !== undefined) patch.description = input.description.trim().slice(0, 4000);
  if (input.region !== undefined) patch.region = input.region.trim().slice(0, 120);
  if (input.policyText !== undefined) patch.policyText = input.policyText.trim().slice(0, 12_000);
  if (input.rubric !== undefined) {
    patch.rubric = input.rubric;
    patch.maxGrantCents = input.rubric.maxGrantCents;
    patch.cooldownDays = input.rubric.cooldownDays;
  }
  if (input.autoApproveLimitCents !== undefined) {
    if (input.autoApproveLimitCents < 0) throw badRequest("Auto-approval limit can't be negative.");
    patch.autoApproveLimitCents = Math.min(input.autoApproveLimitCents, patch.maxGrantCents ?? fund.maxGrantCents);
  }
  if (input.dualApprovalAboveCents !== undefined) patch.dualApprovalAboveCents = Math.max(0, input.dualApprovalAboveCents);
  if (input.status !== undefined) patch.status = input.status;
  if (input.accentColor !== undefined && /^#[0-9a-f]{6}$/i.test(input.accentColor)) patch.accentColor = input.accentColor;
  const [updated] = await s.db.update(funds).set(patch).where(eq(funds.id, fundId)).returning();
  await audit(s.db, {
    fundId,
    entityType: "fund",
    entityId: fundId,
    actorType: "staff",
    actorId: actor.id,
    actorName: actor.name,
    action: "fund.updated",
    summary: `${actor.name} updated fund settings (${Object.keys(input).join(", ")})`,
  });
  return updated!;
}
