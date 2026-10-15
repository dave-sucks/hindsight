/**
 * In the chat, the analyst's minimum score is a line on the proposal, not a
 * refusal (ruling 2026-10-15), as the principal's own size is. MU, 10:49 ET:
 * the chat's buy on the writer's thesis (composite 6, the Secular Compounder
 * buys at 70%) was refused; the chat then re-scored the plan to 7 itself and
 * asked the writer to score it to clear the gate. The analyst's book is the
 * 10-14 close; its limit is the 10 seats set at 10:59.
 */
import { replayTool, thesisRow, positionRow, agentConfigRow, accountRow, planTriggers, REPLAY_ACCOUNT_ID } from "@/lib/replay";
import book from "@/lib/agent/__fixtures__/master-chat-writes-2026-10-14.json";

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const THESIS = "cmv9nm3xo000o06l3om8r7ath";
const seed = () => ({
  account: [accountRow(book.account)],
  agentConfig: book.analysts.map((a) => agentConfigRow({ ...a, accountId: REPLAY_ACCOUNT_ID, ...(a.id === SECULAR ? { maxOpenPositions: 10 } : {}) })),
  position: book.positions.map((p) => positionRow({ ...p, accountId: REPLAY_ACCOUNT_ID, status: "OPEN" })),
  thesis: [thesisRow({ id: THESIS, ticker: "MU", status: "WATCHING", direction: "LONG", conviction: "HIGH", analystId: SECULAR, scoring: { composite: 6 }, entryPrice: 982.41, targetPrice: 1850, stopLoss: 855, triggers: planTriggers({ entry: 982.41, target: 1850, stop: 855 }) })],
});
const secular = { analystId: SECULAR, runEnvironment: "LIVE", maxOpenPositions: 10, minConfidence: 70, minPositionSize: 4000, maxPositionSize: 10000, maxPositionTotal: 20000 };
const buy = { ticker: "MU", direction: "LONG", entry_price: 906.33, shares: 13, thesis_id: THESIS, entry_rationale: "(the chat's reason)" };
const LINE = "Scores 6/10 (=60%), below this analyst's minimum (70%).";

describe("MU 10:49 — a chat buy below the analyst's minimum score", () => {
  it("becomes a proposal carrying the line, still waiting for approval", async () => {
    const { result, db } = await replayTool("place-trade", "placeTrade", { seed: seed(), ctx: { ...secular, runMode: "PRINCIPAL_CHAT" }, args: buy, quotes: { MU: 906.33 } });
    expect(result.data?.status).toBe("PROPOSED");
    const order = (db.store.order as Array<{ status: string; rationale: string }>)[0];
    expect(order.status).toBe("AWAITING_APPROVAL");
    expect(order.rationale).toContain(LINE);
  });

  it("a trigger run's buy below the minimum is still refused", async () => {
    const { result, db } = await replayTool("place-trade", "placeTrade", { seed: seed(), ctx: { ...secular, runMode: "INTRADAY_TACTICAL" }, args: buy, quotes: { MU: 906.33 } });
    expect(String(result.data?.message)).toMatch(/below this analyst's minimum \(70%\)/);
    expect(db.store.order ?? []).toEqual([]);
  });
});
