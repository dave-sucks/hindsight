/**
 * A buy never exceeds the most the analyst may hold in one stock. Its largest
 * trade could sit above that cap (a cap stamped at Create, then the largest
 * raised), and a first buy over the cap refused every add after it.
 *
 * TRV, the Secular Compounder's real watched row (HIGH, buy $398.70, floor
 * $382.40): risk alone says 61 shares, $24,321. The Compounder's $20,000
 * most in one stock, with its largest trade raised to $25,000.
 */
import { replayTool, thesisRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID, planTriggers } from "@/lib/replay";

const LIMITS = { minPositionSize: 4000, maxPositionSize: 25000, maxPositionTotal: 20000 };

it("TRV is capped at the $20,000 most in one stock, not the $25,000 largest trade", async () => {
  const { refused, refusal, result, db } = await replayTool("place-trade", "placeTrade", {
    seed: {
      thesis: [
        thesisRow({
          id: "thesis_TRV", ticker: "TRV", status: "WATCHING", direction: "LONG", horizon: "COMPOUNDER", setupId: "BASE_BREAKOUT", conviction: "HIGH",
          entryPrice: 398.7, targetPrice: 431.5, stopLoss: 382.4, analystId: REPLAY_ANALYST_ID,
          triggers: planTriggers({ entry: 398.7, target: 431.5, stop: 382.4 }),
        }),
      ],
      agentConfig: [agentConfigRow({ ...LIMITS, riskPct: 1 })],
      account: [accountRow({ requireApprovalBuysPaper: true, requireApprovalBuysLive: true })],
    },
    ctx: { runMode: "INTRADAY_TACTICAL", runEnvironment: "PAPER", ...LIMITS, maxOpenPositions: 10 },
    args: { ticker: "TRV", direction: "LONG", entry_price: 398.7, thesis_id: "thesis_TRV" },
    quotes: { TRV: 398.7 },
  });
  expect([refused, refusal]).toEqual([false, null]);
  const sizing = (result.data?.sizing as string[]).join(" ");
  expect(sizing).toMatch(/Risk alone said 61 shares/);
  expect(sizing).toContain("capped at the most this analyst may hold in one stock");
  expect((db.store.order as Array<{ quantity: number }>)[0].quantity).toBe(50);
});
