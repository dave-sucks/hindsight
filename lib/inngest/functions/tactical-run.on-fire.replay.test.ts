/**
 * The trigger run's real handler, per fire mode, on production rows (2026-10-22); the model is captured,
 * never called, and the trade tools are the edges. IOT's live floor (stored DIRECT, now DO_IT) still
 * proposes the sale with no run; V's (stored TACTICAL, now ASK_NOW) still asks the analyst; a review set
 * to Send to Agent starts a run; TRV's Auto-buy calls place_trade with the trigger's arguments.
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow } from "@/lib/replay";

const PEAD = "cmnhxpjio000004jvox6kl6c7";
const SECULAR = "cmmqxola3000004lbj7c11bfn";

const IOT_FLOOR = { id: "cf1e7fd0-8bcc-4629-b605-5d1da41735c2", action: "EXIT", fireMode: "DO_IT", predicate: { watch: "price", is: "below", value: 41.42 }, rationale: "Under your hand-set floor at $41.42.", cooldownDays: 0 };
const IOT_TARGET = { id: "56e86f78-7e31-43e0-b9c3-7445cc016c69", action: "REVIEW", fireMode: "NEXT_MORNING", predicate: { watch: "price", is: "above", value: 52 }, rationale: "Using $52 as the objective.", cooldownDays: 1 };
const V_FLOOR = { id: "84f59b07-5ad2-4f6c-882a-83f5ecce81a7", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 395 }, rationale: "Sell if below $395. You set this.", cooldownDays: 1 };
const TRV_BUY = { id: "6e111cb3-34f8-4d89-a2f5-f7ceff7f8f4b", action: "ENTER", fireMode: "DO_IT", predicate: { watch: "price", is: "above", value: 398.7, settings: { close: true } }, rationale: "I buy when it breaks above $398.70.", cooldownDays: 1 };

const stocks = (target: Record<string, unknown> = IOT_TARGET) => ({
  thesis: [
    thesisRow({ id: "iot", ticker: "IOT", status: "HOLDING", direction: "LONG", analystId: PEAD, triggers: [IOT_FLOOR, target] }),
    thesisRow({ id: "v", ticker: "V", status: "HOLDING", direction: "LONG", analystId: SECULAR, triggers: [V_FLOOR] }),
    thesisRow({ id: "trv", ticker: "TRV", status: "WATCHING", direction: "LONG", analystId: SECULAR, triggers: [TRV_BUY] }),
  ],
  position: [
    positionRow({ id: "pos_iot", symbol: "IOT", analystId: PEAD, environment: "LIVE", quantity: 300, avgCost: 42.695 }),
    positionRow({ id: "pos_v", symbol: "V", analystId: SECULAR, environment: "LIVE", quantity: 27, avgCost: 369.25 }),
  ],
  agentConfig: [
    agentConfigRow({ id: PEAD, name: "PEAD Specialist", tradingEnvironment: "LIVE", maxOpenPositions: 6 }),
    agentConfigRow({ id: SECULAR, name: "Secular Compounder", tradingEnvironment: "LIVE", maxOpenPositions: 10 }),
  ],
  account: [accountRow({ requireApprovalBuysLive: true, requireApprovalSellsLive: true })],
});

/** One fire through the handler: whether the model was reached, the sale the no-agent path proposed, and the trade tool it called. */
async function fire(data: { thesisId: string; triggerId: string; analystId: string; ticker: string; action: string; firedPrice: number }, seed = stocks()) {
  const db = prismaDouble(seed);
  let modelCalls = 0;
  const closes: unknown[][] = [];
  const toolCalls: Array<{ tool: string; args: unknown; ctx: Record<string, unknown> }> = [];
  let returned: unknown;
  await jest.isolateModulesAsync(async () => {
    let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
    jest.doMock("ai", () => ({ generateText: jest.fn(async () => ((modelCalls += 1), { steps: [], response: { messages: [] }, text: "" })), stepCountIs: () => () => false }));
    jest.doMock("@ai-sdk/openai", () => ({ openai: () => ({}) }));
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
    jest.doMock("@/lib/actions/closeTrade.actions", () => ({ closeOpenPosition: jest.fn(async (...a: unknown[]) => (closes.push(a), { kind: "proposed" })) }));
    jest.doMock("@/lib/proposals/held-through-context", () => ({ heldThroughNoteForPosition: async () => null }));
    jest.doMock("@/lib/trading/manual-order", () => ({ accountCash: async () => 50_000 }));
    jest.doMock("@/lib/agent/tools", () => ({
      createResearchTools: (ctx: Record<string, unknown>) => {
        const tool = (name: string) => ({ execute: jest.fn(async (args: unknown) => (toolCalls.push({ tool: name, args, ctx }), { ok: true, summary: "Proposed" })) });
        return { place_trade: tool("place_trade"), manage_position: tool("manage_position"), get_theses: { execute: async () => ({ ok: false }) } };
      },
    }));
    await import("@/lib/inngest/functions/tactical-run");
    returned = await handler!({
      event: { data },
      step: { run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)), sendEvent: jest.fn() },
    });
  });
  for (const m of ["ai", "@ai-sdk/openai", "@/lib/agent/tools", "@/lib/actions/api-keys.actions", "@/lib/actions/closeTrade.actions", "@/lib/proposals/held-through-context", "@/lib/trading/manual-order", "@/lib/inngest/client", "@/lib/prisma"]) jest.dontMock(m);
  return { returned, modelCalls, closes, toolCalls, runs: (db.store.researchRun ?? []) as Array<Record<string, unknown>> };
}

describe("the trigger run, by fire mode", () => {
  it("IOT's live floor (stored DIRECT, now DO_IT) proposes the sale with no analyst run", async () => {
    const r = await fire({ thesisId: "iot", triggerId: IOT_FLOOR.id, analystId: PEAD, ticker: "IOT", action: "EXIT", firedPrice: 41.3 });
    expect(r.modelCalls).toBe(0);
    expect(r.closes).toHaveLength(1);
    expect(r.closes[0].slice(0, 2)).toEqual(["pos_iot", "STOP"]);
    // The sale says which trigger sold it, then the trigger's own reason.
    expect(r.closes[0][4]).toBe('"Sell if below $41.42" fired, with no agent run. Under your hand-set floor at $41.42.');
    expect(r.runs[0]).toMatchObject({ status: "COMPLETE" });
  });

  it("V's live floor (stored TACTICAL, now ASK_NOW) still asks the analyst", async () => {
    const r = await fire({ thesisId: "v", triggerId: V_FLOOR.id, analystId: SECULAR, ticker: "V", action: "EXIT", firedPrice: 394.5 });
    expect(r.modelCalls).toBeGreaterThan(0);
    expect(r.closes).toHaveLength(0);
  });

  it("a review set to Send to Agent starts a trigger run", async () => {
    const asked = { ...IOT_TARGET, fireMode: "ASK_NOW" };
    const r = await fire({ thesisId: "iot", triggerId: asked.id, analystId: PEAD, ticker: "IOT", action: "REVIEW", firedPrice: 52.4 }, stocks(asked));
    expect(r.modelCalls).toBeGreaterThan(0);
  });

  it("TRV's Auto-buy calls place_trade with the trigger's arguments, paid from cash, and no model", async () => {
    const r = await fire({ thesisId: "trv", triggerId: TRV_BUY.id, analystId: SECULAR, ticker: "TRV", action: "ENTER", firedPrice: 398.95 });
    expect(r.modelCalls).toBe(0);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]).toMatchObject({ tool: "place_trade", args: { ticker: "TRV", direction: "LONG", entry_price: 398.95, thesis_id: "trv" }, ctx: { payFromCash: 50_000, runMode: "INTRADAY_TACTICAL", analystId: SECULAR } });
    expect(r.runs[0]).toMatchObject({ status: "COMPLETE" });
  });
});
