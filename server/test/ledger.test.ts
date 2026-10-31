import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClaudeAi } from "../src/ai/claude.js";
import { heuristicGridQuery } from "../src/ai/grid-heuristic.js";
import { toStrictSchema } from "../src/ai/strict-schema.js";
import { funds } from "../src/db/schema.js";
import { availableCents } from "../src/domain/ledger.js";
import { makeApp, staffToken, type TestCtx } from "./helpers.js";

/** Captured from the real Ledger grid: `api.getStructuredSchema()` (AG Grid AI Toolkit). */
const schema = JSON.parse(readFileSync(new URL("./fixtures/ag-grid-ledger-schema.json", import.meta.url), "utf8"));
const today = "2026-10-11";
type Json = Record<string, any>;

describe("treasurer Ledger", () => {
  let ctx: TestCtx;
  let token: string;
  beforeAll(async () => {
    ctx = await makeApp();
    token = await staffToken(ctx.app, "reviewer");
  });
  afterAll(async () => ctx.close());

  it("lists every money movement and reconciles to each fund's balance", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/api/staff/ledger" })).statusCode).toBe(401);
    const res = await ctx.app.inject({ method: "GET", url: "/api/staff/ledger", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Json[];
    expect(rows.length).toBeGreaterThan(40);

    for (const f of await ctx.s.db.select().from(funds)) {
      const net = rows.filter((r) => r.fund === f.name).reduce((sum, r) => sum + Math.round(r.net * 100), 0);
      expect(net).toBe(await availableCents(ctx.s.db, f.id));
    }
    for (const r of rows) {
      expect(r.amount).toBeGreaterThanOrEqual(0);
      expect(r.direction === "In" ? r.net >= 0 : r.net <= 0).toBe(true);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const grant = rows.find((r) => r.type === "Grant")!;
    expect(grant.caseRef).toMatch(/^TDO-/);
    expect(grant.party).toBe(`Applicant (${grant.caseRef})`);
    expect(grant.paypalId).toBeTruthy();
    expect(rows.filter((r) => r.type === "Donation" && r.channel === "AI agent").length).toBe(2);
    expect(new Set(rows.map((r) => r.month)).size).toBeGreaterThan(1); // seeded history spans months
  });

  it("answers questions offline with grid state inside the AG Grid schema", async () => {
    const ask = async (question: string) => {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/staff/ledger/ask",
        headers: { authorization: `Bearer ${token}` },
        payload: { question, schema, state: {} },
      });
      expect(res.statusCode).toBe(200);
      return res.json() as { gridState: Json; propertiesToIgnore: string[]; explanation: string; mode: string };
    };

    const byCategory = await ask("Total grants by category this month");
    expect(byCategory.mode).toBe("heuristic");
    expect(byCategory.gridState.rowGroup).toEqual({ groupColIds: ["category"] });
    expect(byCategory.gridState.filter.filterModel.type).toEqual({ filterType: "set", values: ["Grant"] });
    expect(byCategory.gridState.filter.filterModel.date.conditions[0]).toMatchObject({ type: "greaterThan", dateFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2} 00:00:00$/) });
    expect(byCategory.gridState.aggregation.aggregationModel).toEqual([
      { colId: "amount", aggFunc: "sum" },
      { colId: "net", aggFunc: "sum" },
    ]);
    expect(byCategory.propertiesToIgnore).toEqual(expect.arrayContaining(["pivot", "columnVisibility"]));

    // The console's suggestion chip has no date range, so it never goes stale.
    const allTime = await ask("Total grants by category");
    expect(allTime.gridState.rowGroup).toEqual({ groupColIds: ["category"] });
    expect(allTime.gridState.filter.filterModel.type).toEqual({ filterType: "set", values: ["Grant"] });
    expect(allTime.gridState.filter.filterModel.date ?? null).toBeNull();

    const agents = await ask("Donations that came through AI agents");
    expect(agents.gridState.filter.filterModel).toMatchObject({
      type: { filterType: "set", values: ["Donation"] },
      channel: { filterType: "set", values: ["AI agent"] },
    });
    expect(agents.gridState.rowGroup).toBeNull();

    const big = await ask("Grants over $200, largest first");
    expect(big.gridState.filter.filterModel.amount).toEqual({
      filterType: "number",
      operator: "AND",
      conditions: [{ filterType: "number", type: "greaterThan", filter: 200, filterTo: null }],
    });
    expect(big.gridState.sort).toEqual({ sortModel: [{ colId: "amount", sort: "desc", type: "default" }] });

    const monthly = await ask("Money in and out by month");
    expect(monthly.gridState.rowGroup).toEqual({ groupColIds: ["month", "direction"] });

    const fees = await ask("PayPal fees by fund");
    expect(fees.gridState.rowGroup).toEqual({ groupColIds: ["fund"] });
    expect(fees.gridState.filter.filterModel.type.values.sort()).toEqual(["PayPal fee (donation)", "PayPal fee (payout)"]);

    // Every set-filter value the rules produce is one the grid offered.
    for (const answer of [byCategory, agents, big, monthly, fees]) {
      for (const [col, model] of Object.entries((answer.gridState.filter?.filterModel ?? {}) as Json)) {
        if (model.filterType !== "set") continue;
        const allowed = schema.properties.filter.properties.filterModel.properties[col].properties.values.items.enum;
        for (const v of model.values) expect(allowed).toContain(v);
      }
    }
  });
});

describe("AG Grid schema → Claude structured outputs", () => {
  it("produces a schema the structured-output compiler accepts", () => {
    const strict = toStrictSchema(schema);
    const walk = (node: Json, path: string) => {
      expect(Array.isArray(node.type), `${path}: type array`).toBe(false);
      for (const k of ["pattern", "maxItems", "minimum", "maximum", "minLength", "maxLength"]) expect(node[k], `${path}.${k}`).toBeUndefined();
      if (node.minItems !== undefined) expect([0, 1]).toContain(node.minItems);
      if (node.type === "object") {
        expect(node.additionalProperties, path).toBe(false);
        expect(node.required, path).toEqual(Object.keys(node.properties));
        for (const [k, v] of Object.entries(node.properties as Json)) walk(v, `${path}.${k}`);
      }
      if (node.items) walk(node.items, `${path}[]`);
      for (const v of (node.anyOf ?? []) as Json[]) walk(v, `${path}|`);
    };
    walk(strict, "$");
    // Constraints the API can't enforce stay visible to the model.
    expect(JSON.stringify(strict)).toContain("pattern:");
  });

  /** Messages API stand-in: records requests, replays canned responses. */
  function fakeApi(responses: Array<(body: Json) => Response>) {
    const bodies: Json[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return responses.shift()!(body);
    }) as typeof fetch;
    return { fetchImpl, bodies };
  }
  const message = (content: unknown[], stop = "end_turn") =>
    new Response(
      JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const answer = {
    explanation: "Grants this month, grouped by category with totals.",
    propertiesToIgnore: ["columnVisibility", "bogus"],
    gridState: { rowGroup: { groupColIds: ["category"] }, sort: null, unknownFeature: { x: 1 } },
  };

  it("asks Claude with the grid's schema as a structured output", async () => {
    const api = fakeApi([() => message([{ type: "text", text: JSON.stringify(answer) }])]);
    const ai = new ClaudeAi({ apiKey: "test", baseUrl: "https://api.test", fetch: api.fetchImpl }, "claude-opus-5-5");
    const result = await ai.gridQuery({ question: "Total grants by category this month", schema, state: {}, today });

    const req = api.bodies[0]!;
    expect(req.output_config.format.type).toBe("json_schema");
    const sent = req.output_config.format.schema;
    expect(sent.required).toEqual(["explanation", "propertiesToIgnore", "gridState"]);
    expect(sent.properties.gridState.properties.rowGroup.anyOf).toBeDefined(); // ["object","null"] → anyOf
    expect(req.messages[0].content).toContain(`Today is ${today}`);
    expect(req.messages[0].content).toContain("<question>Total grants by category this month</question>");

    expect(result).toEqual({
      explanation: answer.explanation,
      propertiesToIgnore: ["columnVisibility"],
      gridState: { rowGroup: { groupColIds: ["category"] }, sort: null },
    });
  });

  it("falls back to a tool call when the schema can't be compiled", async () => {
    const api = fakeApi([
      () =>
        new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Schema is too complex" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      (body) => {
        expect(body.tools[0].name).toBe("set_grid_state");
        expect(body.tools[0].input_schema.properties.gridState).toEqual(schema);
        expect(body.tool_choice).toBeUndefined(); // forced tool use isn't allowed on this model
        return message([{ type: "tool_use", id: "toolu_1", name: "set_grid_state", input: answer }], "tool_use");
      },
    ]);
    const ai = new ClaudeAi({ apiKey: "test", baseUrl: "https://api.test", fetch: api.fetchImpl }, "claude-opus-5-5");
    const result = await ai.gridQuery({ question: "Total grants by category", schema, state: {}, today });
    expect(api.bodies).toHaveLength(2);
    expect(result.gridState).toEqual({ rowGroup: { groupColIds: ["category"] }, sort: null });
  });
});

describe("offline rules stay inside the schema", () => {
  it("only groups by columns the grid allows", () => {
    const r = heuristicGridQuery({ question: "totals by donor and by status", schema, state: {}, today });
    expect(r.gridState.rowGroup).toEqual({ groupColIds: ["party", "status"] });
  });
});
