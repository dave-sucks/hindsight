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

describe("the Master Chat sells and adds for the stock's holder, in its book", () => {
  const sell = { ticker: "V", reason: "MANUAL", notes: "Selling V at $391 to raise cash; the payments thesis is intact but it is the smallest gain to give up." };
  const add = { symbol: "CEG", action: "add_to_position", reason: "Adding to CEG on the hold of the $270 base, per the seat's add rule." };
  const orders = (db: { store: Record<string, unknown[]> }) => db.store.order as Array<{ status: string; intent: string; quantity: number }>;

  it("a sale on the LIVE book waits for approval, as pinned; nothing is sent to the broker", async () => {
    const asPinned = await replayTool("close-position", "closePosition", { seed: seed(), ctx: pinned, args: sell, quotes: book.prices });
    const { result, db } = await replayTool("close-position", "closePosition", { seed: seed(), ctx: unpinned, args: sell, quotes: book.prices });
    expect(asPinned.result.data?.status).toBe("PROPOSED");
    expect(result.data).toMatchObject({ status: "PROPOSED", fillStatus: "AWAITING_APPROVAL" });
    expect(orders(db).map((o) => [o.intent, o.status])).toEqual([["CLOSE", "AWAITING_APPROVAL"]]);
  });

  it("an add the principal names past the most in one stock is refused at $20,000, as pinned", async () => {
    const over = { ...add, add_notional: 8000 };
    const asPinned = await replayTool("manage-position", "managePosition", { seed: seed(), ctx: pinned, args: over, quotes: book.prices });
    const { result, db } = await replayTool("manage-position", "managePosition", { seed: seed(), ctx: unpinned, args: over, quotes: book.prices });
    const message = (r: unknown) => (r as { data: { message: string } }).data.message;
    expect(message(result)).toMatch(/past the most this analyst may hold in one stock \(\$20000/);
    expect(message(result)).toBe(message(asPinned.result));
    expect(db.store.order ?? []).toEqual([]);
  });

  // Constructed: no stock is held by two analysts today.
  it("a stock two analysts hold gets a question naming both", async () => {
    const two = seed();
    two.position.push(positionRow({ id: "pos_v_pead", symbol: "V", analystId: "cmnhxpjio000004jvox6kl6c7", analyst: { name: "PEAD Specialist" }, accountId: REPLAY_ACCOUNT_ID, environment: "LIVE", status: "OPEN" }));
    two.position.find((p) => p.symbol === "V" && p.analystId === SECULAR)!.analyst = { name: "Secular Compounder" };
    const { result, db } = await replayTool("close-position", "closePosition", { seed: two, ctx: unpinned, args: sell, quotes: book.prices });
    expect(result.summary).toBe("$V is held by Secular Compounder (LIVE) and PEAD Specialist (LIVE). Which one? Pin the chat to that analyst and ask again.");
    expect(db.store.order ?? []).toEqual([]);
  });
});
