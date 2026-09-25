/**
 * place-trade.pltr-replay.test.ts — the analyst's rules size the buy; a
 * size the model typed is not a reason to lose it (DAV-317, DAV-311).
 *
 * Replay: PLTR, 2026-09-25 09:40 ET (run cmuh0czht000204l2vpmar22o). The
 * buy trigger fired at $192.89, the Compounder's tactical run confirmed
 * the setup and called place_trade with `notional: 11222.36, shares: 58`.
 * The tool refused: "requested $11,222 exceeds this analyst's largest trade
 * ($10,000)". The run did not retry, the crossing was spent, and no buy
 * reached the principal.
 *
 * Here the same call, through the same entry point, becomes a proposal
 * sized by the rules — and the principal's own number, from the chat, is
 * honored with a line when it sits outside the band.
 */
import { replayTool, thesisRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const PLTR_THESIS = "cmqop233h000n04l57odbcpup";

/** The place_trade input the tactical run sent at 09:40:23 ET, from its RunMessage. */
const fx = {
  ticker: "PLTR",
  company_name: "Palantir Technologies Inc",
  exchange: "NASDAQ NMS - GLOBAL MARKET",
  direction: "LONG",
  entry_price: 192.89,
  target_price: 249.26,
  stop_loss: 164.55,
  notional: 11222.36,
  shares: 58,
  thesis_id: PLTR_THESIS,
  analyst_id: "cmmqxola3000004lbj7c11bfn",
};

const seed = () => ({
  thesis: [
    thesisRow({
      id: PLTR_THESIS,
      ticker: "PLTR",
      status: "WATCHING",
      direction: "LONG",
      horizon: "COMPOUNDER",
      setupId: "BASE_BREAKOUT",
      conviction: "HIGH",
      entryPrice: 192.75,
      targetPrice: 249.26,
      stopLoss: 164.55,
      analystId: REPLAY_ANALYST_ID,
    }),
  ],
  // The Secular Compounder's limits on 2026-09-25.
  agentConfig: [agentConfigRow({ minPositionSize: 4000, maxPositionSize: 10000, maxPositionTotal: 20000, maxOpenPositions: 6, riskPct: 1 })],
  // Buys wait for the principal, so the replay stops at the proposal and
  // never reaches the broker.
  account: [accountRow({ requireApprovalBuysPaper: true, requireApprovalSellsPaper: true, requireApprovalBuysLive: true, requireApprovalSellsLive: true })],
});

// analyst_id is the principal-chat fallback; the tactical run is scoped to
// its analyst, so the fixture's cuid is replaced by the replay analyst.
const args = { ...fx, thesis_id: PLTR_THESIS, analyst_id: undefined };

describe("PLTR 2026-09-25 — the fired buy the size refusal killed", () => {
  it("inside a run, the model's $11,222 is ignored and the buy is sized by the rules", async () => {
    const { refused, refusal, result, db } = await replayTool("place-trade", "placeTrade", {
      seed: seed(),
      ctx: { runMode: "INTRADAY_TACTICAL", runEnvironment: "PAPER", minPositionSize: 4000, maxPositionSize: 10000, maxOpenPositions: 6 },
      args,
      quotes: { PLTR: 192.89 },
    });
    expect(refusal).toBeNull();
    expect(refused).toBe(false);
    expect(result.data?.status).toBe("PROPOSED");
    const orders = db.store.order as Array<Record<string, unknown>>;
    expect(orders).toHaveLength(1);
    // Not the 58 shares ($11,222) the model typed.
    expect(orders[0].quantity).not.toBe(58);
    const shares = orders[0].quantity as number;
    expect(shares * 192.89).toBeLessThanOrEqual(10000);
    const sizing = (result.data?.sizing as string[]).join(" ");
    expect(sizing).not.toMatch(/Sized by (you|the analyst)/);
    expect(sizing).toMatch(/Sized by risk|Sized from the analyst's band/);
  });

  it("in the principal's chat, $11,222 is honored and the line says it is above the largest trade", async () => {
    const { refused, result, db } = await replayTool("place-trade", "placeTrade", {
      seed: seed(),
      ctx: { runMode: "PRINCIPAL_CHAT", runEnvironment: "PAPER", minPositionSize: 4000, maxPositionSize: 10000, maxOpenPositions: 6 },
      args: { ...args, shares: undefined },
      quotes: { PLTR: 192.89 },
    });
    expect(refused).toBe(false);
    expect(result.data?.status).toBe("PROPOSED");
    const orders = db.store.order as Array<Record<string, unknown>>;
    expect(orders[0].quantity).toBe(58);
    const sizing = (result.data?.sizing as string[]).join(" ");
    expect(sizing).toMatch(/Sized by you: \$11,222 — above the analyst's largest trade \(\$10,000\)/);
  });
});
