import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { count, eq } from "drizzle-orm";
import {
  applications,
  auditEvents,
  documents,
  donations,
  funds,
  messages,
  payouts,
  reviews,
  users,
} from "./db/schema.js";
import { postLedger } from "./domain/ledger.js";
import type { Assessment, DocumentExtraction, FundRubric, RiskFlag } from "./domain/types.js";
import { newId, newPublicRef, newSecretToken, sha256Hex } from "./lib/ids.js";
import { hashPassword, verifyPassword } from "./lib/passwords.js";
import type { Services } from "./services.js";

const here = dirname(fileURLToPath(import.meta.url));

export const EASTSIDE_POLICY = `We help neighbors in East Austin (ZIP codes 78702, 78721, 78722, 78723 and 78741) get through a one-time emergency that threatens their housing, job, health or safety.

We can cover:
- Car repairs or transportation needed to get to work, school or medical care: up to $600
- Utility bills with a shut-off notice: up to $400
- Rent or a deposit to prevent an eviction: up to $750
- Prescriptions and urgent medical costs: up to $300
- Groceries and baby supplies in a crisis: up to $150

Our rules:
- One grant per household every 6 months.
- The expense should be urgent (due within 30 days) and one-time, not an ongoing monthly cost.
- We like to see a bill, estimate or notice. If you don't have one, tell us why.
- We don't pay fines, legal fees, debts already in collections, or anything illegal.
- The most we can give is $750.`;

export const EASTSIDE_RUBRIC: FundRubric = {
  summary:
    "One-time emergency grants for East Austin neighbors facing a car repair, utility shut-off, eviction, medical cost or food crisis. Up to $750, usually paid within the hour through PayPal or Venmo.",
  categories: [
    {
      key: "car_repair",
      label: "Car repair & transportation",
      maxCents: 60_000,
      examples: ["Brake or transmission repair to keep a job", "Bus pass after a breakdown"],
      evidence: ["repair estimate"],
    },
    {
      key: "utilities",
      label: "Utility shut-off",
      maxCents: 40_000,
      examples: ["Electric bill with a disconnection notice", "Water or gas shut-off"],
      evidence: ["utility bill or shut-off notice"],
    },
    {
      key: "rent",
      label: "Rent & eviction prevention",
      maxCents: 75_000,
      examples: ["Past-due rent with an eviction warning", "Deposit for emergency rehousing"],
      evidence: ["rent notice or lease ledger"],
    },
    {
      key: "medical",
      label: "Prescriptions & urgent medical",
      maxCents: 30_000,
      examples: ["Prescription not covered by insurance", "Urgent dental pain"],
      evidence: ["pharmacy quote or medical bill"],
    },
    {
      key: "food",
      label: "Groceries & baby supplies",
      maxCents: 15_000,
      examples: ["Groceries after a lost paycheck", "Formula and diapers"],
      evidence: [],
    },
  ],
  criteria: [
    { id: "c1", text: "Lives in the service area (ZIP 78702, 78721, 78722, 78723 or 78741).", kind: "required" },
    { id: "c2", text: "The expense is urgent (due within 30 days) and one-time.", kind: "required" },
    { id: "c3", text: "The need fits a covered category and is within its cap.", kind: "required" },
    { id: "c4", text: "A bill, estimate or notice supports the amount, or the applicant explains why not.", kind: "preferred" },
    { id: "c5", text: "The money is for fines, legal fees, debts in collections, or anything illegal.", kind: "disqualifying" },
    { id: "c6", text: "The household received a grant from this fund in the last 6 months.", kind: "disqualifying" },
  ],
  requiredInfo: [],
  maxGrantCents: 75_000,
  cooldownDays: 180,
};

export const RIVERSIDE_POLICY = `Riverside Community College's Student Emergency Grant helps currently enrolled students stay in school when an unexpected expense hits.

We can help with: textbooks and course supplies (up to $200), laptop or phone repair needed for classes (up to $300), transportation to campus (up to $150), and rent or utilities when housing is at risk (up to $500).

You must be enrolled this term. Please share your student ID number. One grant per academic year. Grants are up to $500.`;

export const RIVERSIDE_RUBRIC: FundRubric = {
  summary:
    "Emergency grants of up to $500 for enrolled Riverside Community College students, so a surprise expense doesn't end a semester.",
  categories: [
    { key: "books_supplies", label: "Textbooks & supplies", maxCents: 20_000, examples: ["Required textbook", "Lab kit"], evidence: ["bookstore quote"] },
    { key: "tech_repair", label: "Laptop or phone repair", maxCents: 30_000, examples: ["Cracked laptop screen"], evidence: ["repair quote"] },
    { key: "transport", label: "Transportation", maxCents: 15_000, examples: ["Monthly bus pass", "Gas to get to clinicals"], evidence: [] },
    { key: "housing", label: "Rent & utilities", maxCents: 50_000, examples: ["Rent gap after hours were cut"], evidence: ["rent notice or bill"] },
  ],
  criteria: [
    { id: "c1", text: "The applicant is enrolled at Riverside Community College this term.", kind: "required" },
    { id: "c2", text: "The expense threatens the student's ability to continue their classes.", kind: "required" },
    { id: "c3", text: "The need fits a covered category and is within its cap.", kind: "required" },
    { id: "c4", text: "The student received a grant earlier this academic year.", kind: "disqualifying" },
  ],
  requiredInfo: ["Student ID number", "Program of study and current term"],
  maxGrantCents: 50_000,
  cooldownDays: 365,
};

function demoAsset(name: string): Buffer | null {
  const candidates = [resolve(here, "../../demo-assets", name), resolve(here, "../../../demo-assets", name), resolve(process.cwd(), "demo-assets", name), resolve(process.cwd(), "../demo-assets", name)];
  const path = candidates.find((p) => existsSync(p));
  return path ? readFileSync(path) : null;
}

/** Small deterministic PRNG so demo data is stable across restarts. */
function rng(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export async function seedIfEmpty(s: Services): Promise<boolean> {
  const [row] = await s.db.select({ n: count() }).from(funds);
  if (Number(row?.n ?? 0) > 0) return false;
  await seedDemo(s);
  return true;
}

/**
 * Creates the two staff accounts on first boot and keeps their passwords in step
 * with ADMIN_PASSWORD and REVIEWER_PASSWORD, so changing them on a running
 * deployment takes effect at the next boot.
 */
export async function ensureStaffAccounts(s: Services): Promise<{ adminId: string; reviewerId: string; changed: number }> {
  const accounts = [
    { ...s.config.admin, name: "Avery Morgan", role: "admin" as const },
    { ...s.config.reviewer, name: "Sam Rivera", role: "reviewer" as const },
  ];
  const ids: string[] = [];
  let changed = 0;
  for (const a of accounts) {
    const [u] = await s.db.select().from(users).where(eq(users.email, a.email)).limit(1);
    if (!u) {
      const id = newId("usr");
      await s.db.insert(users).values({ id, email: a.email, name: a.name, role: a.role, passwordHash: await hashPassword(a.password) });
      ids.push(id);
      changed++;
      continue;
    }
    ids.push(u.id);
    if (!(await verifyPassword(a.password, u.passwordHash))) {
      await s.db.update(users).set({ passwordHash: await hashPassword(a.password) }).where(eq(users.id, u.id));
      changed++;
    }
  }
  return { adminId: ids[0]!, reviewerId: ids[1]!, changed };
}

export async function seedDemo(s: Services): Promise<void> {
  const now = Date.now();
  const rand = rng(20261112);

  // ---------------------------------------------------------------- users
  const { adminId } = await ensureStaffAccounts(s);

  // ---------------------------------------------------------------- funds
  const eastsideId = newId("fnd");
  const riversideId = newId("fnd");
  await s.db.insert(funds).values([
    {
      id: eastsideId,
      slug: "eastside",
      name: "Eastside Neighbors Emergency Fund",
      tagline: "Fast, dignified emergency cash for East Austin neighbors, usually within the hour.",
      description:
        "A volunteer-run mutual aid fund. Neighbors give, neighbors review, and Tideover's AI caseworker does the paperwork so money reaches people while it still matters. Every dollar in and out is shown below.",
      region: "East Austin, TX",
      policyText: EASTSIDE_POLICY,
      rubric: EASTSIDE_RUBRIC,
      maxGrantCents: EASTSIDE_RUBRIC.maxGrantCents,
      cooldownDays: EASTSIDE_RUBRIC.cooldownDays,
      autoApproveLimitCents: 20_000,
      dualApprovalAboveCents: 50_000,
      approvalsRequired: 1,
      accentColor: "#0E7C66",
      createdAt: new Date(now - 40 * DAY),
    },
    {
      id: riversideId,
      slug: "riverside-college",
      name: "Riverside College Student Emergency Grants",
      tagline: "So a surprise expense doesn't end a semester.",
      description:
        "Run by the Dean of Students office with alumni donations. Grants of up to $500 for enrolled students, reviewed the same day.",
      region: "Riverside Community College",
      policyText: RIVERSIDE_POLICY,
      rubric: RIVERSIDE_RUBRIC,
      maxGrantCents: RIVERSIDE_RUBRIC.maxGrantCents,
      cooldownDays: RIVERSIDE_RUBRIC.cooldownDays,
      autoApproveLimitCents: 0,
      dualApprovalAboveCents: 40_000,
      approvalsRequired: 1,
      accentColor: "#3B5BDB",
      createdAt: new Date(now - 25 * DAY),
    },
  ]);

  // Money already sitting in each fund's PayPal balance when Tideover was connected.
  await postLedger(s.db, {
    fundId: eastsideId,
    kind: "adjustment",
    amountCents: 175_000,
    refType: "opening_balance",
    refId: eastsideId,
    memo: "Opening balance in the fund's PayPal account",
  });

  // ------------------------------------------------------------ donations
  const donorNames = [
    "Priya S.", "Marcus J.", "Elena R.", "Tom W.", "Aisha K.", "Ben C.", "Rosa M.", "Chen L.", "Hannah P.",
    "Diego F.", "Grace O.", "Luis A.", "Nora B.", "Sam T.", "Ivy Q.", "Omar H.", "Kate D.", "Jamal R.",
  ];
  const donationAmounts = [2500, 5000, 10000, 2000, 7500, 25000, 5000, 1500, 10000, 3500, 5000, 20000, 4000, 5000, 15000, 2500, 50000, 10000, 5000, 3000, 7500, 10000];
  for (let i = 0; i < donationAmounts.length; i++) {
    const amount = donationAmounts[i]!;
    const fundId = i === 3 || i === 13 ? riversideId : eastsideId;
    const at = new Date(now - (21 - i * 0.9) * DAY - rand() * 6 * HOUR);
    const fee = Math.round(amount * 0.0199) + 49;
    const id = newId("don");
    const anonymous = rand() < 0.3;
    await s.db.insert(donations).values({
      id,
      fundId,
      amountCents: amount,
      status: "captured",
      donorName: donorNames[i % donorNames.length]!,
      anonymous,
      source: i === 9 || i === 17 ? "agent" : "web",
      agentName: i === 9 || i === 17 ? "Claude" : null,
      feeCents: fee,
      netCents: amount - fee,
      createdAt: at,
      capturedAt: at,
    });
    await postLedger(s.db, { fundId, kind: "donation", amountCents: amount, refType: "donation", refId: id, memo: "Seeded history" });
    await postLedger(s.db, { fundId, kind: "donation_fee", amountCents: -fee, refType: "donation", refId: id, memo: "Seeded history" });
  }

  // ------------------------------------------------------- past grants
  const history: Array<{ cat: string; amount: number; minutes: number; daysAgo: number; story: string; method: "paypal_account" | "venmo_phone" | "paypal_email" }> = [
    { cat: "car_repair", amount: 42_000, minutes: 38, daysAgo: 19, story: "A neighbor got their car back on the road and kept their warehouse job.", method: "paypal_account" },
    { cat: "utilities", amount: 18_650, minutes: 9, daysAgo: 17, story: "A family of four kept the lights and fridge on through a heat wave.", method: "venmo_phone" },
    { cat: "medical", amount: 9_480, minutes: 6, daysAgo: 15, story: "A grandmother picked up her heart medication the same afternoon.", method: "paypal_account" },
    { cat: "rent", amount: 65_000, minutes: 112, daysAgo: 13, story: "A parent covered a rent gap and avoided an eviction filing.", method: "paypal_email" },
    { cat: "food", amount: 12_000, minutes: 7, daysAgo: 11, story: "A new mom stocked up on formula and groceries after a delayed paycheck.", method: "venmo_phone" },
    { cat: "car_repair", amount: 27_500, minutes: 44, daysAgo: 9, story: "A home health aide fixed her brakes and got back to her clients.", method: "paypal_account" },
    { cat: "utilities", amount: 21_310, minutes: 12, daysAgo: 7, story: "A retiree's water service was restored before the weekend.", method: "paypal_account" },
    { cat: "medical", amount: 15_000, minutes: 8, daysAgo: 5, story: "A cook paid for an urgent dental visit and was back at work the next day.", method: "venmo_phone" },
    { cat: "rent", amount: 48_000, minutes: 61, daysAgo: 3, story: "A student and her son stayed in their apartment after a medical bill wiped out savings.", method: "paypal_account" },
    { cat: "food", amount: 8_500, minutes: 5, daysAgo: 2, story: "A neighbor between jobs filled the fridge for the week.", method: "paypal_email" },
  ];
  for (const h of history) {
    const submittedAt = new Date(now - h.daysAgo * DAY - rand() * 8 * HOUR);
    const paidAt = new Date(submittedAt.getTime() + h.minutes * MIN);
    const appId = newId("app");
    const payoutId = newId("pay");
    await s.db.insert(applications).values({
      id: appId,
      fundId: eastsideId,
      publicRef: newPublicRef(),
      accessTokenHash: sha256Hex(newSecretToken()),
      status: "paid",
      language: rand() < 0.35 ? "es" : "en",
      category: h.cat,
      amountRequestedCents: h.amount,
      amountRecommendedCents: h.amount,
      amountApprovedCents: h.amount,
      needSummary: h.story,
      payoutMethod: h.method,
      payoutReceiver: h.method === "venmo_phone" ? "5125550100" : "seeded@example.com",
      payoutVerified: h.method === "paypal_account",
      consentPublicStory: true,
      publicStory: h.story,
      aiRecommendation: "approve",
      aiConfidence: 0.9,
      aiStatus: "done",
      readyToSubmit: true,
      createdAt: new Date(submittedAt.getTime() - 6 * MIN),
      submittedAt,
      decidedAt: new Date(paidAt.getTime() - 2 * MIN),
      paidAt,
      updatedAt: paidAt,
    });
    const fee = Math.min(2000, Math.max(25, Math.round(h.amount * 0.02)));
    await s.db.insert(payouts).values({
      id: payoutId,
      applicationId: appId,
      fundId: eastsideId,
      amountCents: h.amount,
      status: "success",
      senderBatchId: `TDO_${payoutId}`,
      method: h.method,
      receiver: h.method === "venmo_phone" ? "5125550100" : "seeded@example.com",
      paypalBatchId: `SEEDED-${payoutId.slice(-8).toUpperCase()}`,
      paypalTransactionStatus: "SUCCESS",
      feeCents: fee,
      createdAt: new Date(paidAt.getTime() - 2 * MIN),
      sentAt: new Date(paidAt.getTime() - 2 * MIN),
      completedAt: paidAt,
    });
    await postLedger(s.db, { fundId: eastsideId, kind: "payout", amountCents: -h.amount, refType: "payout", refId: payoutId, memo: "Seeded history" });
    await postLedger(s.db, { fundId: eastsideId, kind: "payout_fee", amountCents: -fee, refType: "payout", refId: payoutId, memo: "Seeded history" });
  }

  // ------------------------------------------- cases waiting for a reviewer
  await seedReviewCase(s, {
    fundId: eastsideId,
    submittedAgo: 47 * MIN,
    language: "es",
    firstName: "Lucía",
    category: "utilities",
    amount: 28_640,
    need: "Electric bill is past due with a final disconnection notice; service will be cut on 10/14. Household includes a newborn who needs a working fridge and fan.",
    location: "78741",
    urgency: "this_week",
    payoutMethod: "paypal_account",
    transcript: [
      ["user", "Hola, me van a cortar la luz el martes y tengo un bebé recién nacido. Debo $286.40."],
      ["assistant", "Siento mucho que esté pasando por esto, Lucía. ¿En qué código postal vive?"],
      ["user", "78741"],
      ["assistant", "Gracias. Si tiene el aviso de desconexión, una foto ayuda a quien revisa su solicitud."],
      ["user", "Sí, aquí está"],
    ],
    doc: {
      file: "capital-power-shutoff-286.jpg",
      extraction: {
        docType: "notice",
        title: "Final notice: service disconnection",
        issuer: "Capital City Power & Light",
        recipientName: null,
        amountCents: 28_640,
        currency: "USD",
        dueDate: "2026-10-13",
        documentDate: "2026-10-07",
        summary: "Final disconnection notice for $286.40 due by 10/13/2026, service address in ZIP 78741.",
        legible: true,
        consistencyNotes: ["Amount matches the request exactly.", "Service address ZIP 78741 is inside the service area."],
        redFlags: [],
      },
    },
    assessment: {
      recommendation: "approve",
      recommendedAmountCents: 28_640,
      confidence: 0.93,
      summary:
        "Household faces an electric disconnection on 10/14 with a newborn at home. The disconnection notice verifies the $286.40 amount and an in-area service address. First request to this fund.",
      criteria: [
        ["c1", "met", "Notice shows a service address in ZIP 78741."],
        ["c2", "met", "Disconnection scheduled within 5 days; one-time past-due balance."],
        ["c3", "met", "Utility shut-off, $286.40 is under the $400 cap."],
        ["c4", "met", "Final disconnection notice uploaded and legible."],
        ["c5", "not_met", "Utility bill, not a fine or collections debt."],
        ["c6", "not_met", "No prior grants to this PayPal account."],
      ],
      reviewerNote: "Straightforward case.",
      riskNotes: [],
    },
    riskFlags: [],
  });

  await seedReviewCase(s, {
    fundId: eastsideId,
    submittedAgo: 2 * HOUR + 12 * MIN,
    language: "en",
    firstName: "Darnell",
    category: "rent",
    amount: 75_000,
    need: "Hours at the warehouse were cut for three weeks after an injury; $750 of October rent is past due and the landlord's notice warns of eviction filing after 10/20.",
    location: "78723",
    urgency: "this_week",
    payoutMethod: "paypal_account",
    transcript: [
      ["user", "I got hurt at work and they cut my hours. I'm $750 behind on rent and got a notice."],
      ["assistant", "I'm sorry, Darnell. That's a lot to deal with. What ZIP code are you in?"],
      ["user", "78723. The notice says they'll start eviction after the 20th."],
      ["assistant", "Thank you. A photo of the notice would help the reviewer."],
    ],
    doc: {
      file: "riverbend-rent-notice-750.jpg",
      extraction: {
        docType: "notice",
        title: "Notice of past due rent",
        issuer: "Riverbend Commons Apartments",
        recipientName: null,
        amountCents: 75_000,
        currency: "USD",
        dueDate: "2026-10-20",
        documentDate: "2026-10-06",
        summary: "Past-due rent notice for unit 214 showing a $750.00 balance due by October 20, 2026, with an eviction warning.",
        legible: true,
        consistencyNotes: ["Balance matches the $750 requested.", "Notice does not show the resident's name (unit number only)."],
        redFlags: [],
      },
    },
    assessment: {
      recommendation: "approve",
      recommendedAmountCents: 75_000,
      confidence: 0.84,
      summary:
        "Rent gap of $750 after reduced hours due to a work injury, with an eviction warning after 10/20. The notice verifies the balance; it identifies the unit but not the tenant's name.",
      criteria: [
        ["c1", "met", "Applicant reports ZIP 78723 (stated, not shown on the notice)."],
        ["c2", "met", "Balance due 10/20, eviction warning; one-time gap from lost hours."],
        ["c3", "met", "Rent & eviction prevention, $750 equals the category cap."],
        ["c4", "met", "Past-due rent notice uploaded."],
        ["c5", "not_met", "Rent owed to landlord, not collections or fines."],
        ["c6", "not_met", "No prior grants found."],
      ],
      reviewerNote: "Above $500, so a second reviewer must approve. Notice shows the unit but not the name.",
      riskNotes: ["Notice lists the unit number but not the resident's name; location is self-reported."],
    },
    riskFlags: [],
  });

  await seedReviewCase(s, {
    fundId: eastsideId,
    submittedAgo: 25 * MIN,
    language: "en",
    firstName: null,
    category: "car_repair",
    amount: 60_000,
    need: "Needs $600 for a transmission repair to get to work; no estimate provided.",
    location: "78702",
    urgency: "today",
    payoutMethod: "paypal_email",
    receiver: "quickcash.help22@example.com",
    transcript: [
      ["user", "need 600 for transmission repair asap to get to work. please send to my paypal"],
      ["assistant", "I'm sorry to hear that. Do you have a repair estimate from the shop?"],
      ["user", "no estimate the shop is closed. just need it today"],
    ],
    doc: null,
    assessment: {
      recommendation: "needs_info",
      recommendedAmountCents: 0,
      confidence: 0.71,
      summary:
        "Request for $600 car repair with no estimate and little detail. Automated checks found the same wording in another request from a different payout account this week, and several requests from the same network today.",
      criteria: [
        ["c1", "unclear", "ZIP 78702 is stated but not supported."],
        ["c2", "unclear", "Urgency stated; no details about the job or repair."],
        ["c3", "met", "Car repair category, at the $600 cap."],
        ["c4", "not_met", "No estimate and no explanation beyond 'shop is closed'."],
        ["c5", "unclear", "Nothing indicates fines or collections."],
        ["c6", "not_met", "No prior grants to this email."],
      ],
      reviewerNote: "Check the near-identical request and the device velocity before deciding; ask for the shop's name and an estimate.",
      riskNotes: [
        "The description closely matches another recent request paid to a different account, a common pattern in template fraud.",
        "Three requests came from the same network within 24 hours.",
        "Payout email was typed in, not verified with Log in with PayPal.",
      ],
    },
    riskFlags: [
      { code: "similar_story", severity: "warn", message: "The description is nearly identical to another request from a different payout account." },
      { code: "velocity_device", severity: "warn", message: "3 requests were submitted from the same device/network in the last 24 hours." },
      { code: "no_document", severity: "info", message: "No supporting document (the policy suggests: repair estimate)." },
      { code: "unverified_payout", severity: "info", message: "Payout destination was typed in, not verified with Log in with PayPal." },
    ],
  });

  // ------------------------------------- Riverside: an approved need waiting on donors
  const needId = newId("app");
  await s.db.insert(applications).values({
    id: needId,
    fundId: riversideId,
    publicRef: newPublicRef(),
    accessTokenHash: sha256Hex(newSecretToken()),
    status: "awaiting_funds",
    language: "en",
    category: "housing",
    amountRequestedCents: 42_000,
    amountRecommendedCents: 42_000,
    amountApprovedCents: 42_000,
    needSummary: "Nursing student's rent gap after clinical rotations cut work hours; landlord notice due at month end.",
    facts: { firstName: "Tran", location: "Riverside", urgency: "this_month" },
    payoutMethod: "paypal_account",
    payoutReceiver: "SIMDEVPAT8K3N",
    paypalPayerId: "SIMDEVPAT8K3N",
    paypalEmail: "dev.patel@personal.example.com",
    paypalName: "Dev Patel",
    payoutVerified: true,
    consentPublicStory: true,
    publicStory: "A nursing student needs help covering rent while unpaid clinical rotations cut her work hours.",
    aiRecommendation: "approve",
    aiConfidence: 0.88,
    aiStatus: "done",
    readyToSubmit: true,
    submittedAt: new Date(now - 26 * HOUR),
    decidedAt: new Date(now - 24 * HOUR),
    createdAt: new Date(now - 26 * HOUR - 8 * MIN),
    updatedAt: new Date(now - 24 * HOUR),
  });
  await s.db.insert(reviews).values({
    id: newId("rev"),
    applicationId: needId,
    reviewerId: adminId,
    reviewerName: "Avery Morgan",
    decision: "approve",
    amountCents: 42_000,
    note: "Verified enrollment with the registrar.",
    createdAt: new Date(now - 24 * HOUR),
  });

  await s.db.insert(auditEvents).values({
    id: newId("aud"),
    entityType: "fund",
    entityId: eastsideId,
    fundId: eastsideId,
    actorType: "system",
    action: "seed.demo",
    summary: "Demo data loaded (historical grants and donations are illustrative)",
  });
}

async function seedReviewCase(
  s: Services,
  c: {
    fundId: string;
    submittedAgo: number;
    language: string;
    firstName: string | null;
    category: string;
    amount: number;
    need: string;
    location: string;
    urgency: "today" | "this_week" | "this_month";
    payoutMethod: "paypal_account" | "paypal_email";
    receiver?: string;
    transcript: Array<["user" | "assistant", string]>;
    doc: { file: string; extraction: DocumentExtraction } | null;
    assessment: {
      recommendation: Assessment["recommendation"];
      recommendedAmountCents: number;
      confidence: number;
      summary: string;
      criteria: Array<[string, "met" | "not_met" | "unclear", string]>;
      reviewerNote: string;
      riskNotes: string[];
    };
    riskFlags: RiskFlag[];
  },
): Promise<void> {
  const now = Date.now();
  const id = newId("app");
  const submittedAt = new Date(now - c.submittedAgo);
  const createdAt = new Date(submittedAt.getTime() - 7 * MIN);
  const persona = c.payoutMethod === "paypal_account" ? { payerId: `SIMSEED${id.slice(-6).toUpperCase()}`, email: `${(c.firstName ?? "neighbor").toLowerCase()}@personal.example.com` } : null;
  const fundRows = await s.db.select().from(funds).where(eq(funds.id, c.fundId)).limit(1);
  const rubric = fundRows[0]!.rubric;
  await s.db.insert(applications).values({
    id,
    fundId: c.fundId,
    publicRef: newPublicRef(),
    accessTokenHash: sha256Hex(newSecretToken()),
    status: "in_review",
    language: c.language,
    applicantName: c.firstName,
    facts: {
      firstName: c.firstName ?? undefined,
      category: c.category,
      amountRequestedCents: c.amount,
      needSummary: c.need,
      location: c.location,
      urgency: c.urgency,
      payeeType: "self",
    },
    category: c.category,
    amountRequestedCents: c.amount,
    amountRecommendedCents: c.assessment.recommendedAmountCents || null,
    needSummary: c.need,
    readyToSubmit: true,
    assessment: {
      model: "claude-opus-5-5",
      summary: c.assessment.summary,
      recommendation: c.assessment.recommendation,
      recommendedAmountCents: c.assessment.recommendedAmountCents,
      confidence: c.assessment.confidence,
      criteria: c.assessment.criteria.map(([cid, verdict, evidence]) => ({
        id: cid,
        text: rubric.criteria.find((x) => x.id === cid)?.text ?? cid,
        verdict,
        evidence,
      })),
      documentFindings: c.doc ? [c.doc.extraction.summary] : [],
      questionsForApplicant:
        c.assessment.recommendation === "needs_info"
          ? ["What is the name of the repair shop, and can you upload their estimate?", "Where do you work, and how do you usually get there?"]
          : [],
      riskNotes: c.assessment.riskNotes,
      reviewerNote: c.assessment.reviewerNote,
      createdAt: new Date(submittedAt.getTime() + 40_000).toISOString(),
    },
    riskFlags: c.riskFlags,
    aiRecommendation: c.assessment.recommendation,
    aiConfidence: c.assessment.confidence,
    aiStatus: "done",
    payoutMethod: c.payoutMethod,
    payoutReceiver: persona?.payerId ?? c.receiver ?? null,
    payoutVerified: c.payoutMethod === "paypal_account",
    paypalPayerId: persona?.payerId ?? null,
    paypalEmail: persona?.email ?? null,
    paypalName: c.firstName,
    consentPublicStory: true,
    clientFingerprint: c.riskFlags.some((f) => f.code === "velocity_device") ? "seeded-velocity" : null,
    createdAt,
    submittedAt,
    updatedAt: submittedAt,
  });
  let t = createdAt.getTime();
  for (const [role, content] of c.transcript) {
    t += 50_000;
    await s.db.insert(messages).values({ id: newId("msg"), applicationId: id, role, content, createdAt: new Date(t) });
  }
  if (c.doc) {
    const data = demoAsset(c.doc.file);
    if (data) {
      await s.db.insert(documents).values({
        id: newId("doc"),
        applicationId: id,
        filename: c.doc.file,
        mimeType: "image/jpeg",
        sizeBytes: data.length,
        sha256: sha256Hex(Buffer.concat([data, Buffer.from(id)])), // unique per seeded case
        data,
        status: "ready",
        extraction: c.doc.extraction,
        createdAt: new Date(t + 30_000),
      });
    }
  }
  await s.db.insert(auditEvents).values([
    {
      id: newId("aud"),
      fundId: c.fundId,
      entityType: "application",
      entityId: id,
      actorType: "applicant",
      action: "application.submitted",
      summary: "Request submitted",
      createdAt: submittedAt,
    },
    {
      id: newId("aud"),
      fundId: c.fundId,
      entityType: "application",
      entityId: id,
      actorType: "ai",
      actorName: "claude-opus-5-5",
      action: "ai.assessed",
      summary: `AI caseworker recommends ${c.assessment.recommendation}, confidence ${c.assessment.confidence.toFixed(2)} [submitted]`,
      createdAt: new Date(submittedAt.getTime() + 40_000),
    },
  ]);
}
