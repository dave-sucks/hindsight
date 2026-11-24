/**
 * A trade a trigger led to uses it up, like a filled order (2026-11-17): the trim fires once, its proposal waits
 * with the trigger still on the stock, and when the trim's order fills the trigger comes off with one Activity
 * line. MU as held 2026-10-22 (Secular Compounder, 11 shares at $911.415), with its real "Trim if above $1090"
 * set Auto at 30%. The evaluator, the trigger run and the fill are the real handlers on one database double; the
 * trade tool is the edge.
 *
 * A fill takes off only triggers of its own action (2026-11-17 fix round): CEG's "Sell if below $280" (as stored,
 * fired 11-17 at 10:35 ET; 51 shares at $282.01) answered by a trim stays on the stock. A trim made outside a
 * trigger run (the morning run's, no triggerIds) uses up the stock's own trim that fired and hasn't been found
 * false at a close since.
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_ACCOUNT_ID, type PrismaDouble } from "@/lib/replay";
import { endedFailed } from "@/lib/replay/ended-failed";

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const MU = "cmv9nm3xo000o06l3om8r7ath";
const TRIM = { id: "18b08c22-febd-434c-b8b6-bd6f7b2b94a6", action: "TRIM", fireMode: "DO_IT", trimPct: 30, source: "PRINCIPAL", predicate: { watch: "price", is: "above", value: 1090 }, rationale: "Trim into strength as $MU approaches the upper end of the current target path."};
const FLOOR = { id: "ba421f37-1a10-4fbd-aba8-cafc161c2c6e", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 850 }, rationale: "$850 as the catastrophe line."};

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
    jest.doMock("@/lib/agent/model", () => ({ modelFor: () => ({}) }));
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
    jest.doMock("@/lib/agent/tools", () => ({
      createResearchTools: () => ({ sell: { execute: async (args: unknown) => (calls.push({ tool: "sell", args }), { ok: true, summary: "Partial close proposed: MU (-30%)" }) } }),
    }));
    await import("@/lib/inngest/functions/tactical-run");
    await handler!({ event: { data }, step: { run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)), sendEvent: jest.fn() } }).catch(endedFailed);
  });
  for (const m of ["ai", "@/lib/agent/model", "@/lib/agent/tools", "@/lib/actions/api-keys.actions", "@/lib/inngest/client", "@/lib/prisma"]) jest.dontMock(m);
  return { calls, modelCalls };
}

const muBook = () =>
  prismaDouble({
    thesis: [thesisRow({ id: MU, ticker: "MU", status: "HOLDING", direction: "LONG", horizon: "COMPOUNDER", entryPrice: 911.415, targetPrice: 1500, stopLoss: 850, triggers: [FLOOR, TRIM], researchRun: { agentConfigId: SECULAR, agentConfig: { name: "Secular Compounder", setupIds: [], enabled: true } } })],
    position: [positionRow({ id: "cmv9o0nhe000006lbmypszfe7", symbol: "MU", analystId: SECULAR, environment: "LIVE", quantity: 11, avgCost: 911.415, peakPrice: 1102 })],
    agentConfig: [agentConfigRow({ id: SECULAR, name: "Secular Compounder", accountId: REPLAY_ACCOUNT_ID, tradingEnvironment: "LIVE", triggers: [], enabled: true })],
    account: [accountRow({ triggers: [], requireApprovalSellsLive: true })],
  });

/** The trim's proposal, approved and sent (as approveProposal leaves it), then filled by the reconcile job. */
async function fill(db: PrismaDouble, at: Date, over: Record<string, unknown> = {}, price = 1095.5) {
  const row = { id: "mu_trim", userId: "u", environment: "LIVE", positionId: "cmv9o0nhe000006lbmypszfe7", symbol: "MU", side: "SELL", quantity: 3, alpacaOrderId: "a1", idempotencyKey: "k1", intent: "PARTIAL_CLOSE", closeReason: null, closeSource: "agent", status: "PENDING", thesisId: MU, triggerIds: [TRIM.id], createdAt: at, ...over };
  db.store.order = [...((db.store.order ?? []) as Array<Record<string, unknown>>), row];
  const order = (db.store.order as Array<Record<string, unknown>>).find((o) => o.id === row.id)!;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: () => ({}), send: jest.fn() } }));
    const { __test__ } = await import("@/lib/inngest/functions/reconcile-orders");
    await __test__.applyFillByIntent(order as never, price, Number(row.quantity), at);
  });
  jest.dontMock("@/lib/prisma");
  jest.dontMock("@/lib/inngest/client");
}

describe("MU: the Auto-trim fires once, and its fill uses it up", () => {
  it("fires, trims 30% with no agent deciding (then one write-up); the trigger stays while the trim waits, and the next day's pass fires nothing", async () => {
    const db = muBook();
    const fired = await pass(db, new Date("2026-10-22T15:00:00Z"), 1095);
    expect(fired.map((e) => e.triggerId)).toEqual([TRIM.id]);

    const run = await triggerRun(db, fired[0]);
    expect(run.modelCalls).toBe(1);
    expect(run.calls).toEqual([{ tool: "sell", args: expect.objectContaining({ ticker: "MU", percent: 30 }) }]);
    // Proposed, not filled: nothing is used up.
    expect((db.store.thesis[0] as { triggers: Array<{ id: string }> }).triggers.map((t) => t.id)).toEqual([FLOOR.id, TRIM.id]);

    // A day later, the price still above $1090: no close has found it false, so it doesn't fire again.
    expect(await pass(db, new Date("2026-10-23T15:00:00Z"), 1096)).toEqual([]);
  });

  it("when the trim fills, the trigger comes off the stock with one line", async () => {
    const db = muBook();
    await triggerRun(db, (await pass(db, new Date("2026-10-22T15:00:00Z"), 1095))[0]);
    await fill(db, new Date("2026-10-22T15:10:00Z"));
    expect((db.store.thesis[0] as { triggers: Array<{ id: string }> }).triggers.map((t) => t.id)).toEqual([FLOOR.id]);
    const lines = (db.store.thesisUpdate as Array<{ type: string; summary: string }>).filter((u) => u.type === "UPDATED").map((u) => u.summary);
    expect(lines).toEqual(["Its order filled, so it came off: Trim 30% if above $1090"]);
  });
});

describe("a fill takes off only triggers of its own action", () => {
  const CEG = "cmqb2ku1a000q04l6jtquuqr6";
  const CEG_FLOOR = { id: "cafcc57b-4b0c-47ee-b2c2-d4cd6e0b942e", action: "EXIT", source: "PRINCIPAL", fireMode: "ASK_NOW", predicate: { is: "below", value: 280, watch: "price" }, lastFiredAt: "2026-11-17T14:35:01.542Z", rationale: "(as set)" };
  const cegBook = () =>
    prismaDouble({
      thesis: [thesisRow({ id: CEG, ticker: "CEG", status: "HOLDING", direction: "LONG", horizon: "COMPOUNDER", triggers: [CEG_FLOOR], researchRun: { agentConfigId: SECULAR, agentConfig: { name: "Secular Compounder", setupIds: [], enabled: true } } })],
      position: [positionRow({ id: "cmsrk43d7000604jxyc6s7u4r", symbol: "CEG", analystId: SECULAR, environment: "LIVE", quantity: 51, avgCost: 282.006094117647, peakPrice: 308.075 })],
      agentConfig: [agentConfigRow({ id: SECULAR, name: "Secular Compounder", accountId: REPLAY_ACCOUNT_ID, tradingEnvironment: "LIVE", triggers: [], enabled: true })],
      account: [accountRow({ triggers: [], requireApprovalSellsLive: true })],
    });

  it("CEG: a trim answering the $280 floor's fire fills, and the floor stays", async () => {
    const db = cegBook();
    await fill(db, new Date("2026-11-17T15:10:00Z"), { id: "ceg_trim", positionId: "cmsrk43d7000604jxyc6s7u4r", symbol: "CEG", quantity: 25, thesisId: CEG, triggerIds: [CEG_FLOOR.id] }, 272.1);
    expect((db.store.thesis[0] as { triggers: Array<{ id: string }> }).triggers.map((t) => t.id)).toEqual([CEG_FLOOR.id]);
    expect(((db.store.thesisUpdate ?? []) as Array<{ summary: string }>).filter((u) => /came off/.test(u.summary))).toEqual([]);
  });

  it("MU: the morning run's trim (no triggerIds) uses up the trim that fired; the floor and a trim that hasn't fired stay", async () => {
    const db = muBook();
    const fresh = { ...TRIM, id: "trim-not-fired", predicate: { watch: "price", is: "above", value: 1200 } };
    (db.store.thesis[0] as { triggers: unknown[] }).triggers = [FLOOR, { ...TRIM, lastFiredAt: "2026-10-22T15:00:00.000Z" }, fresh];
    await fill(db, new Date("2026-10-23T14:10:00Z"), { id: "mu_morning_trim", triggerIds: [] });
    expect((db.store.thesis[0] as { triggers: Array<{ id: string }> }).triggers.map((t) => t.id)).toEqual([FLOOR.id, "trim-not-fired"]);
    const lines = (db.store.thesisUpdate as Array<{ type: string; summary: string }>).filter((u) => u.type === "UPDATED").map((u) => u.summary);
    expect(lines).toEqual(["Its order filled, so it came off: Trim 30% if above $1090"]);
  });
});
