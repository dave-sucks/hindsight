/**
 * The setup's rules for the holding's sale are read on the sale the buy names
 * (place_trade's sell_if_below), never on a watch's Stop watching line, which
 * never sells (2026-11-16): at least the setup's minimum ATR from the buy, and
 * on a TRADE at most its widest %, with the account's overrides.
 *
 * DOCU, minted 2026-09-09 15:37 UTC by the PEAD Specialist: a buy at $62.50;
 * the chart that day (Alpaca bars through 09-08) had ATR(14) $2.94. Until
 * 2026-11-16 the Writer refused a $61 line on the watch as 0.51 ATR from the
 * buy. The same numbers now refuse the sale, through place_trade's real entry
 * point, with the 06:30 snapshot's ATR (only its ATR is read here).
 */
import { replayTool, thesisRow, agentConfigRow, accountRow, type Replay } from "@/lib/replay";
import { getSetup } from "@/lib/agent/knowledge/setups";
import { noLegalFloor, saleRuleProblem } from "@/lib/agent/position-sizing";
import { playbookFloor } from "@/lib/agent/knowledge/playbooks";

const AT = new Date("2026-09-09T15:37:00Z");
const SNAPSHOT = {
  id: "docu_0908",
  ticker: "DOCU",
  asOf: "2026-09-08",
  volumeFeed: "sip",
  computedAt: new Date("2026-09-09T10:30:00Z"),
  snapshot: { asOf: "2026-09-08", sma: { 20: 60, 50: 58, 150: 64, 200: 70 }, closes: [62.5], high20: 66, low20: 55, high52w: 107, low52w: 55, volumeAvg20: null, rsVsSpy: { "1M": 0, "3M": 0, "6M": 0 }, gaps: [], atr14: 2.94 },
};
const APPROVALS = { requireApprovalBuysPaper: true, requireApprovalSellsPaper: true, requireApprovalBuysLive: true, requireApprovalSellsLive: true };

async function buy(sale: number, opts: { horizon?: string; overrides?: Record<string, unknown> } = {}): Promise<Replay> {
  jest.useFakeTimers({ now: AT, doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  try {
    return await replayTool("place-trade", "placeTrade", {
      seed: {
        thesis: [thesisRow({ id: "thesis_DOCU", ticker: "DOCU", status: "WATCHING", direction: "LONG", horizon: opts.horizon ?? "TARGET", setupId: "PEAD", conviction: "MEDIUM" })],
        agentConfig: [agentConfigRow({ minPositionSize: 2000, maxPositionSize: 8000, maxPositionTotal: 16000, riskPct: 1 })],
        account: [accountRow({ ...APPROVALS, setupOverrides: opts.overrides ?? {} })],
        tickerIndicators: [SNAPSHOT],
      },
      args: { ticker: "DOCU", direction: "LONG", entry_price: 62.5, sell_if_below: sale, sell_reason: "Under the gap-day low.", thesis_id: "thesis_DOCU" },
      ctx: { runMode: "INTRADAY_TACTICAL", runEnvironment: "PAPER", minPositionSize: 2000, maxPositionSize: 8000, maxOpenPositions: 6 },
      quotes: { DOCU: 62.5 },
    });
  } finally {
    jest.useRealTimers();
  }
}

describe("DOCU 2026-09-09: PEAD's sale rules, read on the sale", () => {
  it("a sale at $61, 0.51 ATR from the $62.50 buy, is refused with the numbers, and nothing is written", async () => {
    const r = await buy(61);
    expect(r.refused).toBe(true);
    expect(r.refusal?.message).toBe(
      "Trade blocked: the sale $61.00 is 0.51 ATR from the $62.50 buy (ATR $2.94). Post-earnings drift needs it at least 1 ATR away — inside that it sells on an ordinary day's movement. Put it under real structure at least $2.94 from the buy. Then call place_trade again.",
    );
    expect(r.db.store.position ?? []).toHaveLength(0);
  });

  it("the sale under the $58.73 swing low, 1.3 ATR away, is proposed", async () => {
    const r = await buy(58.6);
    expect(r.refused).toBe(false);
    expect((r.db.store.position as Array<Record<string, unknown>>)[0]).toMatchObject({ stopLoss: 58.6 });
  });

  it("on a TRADE a 10% sale is past PEAD's 8% cap; the account's 12% override lets it through", async () => {
    const wide = await buy(56.25, { horizon: "TRADE" });
    expect(wide.refusal?.message).toContain("the sale $56.25 is 10.0% from the buy; a TRADE on Post-earnings drift caps it at 8%");
    const widened = await buy(56.25, { horizon: "TRADE", overrides: { PEAD: { stopMaxPct: 12 } } });
    expect(widened.refused).toBe(false);
  });
});

describe("saleRuleProblem", () => {
  const pead = getSetup("PEAD")!;
  it("is silent when the ATR is unknown and off a TRADE", () => {
    expect(saleRuleProblem({ setup: pead, horizon: "TARGET", entry: 62.5, stop: 61, atr: null })).toBeNull();
    expect(saleRuleProblem({ setup: pead, horizon: "TARGET", entry: 62.5, stop: 50, atr: 2.94 })).toBeNull();
  });
  it("reads the account's minimum ATR override (production's Compounder runs at 2)", () => {
    const compounder = getSetup("COMPOUNDER_ACCUMULATION", { COMPOUNDER_ACCUMULATION: { minAtr: 2 } })!;
    expect(saleRuleProblem({ setup: compounder, horizon: "COMPOUNDER", entry: 100, stop: 95, atr: 3 })).toContain("needs it at least 2 ATR away");
  });
  // Expert review 1.5: the compounder's floor sits at most 15% under the buy, on a floor the run names too.
  // Past it the 15% give-back off the high always sells first. Other playbooks' caps stay trade-only.
  it("holds a named compounder floor to 15% under the buy; a breakout on the compounder horizon keeps no cap", () => {
    const compounder = getSetup("COMPOUNDER_ACCUMULATION", { COMPOUNDER_ACCUMULATION: { minAtr: 2 } })!;
    expect(saleRuleProblem({ setup: compounder, horizon: "COMPOUNDER", entry: 100, stop: 88, atr: 3 })).toBeNull();
    expect(saleRuleProblem({ setup: compounder, horizon: "COMPOUNDER", entry: 100, stop: 80, atr: 3 })).toBe(
      "the sale $80.00 is 20.0% from the buy; Compounder accumulation caps it at 15%. If structure needs a wider sale, the position is smaller, not the sale wider: tighten it",
    );
    expect(saleRuleProblem({ setup: getSetup("BASE_BREAKOUT")!, horizon: "COMPOUNDER", entry: 100, stop: 80, atr: 3 })).toBeNull();
  });
});

// Production's snapshots of 2026-11-20, with the owner's 2 ATR minimum: MU's 2 ATR is 20.8% of its close, GEV's 15.5%,
// CEG's 11.2%. Under a 15% cap the first two have no sale that keeps both rules, so the run is told once.
describe("a stock whose minimum distance is past the playbook's widest %", () => {
  const compounder = getSetup("COMPOUNDER_ACCUMULATION", { COMPOUNDER_ACCUMULATION: { minAtr: 2 } })!;
  const none = (entry: number, atr: number, horizon = "COMPOUNDER") => noLegalFloor({ setup: compounder, horizon, entry, atr });

  it("MU and GEV have no legal floor; CEG has one", () => {
    expect(none(594.51, 61.84)).toBe(
      "the stock moves too much for Compounder accumulation's 15% floor right now: 2 ATR is $123.68, 20.8% of the $594.51 buy, so no sale can be at least 2 ATR away and within 15%. Keep watching it until its daily range narrows",
    );
    expect(none(699.33, 54.34)).toContain("15.5% of the $699.33 buy");
    expect(none(237.41, 13.32)).toBeNull();
  });

  it("says nothing with no ATR, or on a horizon the cap doesn't read", () => {
    expect(none(594.51, 0)).toBeNull();
    expect(noLegalFloor({ setup: compounder, horizon: "COMPOUNDER", entry: 594.51, atr: null })).toBeNull();
    expect(none(594.51, 61.84, "TARGET")).toBeNull();
  });

  it("a floor code would price is refused the same way, before it tells the run to name one", () => {
    const floor = playbookFloor({ setup: compounder, horizon: "COMPOUNDER", entry: 594.51, chart: null, atr: 61.84 });
    expect(floor).toMatchObject({ noLegalFloor: true });
    expect("refused" in floor && floor.refused).toMatch(/^The stock moves too much for Compounder accumulation's 15% floor right now/);
  });

  it("place_trade refuses a named floor once, with no sale left to try, and writes nothing", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-20T21:30:00Z"), doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const r = await replayTool("place-trade", "placeTrade", {
        seed: {
          thesis: [thesisRow({ id: "thesis_MU", ticker: "MU", status: "WATCHING", direction: "LONG", horizon: "COMPOUNDER", setupId: "COMPOUNDER_ACCUMULATION", conviction: "HIGH" })],
          agentConfig: [agentConfigRow({ minPositionSize: 4000, maxPositionSize: 10000, maxPositionTotal: 20000, riskPct: 1 })],
          account: [accountRow({ ...APPROVALS, setupOverrides: { COMPOUNDER_ACCUMULATION: { minAtr: 2 } } })],
          tickerIndicators: [{ ...SNAPSHOT, id: "mu_1120", ticker: "MU", asOf: "2026-11-20", snapshot: { ...SNAPSHOT.snapshot, asOf: "2026-11-20", closes: [594.51], atr14: 61.84 } }],
        },
        args: { ticker: "MU", direction: "LONG", entry_price: 594.51, sell_if_below: 520, sell_reason: "Under the last low.", thesis_id: "thesis_MU" },
        ctx: { runMode: "INTRADAY_TACTICAL", runEnvironment: "PAPER", minPositionSize: 4000, maxPositionSize: 10000, maxOpenPositions: 6 },
        quotes: { MU: 594.51 },
      });
      expect(r.refused).toBe(true);
      expect(r.refusal?.message).toContain("the stock moves too much for Compounder accumulation's 15% floor right now");
      expect(r.refusal?.message).not.toMatch(/call place_trade again|Put it under/);
      expect(r.db.store.position ?? []).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
