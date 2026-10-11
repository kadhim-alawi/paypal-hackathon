import type { GridQueryContext, GridQueryResult } from "./types.js";

/**
 * Offline stand-in for "ask the ledger": keyword rules that produce AG Grid
 * state within the AG Grid AI Toolkit schema (only columns and values the schema
 * allows). Each question describes a fresh view: filters, sort, grouping and
 * totals are replaced; column layout is left alone.
 */
type Json = Record<string, unknown>;

const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const variants = (x: Json): Json[] => (Array.isArray(x.anyOf) ? (x.anyOf as Json[]) : [x]).filter((v) => v.type !== "null");
/** Properties of an object schema, looking through `anyOf` and nullable `type` arrays. */
function props(schema: unknown): Json {
  for (const v of variants(obj(schema))) {
    if (v.properties) return obj(v.properties);
  }
  return {};
}
function enumOf(schema: unknown): string[] {
  const s = obj(schema);
  if (Array.isArray(s.enum)) return s.enum as string[];
  for (const v of variants(s)) if (Array.isArray(v.enum)) return v.enum as string[];
  return [];
}
const itemsOf = (schema: unknown): Json => obj(obj(variants(obj(schema))[0]).items);

export function heuristicGridQuery(ctx: GridQueryContext): GridQueryResult {
  const q = ` ${ctx.question.toLowerCase()} `;
  const root = props(ctx.schema);
  const features = Object.keys(root);
  const notes: string[] = [];
  const gridState: Json = {};

  // ------------------------------------------------------------- grouping
  const groupable = enumOf(itemsOf(props(root.rowGroup).groupColIds));
  const groupRules: Array<[RegExp, string, string]> = [
    [/\bby fund\b|\bper fund\b|\beach fund\b/, "fund", "fund"],
    [/\bby (category|categories)\b|\bper category\b/, "category", "category"],
    [/\bby month\b|\bmonthly\b|\bper month\b|\bmonth by month\b/, "month", "month"],
    [/\bby (type|kind)\b/, "type", "type"],
    [/\bby (payout )?method\b|\bper method\b/, "method", "payout method"],
    [/\bby (channel|source)\b/, "channel", "channel"],
    [/\bby (donor|recipient|party)\b|\bper donor\b|\bbiggest donors\b|\btop donors\b/, "party", "donor or recipient"],
    [/\bin and out\b|\bin vs\.? out\b|\bby direction\b/, "direction", "money in and out"],
    [/\bby status\b/, "status", "status"],
  ];
  const groupColIds = groupRules.filter(([re, col]) => re.test(q) && groupable.includes(col)).map(([, col]) => col);
  if (features.includes("rowGroup")) {
    gridState.rowGroup = groupColIds.length ? { groupColIds } : null;
    if (groupColIds.length) {
      notes.push(`grouped by ${groupColIds.map((c) => groupRules.find((r) => r[1] === c)![2]).join(", then ")}`);
    }
  }

  // --------------------------------------------------------------- filters
  const filterCols = props(props(root.filter).filterModel);
  const filterModel: Json = {};
  const setFilter = (col: string, words: Array<[RegExp, (v: string) => boolean]>) => {
    const values = enumOf(itemsOf(props(filterCols[col]).values));
    if (!values.length) return;
    const picked = new Set<string>();
    for (const [re, match] of words) if (re.test(q)) values.filter(match).forEach((v) => picked.add(v));
    if (picked.size) {
      filterModel[col] = { filterType: "set", values: [...picked] };
      notes.push(`${col === "type" ? "" : `${col}: `}${[...picked].join(", ")}`);
    }
  };
  const has = (needle: string) => (v: string) => v.toLowerCase().includes(needle);
  setFilter("type", [
    [/\b(grants?|payouts?|paid out|sent)\b/, (v) => v === "Grant"],
    [/\b(donations?|gifts?|donors?|raised)\b/, (v) => v === "Donation"],
    [/\bfees?\b/, has("fee")],
    [/\brefunds?\b/, (v) => v === "Refund"],
    [/\breturned\b/, (v) => v === "Returned grant"],
  ]);
  setFilter("channel", [[/\b(ai agents?|agents?|agentic|mcp)\b/, (v) => v === "AI agent"]]);
  setFilter("method", [
    [/\bvenmo\b/, (v) => v === "Venmo"],
    [/\bpaypal email\b/, (v) => v === "PayPal email"],
    [/\bverified\b|\bpaypal accounts?\b/, (v) => v === "PayPal account"],
  ]);
  setFilter("status", [
    [/\bunclaimed\b/, (v) => v === "unclaimed"],
    [/\bfailed\b/, (v) => v === "failed"],
    [/\bpending\b|\bin flight\b|\bprocessing\b/, (v) => v === "pending" || v === "processing"],
    [/\brefunded\b/, (v) => v === "refunded"],
  ]);
  const fundValues = enumOf(itemsOf(props(filterCols.fund).values));
  const fundHits = fundValues.filter((v) => q.includes(` ${v.toLowerCase().split(" ")[0]} `));
  if (fundHits.length && !groupColIds.includes("fund")) {
    filterModel.fund = { filterType: "set", values: fundHits };
    notes.push(`fund: ${fundHits.join(", ")}`);
  }
  const categoryValues = enumOf(itemsOf(props(filterCols.category).values));
  const categoryHits = categoryValues.filter((v) => {
    const first = v.toLowerCase().split(/[\s&,]+/)[0]!;
    return first.length > 2 && new RegExp(`\\b${first.slice(0, 5)}`).test(q);
  });
  if (categoryHits.length && !groupColIds.includes("category")) {
    filterModel.category = { filterType: "set", values: categoryHits };
    notes.push(`category: ${categoryHits.join(", ")}`);
  }
  if (!groupColIds.includes("direction") && filterCols.direction) {
    if (/\b(money in|incoming|coming in)\b/.test(q)) filterModel.direction = { filterType: "set", values: ["In"] };
    else if (/\b(money out|outgoing|going out|spent|spending)\b/.test(q)) filterModel.direction = { filterType: "set", values: ["Out"] };
  }

  const over = /\b(over|above|more than|greater than|at least)\s*\$?\s*([\d,]+)/.exec(q);
  const under = /\b(under|below|less than|at most)\s*\$?\s*([\d,]+)/.exec(q);
  if (filterCols.amount && (over || under)) {
    const conditions = [];
    if (over) conditions.push({ filterType: "number", type: "greaterThan", filter: Number(over[2]!.replace(/,/g, "")), filterTo: null });
    if (under) conditions.push({ filterType: "number", type: "lessThan", filter: Number(under[2]!.replace(/,/g, "")), filterTo: null });
    filterModel.amount = { filterType: "number", operator: "AND", conditions };
    notes.push([over && `over $${over[2]}`, under && `under $${under[2]}`].filter(Boolean).join(" and "));
  }

  const today = new Date(`${ctx.today}T00:00:00Z`);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const dateCond = (type: string, from: Date, to?: Date) => ({
    filterType: "date",
    operator: "AND",
    conditions: [{ filterType: "date", type, dateFrom: `${ymd(from)} 00:00:00`, dateTo: to ? `${ymd(to)} 00:00:00` : null }],
  });
  if (filterCols.date) {
    const firstOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    if (/\bthis month\b/.test(q)) {
      filterModel.date = dateCond("greaterThan", new Date(firstOfMonth.getTime() - 86_400_000));
      notes.push("this month");
    } else if (/\blast month\b/.test(q)) {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      filterModel.date = dateCond("inRange", new Date(start.getTime() - 86_400_000), firstOfMonth);
      notes.push("last month");
    } else if (/\b(this week|last 7 days|past week|last week)\b/.test(q)) {
      filterModel.date = dateCond("greaterThan", new Date(today.getTime() - 8 * 86_400_000));
      notes.push("last 7 days");
    } else if (/\btoday\b/.test(q)) {
      filterModel.date = dateCond("equals", today);
      notes.push("today");
    }
  }
  if (features.includes("filter")) gridState.filter = Object.keys(filterModel).length ? { filterModel } : null;

  // ------------------------------------------------------------------ sort
  const sortable = enumOf(props(itemsOf(props(root.sort).sortModel)).colId);
  let sortModel: Json[] | null = null;
  if (/\b(largest|biggest|highest|top|most)\b/.test(q) && sortable.includes("amount")) sortModel = [{ colId: "amount", sort: "desc", type: "default" }];
  else if (/\b(smallest|lowest|least)\b/.test(q) && sortable.includes("amount")) sortModel = [{ colId: "amount", sort: "asc", type: "default" }];
  else if (/\b(latest|recent|newest)\b/.test(q) && sortable.includes("date")) sortModel = [{ colId: "date", sort: "desc", type: "default" }];
  else if (/\b(oldest|earliest|first)\b/.test(q) && sortable.includes("date")) sortModel = [{ colId: "date", sort: "asc", type: "default" }];
  if (features.includes("sort")) gridState.sort = sortModel ? { sortModel } : null;
  if (sortModel) notes.push(`sorted by ${sortModel[0]!.colId === "amount" ? "amount" : "date"}, ${sortModel[0]!.sort === "desc" ? (sortModel[0]!.colId === "amount" ? "largest first" : "newest first") : sortModel[0]!.colId === "amount" ? "smallest first" : "oldest first"}`);

  // ----------------------------------------------------------- aggregation
  const aggItems = itemsOf(props(root.aggregation).aggregationModel);
  const aggCols = (Array.isArray(aggItems.anyOf) ? (aggItems.anyOf as Json[]) : [aggItems]).flatMap((v) => enumOf(props(v).colId));
  if (features.includes("aggregation")) {
    const sums = ["amount", "net"].filter((c) => aggCols.includes(c)).map((colId) => ({ colId, aggFunc: "sum" }));
    gridState.aggregation = sums.length ? { aggregationModel: sums } : null;
  }

  const propertiesToIgnore = features.filter((f) => !(f in gridState));
  const explanation = notes.length
    ? `Showing ${notes.join(" · ")}. (Offline mode: matched with simple rules, not AI.)`
    : "I couldn't match that to the ledger's columns offline, so I reset the view to everything. (Offline mode: simple rules, not AI.)";
  return { gridState, propertiesToIgnore, explanation };
}
