/**
 * Paper approval off, Live approval on: the setting the owner trades with.
 *
 * Each kind of trade an agent can make (a buy, a full sale, a trim, an add),
 * through the tool's real entry point, once on each book. On Live it waits
 * for approval and nothing reaches the broker. On Paper it is sent, on the
 * Paper keys and the Paper book, and never on the Live ones.
 */
import { replayTool, thesisRow, agentConfigRow, accountRow, positionRow, type Replay } from "@/lib/replay";

type Book = "PAPER" | "LIVE";
const SWITCHES = { requireApprovalBuysPaper: false, requireApprovalSellsPaper: false, requireApprovalBuysLive: true, requireApprovalSellsLive: true };
const KEYS: Record<Book, { keyId: string; secretKey: string; baseUrl?: string }> = {
  PAPER: { keyId: "PK_paper", secretKey: "s" },
  LIVE: { keyId: "AK_live", secretKey: "s", baseUrl: "https://api.alpaca.markets" },
};

const run = (tool: [string, string], book: Book, args: Record<string, unknown>, held: boolean) =>
  replayTool(tool[0], tool[1], {
    seed: {
      account: [accountRow(SWITCHES)],
      agentConfig: [agentConfigRow({ tradingEnvironment: book, minPositionSize: 2000, maxPositionSize: 8000, maxPositionTotal: 30000 })],
      thesis: [thesisRow({ id: "t_aaa", ticker: "AAA", status: held ? "HOLDING" : "WATCHING", direction: "LONG", setupId: "PEAD", conviction: "MEDIUM" })],
      position: held ? [positionRow({ symbol: "AAA", environment: book, quantity: 100, avgCost: 100, stopLoss: 90 })] : [],
    },
    args,
    ctx: { runMode: "INTRADAY_TACTICAL", runEnvironment: book, alpacaCreds: KEYS[book], minPositionSize: 2000, maxPositionSize: 8000, maxPositionTotal: 30000, maxOpenPositions: 6 },
    quotes: { AAA: 110 },
    mocks: { "@/lib/actions/api-keys.actions": () => ({ resolveAlpacaCredentials: async (_user: string, b: Book) => KEYS[b] }) },
  });

const TRADES: Array<[string, (book: Book) => Promise<Replay>]> = [
  ["a buy", (b) => run(["place-trade", "placeTrade"], b, { ticker: "AAA", direction: "LONG", entry_price: 110, sell_if_below: 99, sell_reason: "Under the base.", thesis_id: "t_aaa" }, false)],
  ["a full sale", (b) => run(["sell", "sell"], b, { ticker: "AAA", note: "Selling it." }, true)],
  ["a trim", (b) => run(["sell", "sell"], b, { ticker: "AAA", percent: 30, note: "Taking some off." }, true)],
  ["an add", (b) => run(["add", "add"], b, { ticker: "AAA", note: "Adding to the winner." }, true)],
];

const orders = (r: Replay) => (r.db.store.order ?? []) as Array<{ status: string; environment: string }>;

describe.each(TRADES)("%s, with Paper approval off and Live approval on", (_name, trade) => {
  it("on Live: waits for approval, and nothing reaches the broker", async () => {
    const r = await trade("LIVE");
    expect(r.crashed).toBe(false);
    expect(orders(r).map((o) => [o.environment, o.status])).toEqual([["LIVE", "AWAITING_APPROVAL"]]);
    expect(r.sends).toEqual([]);
  });

  it("on Paper: sent once, on the Paper keys and the Paper book", async () => {
    const r = await trade("PAPER");
    expect(orders(r).map((o) => o.environment)).toEqual(["PAPER"]);
    expect(orders(r)[0].status).not.toBe("AWAITING_APPROVAL");
    expect(r.sends).toHaveLength(1);
    expect(r.sends[0].args).toContain("PAPER");
    expect(r.sends[0].args).toContainEqual(KEYS.PAPER);
    expect(r.sends[0].args).not.toContain("LIVE");
    expect(r.sends[0].args).not.toContainEqual(KEYS.LIVE);
  });
});
