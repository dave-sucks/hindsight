/**
 * pass_on_stock: the chat's "we looked, and we pass", the stock and the
 * reason. Replay: MLYS in the owner's chat, 11-18. It saves through
 * record_thesis's own PASS path: a PASSED thesis on the pinned analyst, no
 * triggers. A stock we hold is refused there, as a PASS always was.
 */
import { replayTool, agentConfigRow, positionRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const REASON = "The chart has no base and no gap to price a buy from, and the readout that would move it is a year out; nothing here fits this analyst's playbooks.";

const pass = (seed: Record<string, unknown[]> = {}) =>
  replayTool("pass-on-stock", "passOnStock", {
    seed: { agentConfig: [agentConfigRow()], ...seed },
    ctx: { runMode: "PRINCIPAL_CHAT", analystId: REPLAY_ANALYST_ID, calledTickers: new Map([["MLYS", new Set(["get_stock_data"])]]) },
    args: { ticker: "mlys", reason: REASON },
    quotes: { MLYS: 31.2 },
  });

describe("pass_on_stock", () => {
  it("saves the researched decline as PASSED, with the reason and no triggers", async () => {
    const { refused, db } = await pass();
    expect(refused).toBe(false);
    const t = db.store.thesis.find((x) => x.ticker === "MLYS") as Record<string, unknown> | undefined;
    expect(t).toMatchObject({ status: "PASSED" });
    // The reason is the stock's first Activity line.
    expect(db.store.thesisUpdate.some((u) => String((u as { rationale?: string }).rationale ?? "").includes("nothing here fits"))).toBe(true);
    expect((t!.triggers as unknown[] | null) ?? []).toEqual([]);
  }, 30_000);

  it("a stock we hold is refused: a pass can't sit on a position", async () => {
    const { db } = await pass({ position: [positionRow({ analystId: REPLAY_ANALYST_ID, symbol: "MLYS", avgCost: 30, status: "OPEN" })] });
    expect(db.store.thesis.some((x) => x.ticker === "MLYS")).toBe(false);
  }, 30_000);
});
