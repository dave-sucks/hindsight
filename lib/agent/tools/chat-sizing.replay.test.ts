/**
 * chat-sizing.replay.test.ts — a chat pinned to an analyst sizes by the
 * analyst's three settings, the same as its runs.
 *
 * The route built the tools' settings twice, by hand: the Run button's copy
 * carried the smallest trade and the most in one stock, the chat's did not.
 * A scoped chat's new buy had no floor, and its add took twice the largest
 * trade as the cap. Both now come from `analystToolSettings`, which the route
 * calls for both doors; this test builds the chat's tools from it and runs
 * place_trade and manage_position through their real entry points.
 *
 * place_trade reads the band (smallest to largest trade); manage_position's
 * add reads the band's ceiling and the most in one stock. The numbers are
 * the Catalyst Event PM's ($3,000 to $8,000 a trade, 1% risk), with the most
 * in one stock set to $12,000: every analyst today holds that at twice the
 * largest trade, which is also the default, so only a different number
 * shows which one is read.
 */
import { replayTool, thesisRow, positionRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID, planTriggers } from "@/lib/replay";
import { analystToolSettings } from "@/lib/agent/tool-context";

const ROW = {
  sectors: [], industries: [], themes: [], exclusionList: [], marketCapMin: null, marketCapMax: null,
  minConfidence: 60, maxOpenPositions: 5,
  minPositionSize: 3000, maxPositionSize: 8000, maxPositionTotal: 12000,
};
const chat = { runMode: "PRINCIPAL_CHAT", runEnvironment: "PAPER", ...analystToolSettings(ROW, []) };
const seedBase = () => ({
  agentConfig: [agentConfigRow({ minPositionSize: 3000, maxPositionSize: 8000, maxPositionTotal: 12000, maxOpenPositions: 5, riskPct: 1 })],
  // Buys and adds wait for the principal: the replay stops at the proposal.
  account: [accountRow({ requireApprovalBuysPaper: true, requireApprovalSellsPaper: true, requireApprovalBuysLive: true, requireApprovalSellsLive: true })],
});

describe("the tools' settings off the analyst's row", () => {
  it("carry the smallest trade, the largest trade and the most in one stock", () => {
    expect(analystToolSettings(ROW, ["AAA"])).toMatchObject({ watchlist: ["AAA"], minPositionSize: 3000, maxPositionSize: 8000, maxPositionTotal: 12000, maxOpenPositions: 5, minConfidence: 60 });
  });
});

describe("a scoped chat's new buy, sized by the rules", () => {
  // $100 entry, $50 floor: 1% of $100,000 over a $50 distance is 20 shares
  // before conviction, under $2,000, below the smallest trade.
  const seed = () => ({
    ...seedBase(),
    thesis: [thesisRow({ id: "t_buy", ticker: "AAA", status: "WATCHING", direction: "LONG", conviction: "MEDIUM", entryPrice: 100, targetPrice: 200, stopLoss: 50, analystId: REPLAY_ANALYST_ID, triggers: planTriggers({ entry: 100, target: 200, stop: 50 }) })],
  });
  const buy = { ticker: "AAA", direction: "LONG", entry_price: 100, target_price: 200, stop_loss: 50, thesis_id: "t_buy" };

  it("is lifted to the analyst's smallest trade, $3,000", async () => {
    const { refused, result, db } = await replayTool("place-trade", "placeTrade", { seed: seed(), ctx: chat, args: buy, quotes: { AAA: 100 } });
    expect(refused).toBe(false);
    expect(result.data?.status).toBe("PROPOSED");
    const order = (db.store.order as Array<Record<string, unknown>>)[0];
    // 15 shares ($1,500) by risk at MEDIUM, lifted to the floor.
    expect(Number(order.quantity) * 100).toBe(3000);
  });

  it("without the smallest trade in the chat's settings, as before, the same buy came in under it", async () => {
    const { result, db } = await replayTool("place-trade", "placeTrade", { seed: seed(), ctx: { ...chat, minPositionSize: undefined }, args: buy, quotes: { AAA: 100 } });
    expect(result.data?.status).toBe("PROPOSED");
    expect(Number((db.store.order as Array<Record<string, unknown>>)[0].quantity) * 100).toBeLessThan(3000);
  });
});

describe("a scoped chat's add, sized by the rules", () => {
  // 100 shares held at $100 ($10,000), a $90 floor: a new buy would be
  // 1% of $100,000 over $10, times conviction; the add is half of it, about
  // $3,750, more than the $2,000 left under the analyst's $12,000.
  const seed = () => ({
    ...seedBase(),
    thesis: [thesisRow({ id: "t_add", ticker: "AAA", status: "HOLDING", direction: "LONG", conviction: "MEDIUM", entryPrice: 100, targetPrice: 140, stopLoss: 90, analystId: REPLAY_ANALYST_ID })],
    position: [positionRow({ id: "p_add", symbol: "AAA", analystId: REPLAY_ANALYST_ID, quantity: 100, avgCost: 100, stopLoss: 90, targetPrice: 140, thesisId: "t_add" })],
  });
  const add = { symbol: "AAA", action: "add_to_position", reason: "Pressing the winner on the hold of the breakout, per the seat's add rule." };
  const addDollars = (db: { store: Record<string, Array<Record<string, unknown>>> }) => Number(db.store.order[0].quantity) * 100;

  it("is trimmed to the room left under the analyst's most in one stock", async () => {
    const { refused, result, db } = await replayTool("manage-position", "managePosition", { seed: seed(), ctx: chat, args: add, quotes: { AAA: 100 } });
    expect(refused).toBe(false);
    expect(addDollars(db)).toBe(2000);
    expect(JSON.stringify(result.data)).toMatch(/Trimmed to the room left under the most this analyst may hold in one stock \(\$12,000\)/);
  });

  it("without the most in one stock in the chat's settings, as before, the cap was twice the largest trade and the add went past $12,000", async () => {
    const { db } = await replayTool("manage-position", "managePosition", { seed: seed(), ctx: { ...chat, maxPositionTotal: undefined }, args: add, quotes: { AAA: 100 } });
    expect(10000 + addDollars(db)).toBeGreaterThan(12000);
  });
});
