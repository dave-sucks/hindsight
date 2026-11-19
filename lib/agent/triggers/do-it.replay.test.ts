/**
 * An Auto trigger trades with no analyst: the trigger run's own trade tool, called with the
 * trigger's arguments (doItCall), through its real entry point. Rows from production, 2026-10-22.
 *
 * TRV (Secular Compounder, watched): "Buy if above $398.70 · only on the close" fired at $398.95 on
 * 2026-10-21; it asked the analyst, who passed. Here it is an Auto-buy.
 * CORT (Catalyst Event PM, watched): a buy at $126.38 and a target, no floor.
 *
 * An Auto-buy names no sale: no one chose one, and a watch's line ends the watch, never sells. Since
 * 2026-11-19 it gets its playbook's floor, priced from the chart then and held to the playbook's sale
 * rules (playbookFloor): TRV's base low, CORT's swing low, each chart as a run read it that week
 * (TRV's 10-21 trigger run, CORT's 10-22 morning run). With none it is refused, and says so.
 * IOT (PEAD Specialist, held 300 @ $42.695, LIVE): an Auto-trim.
 */
import { replayTool, thesisRow, agentConfigRow, accountRow, positionRow, type Replay } from "@/lib/replay";
import { doItCall } from "./do-it";
import type { Trigger } from "./types";

const SECULAR = { id: "cmmqxola3000004lbj7c11bfn", name: "Secular Compounder", minPositionSize: 4000, maxPositionSize: 10000, maxPositionTotal: 20000, maxOpenPositions: 10, riskPct: 1 };
const CATALYST = { id: "cmmmh0wxu000004js7yoyzvlf", name: "Catalyst Event PM", minPositionSize: 3000, maxPositionSize: 8000, maxPositionTotal: 16000, maxOpenPositions: 5, riskPct: 1 };
const PEAD = { id: "cmnhxpjio000004jvox6kl6c7", name: "PEAD Specialist", minPositionSize: 3000, maxPositionSize: 14000, maxPositionTotal: 28000, maxOpenPositions: 6, riskPct: 1 };
const APPROVALS = accountRow({ requireApprovalBuysLive: true, requireApprovalSellsLive: true, requireApprovalBuysPaper: true, requireApprovalSellsPaper: true });

const TRV_BUY: Trigger = { id: "6e111cb3-34f8-4d89-a2f5-f7ceff7f8f4b", action: "ENTER", fireMode: "DO_IT", predicate: { watch: "price", is: "above", value: 398.7, settings: { close: true } }, rationale: "I buy when it breaks above $398.70."};
const TRV = {
  id: "cmum3c72c000h04jp9ztyxxko", ticker: "TRV", status: "WATCHING", direction: "LONG", horizon: "COMPOUNDER", setupId: "BASE_BREAKOUT", conviction: "HIGH", scoring: { composite: 8 },
  entryPrice: 398.7, targetPrice: 431.5, stopLoss: 382.4, analystId: SECULAR.id,
  triggers: [
    TRV_BUY,
    { id: "aaf8dc78-a969-495d-ab0a-6bb95b55fe66", action: "STOP_WATCHING", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 382.4, settings: { close: true } }, rationale: "Under the recent swing-high-turned-support area."},
    { id: "c5b67206-924c-4260-be2a-82918f32bbbd", action: "REVIEW", fireMode: "NEXT_MORNING", predicate: { watch: "price", is: "above", value: 431.5 }, rationale: "The 1.272 extension."},
  ],
};
const CORT = {
  id: "cmuhp4n4e000e04kx3vkxm5lr", ticker: "CORT", status: "WATCHING", direction: "LONG", horizon: "CATALYST", setupId: "PRE_CATALYST", conviction: "HIGH", scoring: { composite: 9 },
  entryPrice: 126.38, targetPrice: 152.11, stopLoss: null, analystId: CATALYST.id,
  triggers: [
    { id: "3e5db9a6-8ba6-46e6-8e00-d237ba4a7e7a", action: "ENTER", fireMode: "DO_IT", predicate: { watch: "price", is: "above", value: 126.38, settings: { close: true } }, rationale: "I buy when it breaks above $126.38."},
    { id: "94477111-596d-44f1-997a-fecd4e35cc90", action: "REVIEW", fireMode: "NEXT_MORNING", predicate: { watch: "price", is: "above", value: 152.11 }, rationale: "The 1.272 extension."},
  ],
};
const IOT_TRIM: Trigger = { id: "trim-test", action: "TRIM", fireMode: "DO_IT", trimPct: 30, predicate: { watch: "price", is: "above", value: 47.47 }, rationale: "Take some at the 52-week high."};
const IOT = {
  id: "cmu062bge000004jtd1aqp304", ticker: "IOT", status: "HOLDING", direction: "LONG", horizon: "TARGET", setupId: "NONE", conviction: "LOW", scoring: { composite: 8 },
  entryPrice: 42.695, targetPrice: 52, stopLoss: 41.42, analystId: PEAD.id,
  triggers: [{ id: "cf1e7fd0-8bcc-4629-b605-5d1da41735c2", action: "EXIT", fireMode: "DO_IT", predicate: { watch: "price", is: "below", value: 41.42 }, rationale: "Under the $41.42 floor."}, IOT_TRIM],
};
const IOT_POSITION = positionRow({ id: "cmv9m90g0000a06l3zv45o24s", symbol: "IOT", analystId: PEAD.id, environment: "LIVE", quantity: 300, initialQty: 300, avgCost: 42.695, peakPrice: 43.62, stopLoss: 41.42, targetPrice: 47 });

/** TRV's chart as its 10-21 trigger run read it, CORT's as the 10-22 morning run read it (get_stock_data), with each one's ATR. */
const CHARTS: Record<string, { chart: Record<string, unknown>; atr: number }> = {
  TRV: { atr: 7.78, chart: { price: 398.95, swings: { lastHigh: { price: 383.99, date: "2026-09-14" }, lastLow: { price: 353.79, date: "2026-10-01" } }, base: { pivot: 398.7, low: 341.52 }, range: { high20: 399.71, low20: 353.79, high52w: 399.71, low52w: 264.25 }, gaps: [{ date: "2026-10-16", direction: "DOWN", pct: -3.62, volumeRatio: 2.56, low: 368.63, mid: 379.77, high: 390.91 }] } },
  CORT: { atr: 4.83, chart: { price: 116.28, swings: { lastHigh: { price: 122.81, date: "2026-10-13" }, lastLow: { price: 108.41, date: "2026-09-18" } }, base: { pivot: 126.38, low: 107.79 }, range: { high20: 122.81, low20: 107.79, high52w: 126.38, low52w: 28.66 }, gaps: [] } },
};

const analystCtx = (a: typeof SECULAR) => ({ analystId: a.id, runMode: "INTRADAY_TACTICAL", runEnvironment: "LIVE", minPositionSize: a.minPositionSize, maxPositionSize: a.maxPositionSize, maxPositionTotal: a.maxPositionTotal, maxOpenPositions: a.maxOpenPositions });

async function buy(stock: typeof TRV, analyst: typeof SECULAR, price: number, extra: Record<string, unknown> = {}, chart: boolean = true): Promise<Replay> {
  const call = doItCall({ trade: "BUY", trigger: stock.triggers[0] as Trigger, thesis: stock, price });
  expect(call.tool).toBe("place_trade");
  const c = CHARTS[stock.ticker];
  return replayTool("place-trade", "placeTrade", {
    seed: { thesis: [thesisRow(stock)], agentConfig: [agentConfigRow({ ...analyst, tradingEnvironment: "LIVE" })], account: [APPROVALS] },
    args: call.args,
    ctx: { ...analystCtx(analyst), ...extra },
    quotes: { [stock.ticker]: price },
    // The chart and ATR the floor is priced from; `chart: false` is a chart that can't be read.
    mocks: {
      "@/lib/proposals/fill-chart": () => ({ loadFillChart: async () => (chart ? c?.chart ?? null : null) }),
      "@/lib/market-data/load-indicators": () => ({ loadIndicatorSnapshots: async () => new Map(c ? [[stock.ticker, { atr14: c.atr }]] : []) }),
    },
  });
}

const orderOf = (r: Replay) => (r.db.store.order ?? [])[0] as Record<string, unknown> | undefined;

describe("TRV: an Auto-buy", () => {
  it("is sized as the analyst's own buy would be, and waits for approval", async () => {
    const doIt = await buy(TRV, SECULAR, 398.95, { payFromCash: 50_000 });
    expect(doIt.crashed).toBe(false);
    expect(doIt.refused).toBe(false);
    expect(doIt.result.data?.status).toBe("PROPOSED");
    // The same call with no cash rule: what the trigger run's place_trade does.
    const agent = await buy(TRV, SECULAR, 398.95);
    expect(orderOf(doIt)?.quantity).toBe(orderOf(agent)?.quantity);
    expect(orderOf(doIt)).toMatchObject({ status: "AWAITING_APPROVAL", intent: "OPEN", thesisId: TRV.id });
    const cost = Number(orderOf(doIt)?.quantity) * 398.95;
    expect(cost).toBeGreaterThanOrEqual(SECULAR.minPositionSize - 398.95);
    expect(cost).toBeLessThanOrEqual(SECULAR.maxPositionSize);
    // The reason is the trigger's line alone (the write-up replaces it); the sizing is in the reply.
    expect(orderOf(doIt)?.rationale).toBe('Your "Buy if above $398.70 · only on the close" came true. It\'s set to Auto-buy.');
    // Its floor is the base breakout's {baseLow}, $341.52 (14.4% under; the 8% cap is a TRADE's), sized by risk to it.
    // The watch's $382.40 line is not the sale, and the floor is the playbook's, so it has no analyst's reason.
    expect(doIt.db.store.position?.[0]).toMatchObject({ stopLoss: 341.52, stopReason: null });
    expect((doIt.result.data?.sizing as string[]).join(" ")).toContain("$57.43 to the stop");
  });

  it("is refused cleanly when the cash doesn't cover it, and nothing is written", async () => {
    const r = await buy(TRV, SECULAR, 398.95, { payFromCash: 1000 });
    expect(r.refused).toBe(true);
    expect(r.refusal?.message).toMatch(/^Trade blocked: You have \$1,000\.00 in cash; this buy is \$[\d,]+\.\d\d\.$/);
    expect(r.db.store.position ?? []).toHaveLength(0);
    expect(r.db.store.order ?? []).toHaveLength(0);
    // The refusal is the Activity line: the attempt feed reads it (attempt-outcomes.ts).
    expect(r.db.store.gateRejection?.[0]).toMatchObject({ tool: "place_trade", ticker: "TRV" });
  });

  it("is refused when the account's cash can't be read", async () => {
    const r = await buy(TRV, SECULAR, 398.95, { payFromCash: null });
    expect(r.refusal?.message).toContain("Couldn't read the account's cash");
  });
});

describe("CORT: an Auto-buy on a watch with no floor", () => {
  it("is proposed with its playbook's floor, the run-up's {swingLow} $108.41: the stock's lines were never its sale", async () => {
    const r = await buy(CORT as unknown as typeof TRV, CATALYST, 126.5, { payFromCash: 50_000 });
    expect(r.refused).toBe(false);
    expect(orderOf(r)).toMatchObject({ status: "AWAITING_APPROVAL", intent: "OPEN", thesisId: CORT.id });
    expect(r.db.store.position?.[0]).toMatchObject({ stopLoss: 108.41, stopReason: null });
  });
});

describe("an Auto-buy whose floor can't be priced is refused, and the refusal is its Activity line", () => {
  it("TRV with a chart that can't be read", async () => {
    const r = await buy(TRV, SECULAR, 398.95, { payFromCash: 50_000 }, false);
    expect(r.refused).toBe(true);
    expect(r.refusal?.message).toBe("Trade blocked: The playbook's floor is {baseLow} (the base's low), and the chart couldn't be read. Name the floor (sell_if_below) under structure on the chart, with its reason.");
    expect(r.db.store.position ?? []).toHaveLength(0);
    expect(r.db.store.order ?? []).toHaveLength(0);
    expect(r.db.store.gateRejection?.[0]).toMatchObject({ tool: "place_trade", ticker: "TRV" });
  });

  it("TRV on a playbook whose floor words name no key (a flag's buy-day low)", async () => {
    const r = await buy({ ...TRV, setupId: "MOMENTUM_FLAG" }, SECULAR, 398.95, { payFromCash: 50_000 });
    expect(r.refusal?.message).toMatch(/^Trade blocked: The playbook's floor names no chart key\. Name the floor \(sell_if_below\)/);
    expect(r.db.store.order ?? []).toHaveLength(0);
  });
});

describe("IOT: an Auto-trim", () => {
  const seed = () => ({ thesis: [thesisRow(IOT)], position: [IOT_POSITION], agentConfig: [agentConfigRow({ ...PEAD, tradingEnvironment: "LIVE" })], account: [APPROVALS] });

  it("sells its 30% (90 of 300 shares), as a proposal", async () => {
    const call = doItCall({ trade: "TRIM", trigger: IOT_TRIM, thesis: IOT, price: 0 });
    expect(call).toMatchObject({ tool: "sell", args: { ticker: "IOT", percent: 30 } });
    const r = await replayTool("sell", "sell", { seed: seed(), args: call.args, ctx: analystCtx(PEAD), quotes: { IOT: 47.6 } });
    expect(r.refused).toBe(false);
    expect(orderOf(r)).toMatchObject({ intent: "PARTIAL_CLOSE", quantity: 90, status: "AWAITING_APPROVAL" });
  });

  it("a trim that names no size sells half", () => {
    const { trimPct: _drop, ...noSize } = IOT_TRIM;
    void _drop;
    expect(doItCall({ trade: "TRIM", trigger: noSize, thesis: IOT, price: 0 }).args).toMatchObject({ percent: 50 });
  });

  it("an Auto-add is paid from cash too", async () => {
    const call = doItCall({ trade: "ADD", trigger: { ...IOT_TRIM, action: "ADD" }, thesis: IOT, price: 0 });
    const r = await replayTool("add", "add", { seed: seed(), args: call.args, ctx: { ...analystCtx(PEAD), payFromCash: 500 }, quotes: { IOT: 47.6 } });
    expect(r.refused).toBe(true);
    expect(r.refusal?.message).toMatch(/^You have \$500\.00 in cash; this buy is \$/);
    expect(r.db.store.order ?? []).toHaveLength(0);
  });
});
