/**
 * With stop when buying on, a buy is sized off the wider of the plan's floor
 * and the setting's line, so a loss at the hard line stays inside the risk per
 * trade. Through place_trade's real entry point, on real watched rows:
 *
 *   TRV (Secular Compounder, HIGH): buy $398.70, floor $382.40 (4.1% under),
 *   target $431.50; the analyst's limits $4,000–$10,000, 1% risk.
 *   IOT (PEAD Specialist, LOW), the row at 12:01 ET on 10-15: buy $42.15,
 *   floor $39.80 (5.6% under), target $47; limits $3,000–$14,000, 1% risk.
 */
import { replayTool, thesisRow, positionRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID, planTriggers } from "@/lib/replay";

const CASES = {
  TRV: { conviction: "HIGH", horizon: "COMPOUNDER", setupId: "BASE_BREAKOUT", entry: 398.7, stop: 382.4, target: 431.5, band: { minPositionSize: 4000, maxPositionSize: 10000 } },
  IOT: { conviction: "LOW", horizon: "TARGET", setupId: "NONE", entry: 42.15, stop: 39.8, target: 47, band: { minPositionSize: 3000, maxPositionSize: 14000 } },
} as const;

async function buy(ticker: keyof typeof CASES, autoStop: { on: boolean; pct: number }) {
  const c = CASES[ticker];
  const { refused, refusal, result, db } = await replayTool("place-trade", "placeTrade", {
    seed: {
      thesis: [
        thesisRow({
          id: `thesis_${ticker}`,
          ticker,
          status: "WATCHING",
          direction: "LONG",
          horizon: c.horizon,
          setupId: c.setupId,
          conviction: c.conviction,
          entryPrice: c.entry,
          targetPrice: c.target,
          stopLoss: c.stop,
          analystId: REPLAY_ANALYST_ID,
          triggers: planTriggers({ entry: c.entry, target: c.target, stop: c.stop }),
        }),
      ],
      agentConfig: [agentConfigRow({ ...c.band, maxPositionTotal: c.band.maxPositionSize * 2, riskPct: 1 })],
      // Buys wait for approval, so the replay stops at the proposal.
      account: [accountRow({ requireApprovalBuysPaper: true, requireApprovalBuysLive: true, autoStopOnBuy: autoStop.on, autoStopPct: autoStop.pct })],
    },
    ctx: { runMode: "INTRADAY_TACTICAL", runEnvironment: "PAPER", ...c.band, maxOpenPositions: 10 },
    args: { ticker, direction: "LONG", entry_price: c.entry, thesis_id: `thesis_${ticker}` },
    quotes: { [ticker]: c.entry },
  });
  expect([refused, refusal]).toEqual([false, null]);
  const orders = db.store.order as Array<{ quantity: number }>;
  return { shares: orders[0].quantity, sizing: (result.data?.sizing as string[]).join(" ") };
}

describe("TRV — a 4.1% plan floor with an 8% setting is sized like an 8% stop", () => {
  it("on: the risk is measured to the $366.80 line ($31.90 a share), not the $382.40 floor", async () => {
    const { shares, sizing } = await buy("TRV", { on: true, pct: 8 });
    expect(sizing).toMatch(/over \$31\.90 to the stop/);
    expect(sizing).toMatch(/Risk alone said 31 shares/);
    expect(sizing).toContain("Sized off the 8% stop-when-buying line at $366.80, wider than the $382.40 floor.");
    // The analyst's $10,000 largest trade binds either way.
    expect(shares).toBe(25);
  });

  it("off: unchanged, sized to the $382.40 floor", async () => {
    const { shares, sizing } = await buy("TRV", { on: false, pct: 8 });
    expect(sizing).toMatch(/over \$16\.30 to the stop/);
    expect(sizing).toMatch(/Risk alone said 61 shares/);
    expect(sizing).not.toMatch(/stop-when-buying/);
    expect(shares).toBe(25);
  });
});

describe("the add path — MU held, 11 shares at $911.415, floor $850, an add at the 10-21 close of $913.67", () => {
  async function add(autoStop: { on: boolean; pct: number }) {
    const { refused, result } = await replayTool("manage-position", "managePosition", {
      seed: {
        thesis: [thesisRow({ id: "thesis_MU", ticker: "MU", status: "HOLDING", direction: "LONG", horizon: "COMPOUNDER", setupId: "MA_PULLBACK", conviction: "HIGH", entryPrice: 911.415, targetPrice: 1500, stopLoss: 850, analystId: REPLAY_ANALYST_ID })],
        position: [positionRow({ id: "position_MU", symbol: "MU", analystId: REPLAY_ANALYST_ID, quantity: 11, avgCost: 911.415, stopLoss: 850, targetPrice: 1500, thesisId: "thesis_MU" })],
        agentConfig: [agentConfigRow({ minPositionSize: 4000, maxPositionSize: 10000, maxPositionTotal: 20000, riskPct: 1 })],
        account: [accountRow({ requireApprovalBuysPaper: true, requireApprovalBuysLive: true, autoStopOnBuy: autoStop.on, autoStopPct: autoStop.pct })],
      },
      ctx: { runMode: "PRINCIPAL_CHAT", runEnvironment: "PAPER", minPositionSize: 4000, maxPositionSize: 10000, maxPositionTotal: 20000, maxOpenPositions: 10 },
      args: { symbol: "MU", action: "add_to_position", reason: "Adding on the hold of the 50-day, per the seat's add rule." },
      quotes: { MU: 913.67 },
    });
    expect(refused).toBe(false);
    return JSON.stringify(result.data);
  }

  it("on at 8%: the risk is measured to the $840.58 line, wider than the $850 floor", async () => {
    const said = await add({ on: true, pct: 8 });
    expect(said).toMatch(/over \$73\.09 to the stop/);
    expect(said).toContain("Sized off the 8% stop-when-buying line at $840.58, wider than the $850.00 floor.");
  });

  it("off: measured to the $850 floor, as before", async () => {
    const said = await add({ on: false, pct: 8 });
    expect(said).toMatch(/over \$63\.67 to the stop/);
    expect(said).not.toMatch(/stop-when-buying/);
  });
});

describe("IOT — where the largest trade doesn't bind, the share count follows the wider stop", () => {
  it("on at 8%: 148 shares, risk measured to $38.78", async () => {
    const { shares, sizing } = await buy("IOT", { on: true, pct: 8 });
    expect(sizing).toMatch(/over \$3\.37 to the stop/);
    expect(shares).toBe(148);
  });

  it("off: 212 shares, risk measured to the $39.80 floor, as before", async () => {
    const { shares, sizing } = await buy("IOT", { on: false, pct: 8 });
    expect(sizing).toMatch(/over \$2\.35 to the stop/);
    expect(shares).toBe(212);
  });
});
