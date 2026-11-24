/**
 * The compounder's second half, through the add tool's real entry point, on CEG's real filled orders (LIVE):
 * OPEN 30 @ $280.33 on 2026-08-13, ADD 9 @ $265.46 on 09-14, ADD 12 @ $298.6059 on 10-06. The analyst's limits are
 * $4,000–$10,000, $20,000 in one stock. Sizing the add off everything paid asked for $14,382 at the Nov 20 close of
 * $237.41; the second half is the first buy's $8,409.90, and a holding with a filled add takes the half-risk size.
 */
import { replayTool, thesisRow, positionRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const OPEN = { id: "o_open", positionId: "position_CEG", symbol: "CEG", status: "FILLED", intent: "OPEN", side: "BUY", quantity: 30, filledQty: 30, filledPrice: 280.33 };
const ADD_1 = { id: "o_add1", positionId: "position_CEG", symbol: "CEG", status: "FILLED", intent: "ADD", side: "BUY", quantity: 9, filledQty: 9, filledPrice: 265.46 };
const ADD_2 = { id: "o_add2", positionId: "position_CEG", symbol: "CEG", status: "FILLED", intent: "ADD", side: "BUY", quantity: 12, filledQty: 12, filledPrice: 298.6059 };
/** SPY under its 50-day and above its 200-day: a cautious market. */
const CAUTIOUS_SPY = { id: "spy", ticker: "SPY", asOf: "2026-11-20", volumeFeed: "sip", computedAt: new Date("2026-11-20T11:30:00Z"), snapshot: { asOf: "2026-11-20", sma: { 20: 650, 50: 660, 150: 620, 200: 600 }, closes: [640], high20: 670, low20: 630, high52w: 700, low52w: 500, volumeAvg20: null, rsVsSpy: { "1M": 0, "3M": 0, "6M": 0 }, gaps: [], atr14: 8 } };

async function addAt(price: number, position: { quantity: number; avgCost: number; stopLoss: number }, orders: unknown[], over: { maxPositionSize?: number; indicators?: unknown[] } = {}) {
  const maxPositionSize = over.maxPositionSize ?? 10000;
  const r = await replayTool("add", "add", {
    seed: {
      thesis: [thesisRow({ id: "thesis_CEG", ticker: "CEG", status: "HOLDING", direction: "LONG", horizon: "COMPOUNDER", setupId: "COMPOUNDER_ACCUMULATION", conviction: "HIGH", analystId: REPLAY_ANALYST_ID })],
      position: [positionRow({ id: "position_CEG", symbol: "CEG", analystId: REPLAY_ANALYST_ID, thesisId: "thesis_CEG", ...position })],
      order: orders as Record<string, unknown>[],
      agentConfig: [agentConfigRow({ minPositionSize: 4000, maxPositionSize, maxPositionTotal: 20000, riskPct: 1 })],
      account: [accountRow({ requireApprovalBuysPaper: true, requireApprovalBuysLive: true, autoStopOnBuy: false })],
      ...(over.indicators ? { tickerIndicators: over.indicators as Record<string, unknown>[] } : {}),
    },
    ctx: { runMode: "INTRADAY_TACTICAL", runEnvironment: "PAPER", minPositionSize: 4000, maxPositionSize, maxPositionTotal: 20000, maxOpenPositions: 10 },
    args: { ticker: "CEG" },
    quotes: { CEG: price },
  });
  expect(r.refused).toBe(false);
  const placed = (r.db.store.order as Array<{ id: string; quantity: number }>).filter((o) => !["o_open", "o_add1", "o_add2"].includes(o.id));
  expect(placed).toHaveLength(1);
  return { shares: placed[0].quantity, sizing: JSON.stringify(r.result.data?.sizing) };
}

const AFTER_THE_FIRST = { quantity: 30, avgCost: 280.33, stopLoss: 245 };
const TODAY = { quantity: 51, avgCost: 282.006094117647, stopLoss: 220 };

describe("CEG's second half", () => {
  it("with only the first buy filled: the $8,409.90 it cost, 28 shares at $300", async () => {
    const { shares, sizing } = await addAt(300, AFTER_THE_FIRST, [OPEN]);
    expect(shares).toBe(28);
    expect(sizing).toContain("Add: $8,410, the second half, from the $8,410 the first half cost.");
  });

  it("in a cautious market it is half that", async () => {
    const { shares, sizing } = await addAt(300, AFTER_THE_FIRST, [OPEN], { indicators: [CAUTIOUS_SPY] });
    expect(shares).toBe(14);
    expect(sizing).toContain("× 0.5 for a cautious market");
  });

  it("never over the largest trade", async () => {
    const { shares, sizing } = await addAt(300, AFTER_THE_FIRST, [OPEN], { maxPositionSize: 6000 });
    expect(shares).toBe(20);
    expect(sizing).toContain("capped at this analyst's largest trade");
  });

  it("with its two adds filled, as today: the ordinary half-risk size, never the $14,382 paid so far", async () => {
    const { shares, sizing } = await addAt(237.41, TODAY, [OPEN, ADD_1, ADD_2]);
    expect(sizing).not.toContain("the second half");
    expect(sizing).toContain("half the size of a new buy");
    expect(shares * 237.41).toBeLessThan(7892);
  });
});
