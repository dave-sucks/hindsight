/**
 * A buy, an Auto buy and an add filled at once, approvals off: each sends
 * app/buy.filled once, for its own order, so After the buy runs on it.
 * PANW's buy as it would have gone on the PAPER book with approvals off: the
 * chat's place_trade call (its sale $339.92 and its reason), the same stock as
 * an Auto buy (the trigger run's own call, from doItCall), and an add once
 * held. Only the database, the broker and the quotes are doubled; the broker
 * fills at once at $359.42, PANW's price at 11:10 ET that day.
 */
import { replayTool, thesisRow, agentConfigRow, accountRow, positionRow, type Row } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";
import { doItCall } from "@/lib/agent/triggers/do-it";

const BUY_FILLED = "app/buy.filled";
const PEAD = "cmnhxpjio000004jvox6kl6c7";
const THESIS = "cmwle4m6f000l08l5ohrprdxt";
const POSITION = "cmwnosh8e000c07jmgvs54z75";
const PAID = 357.4625;
const NOTE = "Palo Alto reported FQ1'27 after the close on Nov 18: revenue $3.44B vs $3.31B expected, adj EPS $1.05 vs $0.97, and management raised full-year revenue guidance to $14.52–14.57B.";
const SALE_REASON = "The Nov 18 gap-day low — if the stock closes back below the gap, the earnings reaction has been fully rejected and the drift is over.";
const FLOOR: Trigger = { id: "16935fdc-d1df-4982-83e6-b693acfa4294", action: "EXIT", source: "PRINCIPAL", fireMode: "DO_IT", predicate: { watch: "price", is: "below", value: 336.01 }, rationale: "Sell if below $336.01. You set this." } as Trigger;
const EARNINGS_REVIEW: Trigger = { id: "0741d0f1-e2e3-4a6d-8f2b-2b9de9e3144b", action: "REVIEW", source: "AGENT", fireMode: "NEXT_MORNING", predicate: { watch: "report", is: "before", value: 0 }, rationale: "Review on the day of earnings." } as unknown as Trigger;
/** PANW's chart through Nov 18, as get_stock_data read it on Nov 19. */
const PANW_CHART = {
  price: 359.42,
  base: null,
  gaps: [{ date: "2026-11-12", direction: "DOWN", pct: -3.22, low: 314.79, mid: 320.57, high: 326.34 }],
  range: { high20: 406.88, low20: 301.28, high52w: 432.33, low52w: 139.57, pctBelow52wHigh: 16.2, pctAbove52wLow: 159.6 },
  swings: { lastHigh: { price: 406.88, date: "2026-10-28" }, lastLow: { price: 312.12, date: "2026-11-05" } },
  atr14: { dollars: 19.52, pct: 5.39 },
  sma: { d20: { value: 347.45, slope: "FALLING", pctFromPrice: 4.27 }, d50: { value: 366.7, slope: "FALLING", pctFromPrice: -1.2 }, d150: { value: 319.2, slope: "RISING", pctFromPrice: 13.5 }, d200: { value: 279.47, slope: "RISING", pctFromPrice: 29.64 } },
};
const account = () => accountRow({ autoStopOnBuy: false, requireApprovalBuysLive: true, requireApprovalBuysPaper: false, requireApprovalSellsPaper: false });

/** The broker filling at once, for a buy or an add with approvals off; the stock priced at PANW's $359.42. */
const fillsAtOnce = (qty: number) => ({
  getLatestPrice: async () => 359.42,
  getLatestPrices: async (syms: string[]) => Object.fromEntries(syms.map((s) => [s, 359.42])),
  MARKET_DATA_FEED: "sip",
  getSnapshots: async () => ({}),
  getTodaySessionBars: async () => ({}),
  getBars: async () => [],
  getDailyBars: async () => ({ feed: "sip", bars: [] }),
  getAccount: async () => ({ equity: "100000", cash: "60000", buying_power: "120000", portfolio_value: "100000" }),
  getPositions: async () => [],
  getAllPositions: async () => [],
  getPosition: async () => null,
  getOpenOrders: async () => [],
  getLatestPricesWithMeta: async (syms: string[]) => ({ prices: Object.fromEntries(syms.map((s) => [s, 359.42])), sources: Object.fromEntries(syms.map((s) => [s, "alpaca"])), asOf: {}, fetchedAt: new Date().toISOString() }),
  placeMarketOrder: async () => ({ id: "alpaca_fill", status: "accepted" }),
  getOrder: async () => ({ id: "alpaca_fill", status: "filled", filled_avg_price: "359.42", filled_qty: String(qty), filled_at: "2026-11-19T16:10:00Z" }),
  getOrderByClientOrderId: async () => null,
  closePosition: async () => null,
  closePositionPartial: async () => null,
  cancelOrder: async () => null,
  placeLimitOrder: async () => null,
});
const replaySends = jest.fn(async (_event: unknown) => undefined);
const brokerAndSends = (qty: number) => ({
  "@/lib/alpaca": () => fillsAtOnce(qty),
  "@/lib/inngest/client": () => ({ inngest: { createFunction: () => ({}), send: (e: unknown) => replaySends(e as never) } }),
});
const replayed = () => replaySends.mock.calls.map(([e]) => e as { name: string; data: { orderId: string } }).filter((e) => e.name === BUY_FILLED);
const PAPER_WATCH = { thesis: [thesisRow({ id: THESIS, ticker: "PANW", status: "WATCHING", direction: "LONG", setupId: null, analystId: PEAD, triggers: [EARNINGS_REVIEW] } as Partial<Row>)], agentConfig: [agentConfigRow({ id: PEAD, name: "PEAD Specialist", autoStopOnBuy: null, autoStopPct: null })], account: [account()] };
const PAPER_RUN = { runMode: "INTRADAY_TACTICAL", analystId: PEAD, runEnvironment: "PAPER", runStock: { ticker: "PANW", thesisId: THESIS, triggerId: "" } };

describe("a buy or an add filled at once, approvals off (PAPER)", () => {
  beforeEach(() => replaySends.mockClear());

  it("a buy (place_trade) sends it once, for its order", async () => {
    const r = await replayTool("place-trade", "placeTrade", {
      seed: PAPER_WATCH,
      args: { ticker: "PANW", direction: "LONG", sell_if_below: 339.92, sell_reason: SALE_REASON, thesis_id: THESIS, entry_rationale: NOTE },
      ctx: { runMode: "PRINCIPAL_CHAT", analystId: PEAD, runEnvironment: "PAPER" },
      quotes: { PANW: 359.42 },
      mocks: brokerAndSends(8),
    });
    expect(r.crashed).toBe(false);
    const order = (r.db.store.order as Row[]).find((o) => o.symbol === "PANW" && o.intent === "OPEN");
    expect(order?.status).toBe("FILLED");
    expect(replayed()).toEqual([{ name: BUY_FILLED, data: { orderId: order!.id } }]);
  });

  // An Auto buy names no sale: its floor is the playbook's, priced from the chart. PANW has no playbook, so here
  // it is written on the compounder's (the floor under the last swing low, at most 25% under the buy), with its
  // real chart through Nov 18: the swing low $312.12 (Nov 5), moving $19.52 a day.
  it("an Auto buy (the trigger run's own place_trade call, from doItCall) sends it once", async () => {
    const call = doItCall({ trade: "BUY", trigger: { action: "ENTER", predicate: { watch: "price", is: "above", variable: "sma50" }, rationale: "Above a rising 50-day." } as never, thesis: { id: THESIS, ticker: "PANW", direction: "LONG" }, price: 359.42 });
    expect(call.tool).toBe("place_trade");
    const seed = { ...PAPER_WATCH, thesis: [thesisRow({ id: THESIS, ticker: "PANW", status: "WATCHING", direction: "LONG", setupId: "COMPOUNDER_ACCUMULATION", analystId: PEAD, triggers: [EARNINGS_REVIEW] } as Partial<Row>)] };
    const r = await replayTool("place-trade", "placeTrade", { seed, args: call.args, ctx: PAPER_RUN, quotes: { PANW: 359.42 }, mocks: { ...brokerAndSends(8), "@/lib/proposals/fill-chart": () => ({ loadFillChart: async () => PANW_CHART }) } });
    expect(r.crashed).toBe(false);
    const order = (r.db.store.order as Row[]).find((o) => o.symbol === "PANW" && o.intent === "OPEN");
    expect(order?.status).toBe("FILLED");
    expect(replayed()).toEqual([{ name: BUY_FILLED, data: { orderId: order!.id } }]);
  });

  it("an add (add) sends it once, for its order", async () => {
    const held = positionRow({ id: POSITION, analystId: PEAD, symbol: "PANW", status: "OPEN", environment: "PAPER", quantity: 15, initialQty: 15, avgCost: PAID, stopLoss: 336.01 });
    const r = await replayTool("add", "add", {
      seed: { ...PAPER_WATCH, thesis: [thesisRow({ id: THESIS, ticker: "PANW", status: "HOLDING", direction: "LONG", setupId: null, analystId: PEAD, triggers: [FLOOR] } as Partial<Row>)], position: [held] },
      args: { ticker: "PANW", note: "Adding as the drift holds above the gap." },
      ctx: { runMode: "PRINCIPAL_CHAT", analystId: PEAD, runEnvironment: "PAPER" },
      quotes: { PANW: 359.42 },
      mocks: brokerAndSends(3),
    });
    expect(r.crashed).toBe(false);
    const order = (r.db.store.order as Row[]).find((o) => o.symbol === "PANW" && o.intent === "ADD");
    expect(order?.status).toBe("FILLED");
    expect(replayed()).toEqual([{ name: BUY_FILLED, data: { orderId: order!.id } }]);
  });
});
