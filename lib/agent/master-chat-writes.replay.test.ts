/**
 * The Master Chat (no analyst pinned) acts for the stock's own analyst, with
 * that analyst's rules: every write here gives the answer the chat pinned to
 * that analyst gives. The book as it stood at the close on 2026-10-14; the
 * screen on PAPER, as every unpinned chat to date ran, while the book is LIVE.
 */
import { replayTool, thesisRow, positionRow, agentConfigRow, accountRow, planTriggers, REPLAY_ACCOUNT_ID } from "@/lib/replay";
import book from "@/lib/agent/__fixtures__/master-chat-writes-2026-10-14.json";

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const thesis = (ticker: string) => book.theses.find((t) => t.ticker === ticker)!;
const seed = () => ({
  account: [accountRow(book.account)],
  agentConfig: book.analysts.map((a) => agentConfigRow({ ...a, accountId: REPLAY_ACCOUNT_ID })),
  position: book.positions.map((p) => positionRow({ ...p, accountId: REPLAY_ACCOUNT_ID, status: "OPEN" })),
  thesis: book.theses.map((t) =>
    thesisRow({ ...t, status: t.ticker === "ETN" ? "WATCHING" : "HOLDING", direction: "LONG", scoring: { composite: t.composite }, triggers: planTriggers({ entry: t.entryPrice!, target: t.targetPrice!, stop: t.stopLoss! }) }),
  ),
});
const unpinned = { runMode: "PRINCIPAL_CHAT", runEnvironment: "PAPER", analystId: undefined };
const pinned = { runMode: "PRINCIPAL_CHAT", runEnvironment: "LIVE", analystId: SECULAR, maxOpenPositions: 8, minConfidence: 70, minPositionSize: 4000, maxPositionSize: 10000, maxPositionTotal: 20000 };

describe("the Master Chat edits a thesis for its analyst", () => {
  const retire = { thesis_id: thesis("ASML").id, change_status: "ARCHIVED", rationale: "Dropping ASML from the book; the semis call has run its course." };

  it("retiring a stock we hold without selling it is refused, as pinned", async () => {
    const refusedOf = (r: { result: unknown }) => (r.result as { data: { refused_fields?: Array<{ field: string; reason: string }> } }).data.refused_fields;
    const asPinned = await replayTool("update-thesis", "updateThesis", { seed: seed(), ctx: pinned, args: retire, quotes: book.prices });
    const unpinnedRun = await replayTool("update-thesis", "updateThesis", { seed: seed(), ctx: unpinned, args: retire, quotes: book.prices });
    expect(refusedOf(asPinned)?.[0]).toMatchObject({ field: "change_status", reason: expect.stringMatching(/without closing the position/) });
    expect(refusedOf(unpinnedRun)).toEqual(refusedOf(asPinned));
    expect((unpinnedRun.db.store.thesis as Array<{ ticker: string; status: string }>).find((t) => t.ticker === "ASML")!.status).toBe("HOLDING");
  });
});
