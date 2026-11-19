/**
 * The Portfolio Manager's trades wait for the owner whatever the account's
 * switches say, through each trade tool's own execute. The account here has
 * both PAPER switches off: any other run's sale goes to the broker; this
 * run's is a proposal.
 */
import { replayTool, thesisRow, positionRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const seed = () => ({
  thesis: [thesisRow({ id: "t_aaa", ticker: "AAA", status: "HOLDING", analystId: REPLAY_ANALYST_ID })],
  position: [positionRow({ symbol: "AAA", status: "OPEN", quantity: 100, avgCost: 100 })],
  account: [accountRow({ requireApprovalSellsPaper: false, requireApprovalBuysPaper: false })],
});
const awaiting = (db: { store: Record<string, unknown[]> }) => (db.store.order as Array<{ status?: string }> | undefined)?.filter((o) => o.status === "AWAITING_APPROVAL") ?? [];

describe("the Portfolio Manager's trades always wait for the owner", () => {
  it("its sale is a proposal with the switch off", async () => {
    const { result, db } = await replayTool("sell", "sell", {
      seed: seed(),
      ctx: { runMode: "PORTFOLIO_MANAGER" },
      args: { ticker: "AAA", belief_survived: true },
      quotes: { AAA: 101 },
    });
    expect(JSON.stringify(result)).toMatch(/AWAITING_APPROVAL|awaiting/i);
    expect(awaiting(db)).toHaveLength(1);
  });

  it("another run's sale on the same account is not held", async () => {
    const { db } = await replayTool("sell", "sell", {
      seed: seed(),
      args: { ticker: "AAA", belief_survived: true },
      quotes: { AAA: 101 },
    });
    expect(awaiting(db)).toHaveLength(0);
  });

  it("its trim is a proposal with the switch off", async () => {
    const { db } = await replayTool("sell", "sell", {
      seed: seed(),
      ctx: { runMode: "PORTFOLIO_MANAGER" },
      args: { ticker: "AAA", percent: 50 },
      quotes: { AAA: 101 },
    });
    expect(awaiting(db)).toHaveLength(1);
  });
});
