/**
 * An Auto-trim is a one-time order: it fires, the trim is tried, and the trigger comes off the stock with one
 * Activity line, so the next day's pass finds nothing to fire. MU as held 2026-10-22 (Secular Compounder,
 * 11 shares at $911.415), with its real "Trim if above $1090" set Auto at 30%. Both handlers are the real ones on
 * one database double; the trade tool is the edge.
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_ACCOUNT_ID, type PrismaDouble } from "@/lib/replay";

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const MU = "cmv9nm3xo000o06l3om8r7ath";
const TRIM = { id: "18b08c22-febd-434c-b8b6-bd6f7b2b94a6", action: "TRIM", fireMode: "DO_IT", trimPct: 30, source: "PRINCIPAL", predicate: { watch: "price", is: "above", value: 1090 }, rationale: "Trim into strength as $MU approaches the upper end of the current target path.", cooldownDays: 1 };
const FLOOR = { id: "ba421f37-1a10-4fbd-aba8-cafc161c2c6e", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 850 }, rationale: "$850 as the catastrophe line.", cooldownDays: 1 };

const NOT_FAKED = ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] as const;

/** One five-minute pass at `at` with MU at `price`: the fire events it sends. */
async function pass(db: PrismaDouble, at: Date, price: number) {
  const sent: Array<Record<string, unknown>> = [];
  jest.useFakeTimers({ now: at, doNotFake: [...NOT_FAKED] });
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
      jest.doMock("@/lib/agent/research-helpers", () => ({
        finnhub: async (path: string) => (path.startsWith("/quote?symbol=") ? { data: { c: price, pc: price - 1, o: price - 1, dp: 0.1, t: Math.floor(at.getTime() / 1000) } } : { data: null }),
      }));
      jest.doMock("@/lib/alpaca", () => ({ getTodaySessionBars: async () => ({ MU: { close: price, high: price, low: price, volume: 1_000_000 } }) }));
      jest.doMock("@/lib/market-data/ensure-snapshots", () => ({ ensureIndicatorSnapshots: async () => new Map() }));
      jest.doMock("@/lib/agent/triggers/earnings", () => ({ ...jest.requireActual("@/lib/agent/triggers/earnings"), fetchEarningsWindow: async () => ({ reported: new Map(), upcoming: new Map() }) }));
      jest.doMock("@/lib/market-data/sec-filings", () => ({ ...jest.requireActual("@/lib/market-data/sec-filings"), fetchBookFilings: async () => ({ byTicker: new Map() }) }));
      await import("@/lib/inngest/functions/trigger-evaluator");
      await handler!({ step: { run: async (_n: string, fn: () => Promise<unknown>) => fn(), sendEvent: async (_id: string, e: { name: string; data: Record<string, unknown> }) => void sent.push(e.data) } });
    });
  } finally {
    jest.useRealTimers();
  }
  return sent;
}

/** The trigger run's handler for one fire: the trade tool calls it made, and whether it reached the model. */
async function triggerRun(db: PrismaDouble, data: Record<string, unknown>) {
  const calls: Array<{ tool: string; args: unknown }> = [];
  let modelCalls = 0;
  await jest.isolateModulesAsync(async () => {
    let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
    jest.doMock("ai", () => ({ generateText: jest.fn(async () => ((modelCalls += 1), { steps: [], response: { messages: [] }, text: "" })), stepCountIs: () => () => false }));
    jest.doMock("@ai-sdk/openai", () => ({ openai: () => ({}) }));
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
    jest.doMock("@/lib/agent/tools", () => ({
      createResearchTools: () => ({ manage_position: { execute: async (args: unknown) => (calls.push({ tool: "manage_position", args }), { ok: true, summary: "Partial close proposed: MU (-30%)" }) } }),
    }));
    await import("@/lib/inngest/functions/tactical-run");
    await handler!({ event: { data }, step: { run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)), sendEvent: jest.fn() } });
  });
  for (const m of ["ai", "@ai-sdk/openai", "@/lib/agent/tools", "@/lib/actions/api-keys.actions", "@/lib/inngest/client", "@/lib/prisma"]) jest.dontMock(m);
  return { calls, modelCalls };
}

const muBook = () =>
  prismaDouble({
    thesis: [thesisRow({ id: MU, ticker: "MU", status: "HOLDING", direction: "LONG", horizon: "COMPOUNDER", entryPrice: 911.415, targetPrice: 1500, stopLoss: 850, triggers: [FLOOR, TRIM], researchRun: { agentConfigId: SECULAR, agentConfig: { name: "Secular Compounder", setupIds: [], enabled: true } } })],
    position: [positionRow({ id: "cmv9o0nhe000006lbmypszfe7", symbol: "MU", analystId: SECULAR, environment: "LIVE", quantity: 11, avgCost: 911.415, peakPrice: 1102 })],
    agentConfig: [agentConfigRow({ id: SECULAR, name: "Secular Compounder", accountId: REPLAY_ACCOUNT_ID, tradingEnvironment: "LIVE", triggers: [], enabled: true })],
    account: [accountRow({ triggers: [], requireApprovalSellsLive: true })],
  });

describe("MU: an Auto-trim is used once", () => {
  it("left on the stock, it would fire again the next day (the check below means something)", async () => {
    const db = muBook();
    expect((await pass(db, new Date("2026-10-22T15:00:00Z"), 1095)).map((e) => e.triggerId)).toEqual([TRIM.id]);
    expect((await pass(db, new Date("2026-10-23T15:00:00Z"), 1096)).map((e) => e.triggerId)).toEqual([TRIM.id]);
  });

  it("fires, trims 30% with no agent deciding (then one write-up), comes off the stock with one line, and the next day's pass fires nothing", async () => {
    const db = muBook();
    const fired = await pass(db, new Date("2026-10-22T15:00:00Z"), 1095);
    expect(fired.map((e) => e.triggerId)).toEqual([TRIM.id]);

    const run = await triggerRun(db, fired[0]);
    expect(run.modelCalls).toBe(1);
    expect(run.calls).toEqual([{ tool: "manage_position", args: expect.objectContaining({ symbol: "MU", action: "partial_close", close_pct: 30 }) }]);

    const stored = (db.store.thesis[0] as { triggers: Array<{ id: string }> }).triggers.map((t) => t.id);
    expect(stored).toEqual([FLOOR.id]);
    const lines = (db.store.thesisUpdate as Array<{ type: string; summary: string }>).filter((u) => u.type === "UPDATED").map((u) => u.summary);
    expect(lines).toEqual(["Used once: Trim 30% if above $1090 (Auto-trim)"]);

    // A day later, past its one-day rest, the price still above $1090: nothing left to fire.
    expect(await pass(db, new Date("2026-10-23T15:00:00Z"), 1096)).toEqual([]);
  });
});
