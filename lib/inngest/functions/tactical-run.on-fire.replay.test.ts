/**
 * The trigger run's real handler, per fire mode, on production rows (2026-10-22); the model is captured,
 * never called, and the trade tools are the edges. IOT's live floor (Auto) proposes the sale, then the
 * same run writes it up with no trade tools and its note replaces the sale's line (2026-10-28: PLTR's
 * Auto-sell card read a template stitched from the trigger's old note and "Third ask… move the line").
 * V's floor (Send to Agent) asks the analyst; a review set to Send to Agent starts a run; TRV's
 * Auto-buy calls place_trade with the trigger's arguments, then the write-up's note is the buy's whole reason.
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow } from "@/lib/replay";

const PEAD = "cmnhxpjio000004jvox6kl6c7";
const SECULAR = "cmmqxola3000004lbj7c11bfn";

const IOT_FLOOR = { id: "cf1e7fd0-8bcc-4629-b605-5d1da41735c2", action: "EXIT", fireMode: "DO_IT", predicate: { watch: "price", is: "below", value: 41.42 }, rationale: "Under your hand-set floor at $41.42.", cooldownDays: 0 };
const IOT_TARGET = { id: "56e86f78-7e31-43e0-b9c3-7445cc016c69", action: "REVIEW", fireMode: "NEXT_MORNING", predicate: { watch: "price", is: "above", value: 52 }, rationale: "Using $52 as the objective.", cooldownDays: 1 };
const V_FLOOR = { id: "84f59b07-5ad2-4f6c-882a-83f5ecce81a7", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 395 }, rationale: "Sell if below $395. You set this.", cooldownDays: 1 };
const TRV_BUY = { id: "6e111cb3-34f8-4d89-a2f5-f7ceff7f8f4b", action: "ENTER", fireMode: "DO_IT", predicate: { watch: "price", is: "above", value: 398.7, settings: { close: true } }, rationale: "I buy when it breaks above $398.70.", cooldownDays: 1 };

const IOT_LINE = 'Your "Sell if below $41.42" came true. It\'s set to Auto-sell.';
const NOTE = "Samsara fell 4% on Oct 22 with software stocks after a weak guide from a peer; nothing in its own news. You own 300 shares at $42.70. Your Auto-sell at $41.42 was hit, so the sale is waiting for you; I'd hold, since nothing that would break the case has happened.";

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

type Asked = { system: string; prompt: string; tools: string[] };

/** One fire through the handler: what the model was asked, the sale and trade calls, and the rows left behind. */
async function fire(data: { thesisId: string; triggerId: string; analystId: string; ticker: string; action: string; firedPrice: number }, seed = stocks()) {
  const db = prismaDouble(seed);
  const create = (m: string, data: Record<string, unknown>) => (db as unknown as Record<string, { create: (a: unknown) => Promise<unknown> }>)[m].create({ data });
  const asked: Asked[] = [];
  const closes: unknown[][] = [];
  const sent: Array<{ name: string; data: unknown }> = [];
  const toolCalls: Array<{ tool: string; args: unknown; ctx: Record<string, unknown> }> = [];
  await jest.isolateModulesAsync(async () => {
    let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({
      inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn(async (e: { name: string; data: unknown }) => sent.push(e)) },
    }));
    // The model writes its note the way update_thesis would: one row on the stock for this run.
    jest.doMock("ai", () => ({
      generateText: jest.fn(async (a: { system: string; prompt: string; tools: Record<string, unknown> }) => {
        asked.push({ system: a.system, prompt: a.prompt, tools: Object.keys(a.tools ?? {}) });
        const run = (db.store.researchRun as Array<{ id: string }>)[0];
        await create("thesisUpdate", { thesisId: data.thesisId, type: "REVIEWED", summary: "Reviewed", rationale: NOTE, runId: run.id, timestamp: new Date() });
        return { steps: [], response: { messages: [] }, text: "" };
      }),
      stepCountIs: () => () => false,
    }));
    jest.doMock("@ai-sdk/openai", () => ({ openai: () => ({}) }));
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
    jest.doMock("@/lib/actions/closeTrade.actions", () => ({
      closeOpenPosition: jest.fn(async (...a: unknown[]) => {
        closes.push(a);
        await create("order", { id: "ord_iot", positionId: a[0], symbol: "IOT", thesisId: data.thesisId, rationale: a[4], status: "AWAITING_APPROVAL", createdAt: new Date(), position: { analystId: data.analystId, symbol: "IOT" } });
        return { kind: "proposed", proposal: { orderId: "ord_iot" } };
      }),
    }));
    jest.doMock("@/lib/trading/manual-order", () => ({ accountCash: async () => 50_000 }));
    jest.doMock("@/lib/agent/tools", () => ({
      createResearchTools: (ctx: Record<string, unknown>) => {
        // A buy stages its order with the reason it was given (its sizing goes to the reply, never the reason).
        const tool = (name: string) => ({
          execute: jest.fn(async (args: { entry_rationale?: string }) => {
            toolCalls.push({ tool: name, args, ctx });
            if (name === "place_trade") {
              await create("order", { id: "ord_trv", positionId: "pos_trv", symbol: "TRV", thesisId: "trv", intent: "OPEN", rationale: args.entry_rationale, status: "AWAITING_APPROVAL", createdAt: new Date(), position: { analystId: SECULAR, symbol: "TRV" } });
            }
            // A trim waiting for approval: manage_position writes no decision row until it fills.
            if (name === "manage_position") {
              const a = args as { reason?: string };
              await create("order", { id: "ord_iot_trim", positionId: "pos_iot", symbol: "IOT", thesisId: "iot", intent: "PARTIAL_CLOSE", rationale: a.reason, status: "AWAITING_APPROVAL", createdAt: new Date(), position: { analystId: PEAD, symbol: "IOT" } });
            }
            return { ok: true, summary: name === "place_trade" ? "Proposed: LONG 27 $TRV" : "Partial close proposed: IOT (-30%)" };
          }),
        });
        return { place_trade: tool("place_trade"), manage_position: tool("manage_position"), close_position: tool("close_position"), get_theses: { execute: async () => ({ ok: false }) } };
      },
    }));
    await import("@/lib/inngest/functions/tactical-run");
    await handler!({
      event: { data },
      step: { run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)), sendEvent: jest.fn() },
    });
  });
  for (const m of ["ai", "@ai-sdk/openai", "@/lib/agent/tools", "@/lib/actions/api-keys.actions", "@/lib/actions/closeTrade.actions", "@/lib/trading/manual-order", "@/lib/inngest/client", "@/lib/prisma"]) jest.dontMock(m);
  const rows = (m: string) => (db.store as Record<string, Array<Record<string, unknown>>>)[m] ?? [];
  return { asked, closes, sent, toolCalls, runs: rows("researchRun"), orders: rows("order"), updates: rows("thesisUpdate") };
}

const IOT_TRIM = { id: "7a1c2b3d-0000-4000-8000-000000000001", action: "TRIM", fireMode: "DO_IT", trimPct: 30, predicate: { watch: "price", is: "above", value: 48 }, rationale: "Take some off into strength.", cooldownDays: 1 };

describe("the trigger run, by fire mode", () => {
  it("IOT's Auto-trim with approval on: the trim waits for approval, and the write-up still lands on it (it has no decision row yet)", async () => {
    const r = await fire({ thesisId: "iot", triggerId: IOT_TRIM.id, analystId: PEAD, ticker: "IOT", action: "TRIM", firedPrice: 48.2 }, stocks(IOT_TRIM));
    expect(r.toolCalls).toEqual([expect.objectContaining({ tool: "manage_position", args: expect.objectContaining({ action: "partial_close", close_pct: 30 }) })]);
    expect(r.asked).toHaveLength(1);
    expect(r.orders.find((o) => o.id === "ord_iot_trim")?.rationale).toBe(NOTE);
    expect(r.sent).toContainEqual({ name: "app/proposal.note.written", data: { orderId: "ord_iot_trim" } });
  });

  it("IOT's Auto-sell: the sale is proposed with one plain line, then the run writes it up with no trade tools and its note replaces the line", async () => {
    const r = await fire({ thesisId: "iot", triggerId: IOT_FLOOR.id, analystId: PEAD, ticker: "IOT", action: "EXIT", firedPrice: 41.3 });
    expect(r.closes).toHaveLength(1);
    expect(r.closes[0].slice(0, 2)).toEqual(["pos_iot", "STOP"]);
    expect(r.closes[0][4]).toBe(IOT_LINE);
    // The run row says a write-up is coming, so the card and the email wait for it.
    expect(r.runs[0]).toMatchObject({ status: "COMPLETE", parameters: expect.objectContaining({ autoTrade: true }) });
    // One write-up: no trade tools, the auto-trade situation, the job is the note.
    expect(r.asked).toHaveLength(1);
    expect(r.asked[0].tools).not.toEqual(expect.arrayContaining(["place_trade"]));
    expect(r.asked[0].tools.some((t) => ["place_trade", "close_position", "manage_position"].includes(t))).toBe(false);
    expect(r.asked[0].system).toContain("THE WRITE-UP");
    expect(r.asked[0].system).toContain("AUTO_TRADE — auto trade made");
    expect(r.asked[0].system).not.toContain("DECISION FRAMEWORK");
    expect(r.asked[0].prompt).toContain("The sale of all 300 shares is proposed and waits for the principal's approval.");
    // The card and the email read the analyst's note, and the email is told it's there.
    expect(r.orders.find((o) => o.id === "ord_iot")?.rationale).toBe(NOTE);
    expect(r.sent).toContainEqual({ name: "app/proposal.note.written", data: { orderId: "ord_iot" } });
    // The fire's own row carries what fired, never the trigger's old note.
    const fireRow = r.updates.find((u) => u.type === "TRIGGER_FIRED");
    expect(fireRow).toMatchObject({ summary: "Sell if below $41.42" });
    expect(fireRow?.rationale ?? null).toBeNull();
  });

  it("V's floor (Send to Agent) asks the analyst, with the trade tools and no write-up", async () => {
    const r = await fire({ thesisId: "v", triggerId: V_FLOOR.id, analystId: SECULAR, ticker: "V", action: "EXIT", firedPrice: 394.5 });
    expect(r.closes).toHaveLength(0);
    expect(r.asked).toHaveLength(1);
    expect(r.asked[0].tools).toEqual(expect.arrayContaining(["close_position"]));
    expect(r.asked[0].system).toContain("DECISION FRAMEWORK");
    expect(r.runs[0].parameters).not.toHaveProperty("autoTrade");
    // A default note ("Sell if below $395. You set this.") restates the trigger: the run isn't shown it.
    expect(r.asked[0].system).not.toContain("You set this.");
  });

  it("a review set to Send to Agent starts a trigger run", async () => {
    const asked = { ...IOT_TARGET, fireMode: "ASK_NOW" };
    const r = await fire({ thesisId: "iot", triggerId: asked.id, analystId: PEAD, ticker: "IOT", action: "REVIEW", firedPrice: 52.4 }, stocks(asked));
    expect(r.asked).toHaveLength(1);
    expect(r.asked[0].system).toContain('its note: "Using $52 as the objective."');
  });

  it("TRV's Auto-buy calls place_trade with the trigger's arguments, paid from cash; the write-up's note is the proposal's whole reason", async () => {
    const r = await fire({ thesisId: "trv", triggerId: TRV_BUY.id, analystId: SECULAR, ticker: "TRV", action: "ENTER", firedPrice: 398.95 });
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]).toMatchObject({ tool: "place_trade", args: { ticker: "TRV", direction: "LONG", entry_price: 398.95, thesis_id: "trv" }, ctx: { payFromCash: 50_000, runMode: "INTRADAY_TACTICAL", analystId: SECULAR } });
    expect((r.toolCalls[0].args as { entry_rationale: string }).entry_rationale).toMatch(/^Your ".+" came true\. It's set to Auto-buy\.$/);
    expect(r.asked).toHaveLength(1);
    expect(r.asked[0].prompt).toContain("Proposed: LONG 27 $TRV.");
    expect(r.orders.find((o) => o.id === "ord_trv")?.rationale).toBe(NOTE);
    // The note row is stamped with the order it wrote up, so the feed shows them as one line.
    expect(r.updates.find((u) => u.rationale === NOTE)?.tradeId).toBe("ord_trv");
    expect(r.runs[0]).toMatchObject({ status: "COMPLETE" });
  });
});
