/**
 * An order goes out on its own book's keys and host, or not at all.
 *
 * The keys below are the two rows production holds (2026-11-19): the Paper
 * slot with no saved address, the Live slot on api.alpaca.markets. Before
 * this, an order whose keys could not be read went out on the server's env
 * keys, and nothing checked that a Paper order's keys pointed at Paper.
 */
const made: Array<{ baseUrl: string; keyId: string }> = [];
const sent: string[] = [];
jest.mock("@alpacahq/alpaca-trade-api", () =>
  class {
    constructor(cfg: { baseUrl: string; keyId: string }) {
      made.push({ baseUrl: cfg.baseUrl, keyId: cfg.keyId });
    }
    createOrder = async (o: { symbol: string }) => (sent.push(`order ${o.symbol}`), { id: "alp_1" });
    closePosition = async (s: string) => (sent.push(`close ${s}`), { id: "alp_2" });
    cancelOrder = async (id: string) => void sent.push(`cancel ${id}`);
  },
);

import { cancelOrder, closePosition, closePositionPartial, OrderRefused, placeMarketOrder, type AlpacaCredentials, type Book } from "@/lib/alpaca";

const PAPER: AlpacaCredentials = { keyId: "PK_paper", secretKey: "s" };
const LIVE: AlpacaCredentials = { keyId: "AK_live", secretKey: "s", baseUrl: "https://api.alpaca.markets" };
const PAPER_HOST = "https://paper-api.alpaca.markets";

/** Every way the app sends, closes or cancels an order. */
const SENDERS: Array<[string, (keys: AlpacaCredentials | null | undefined, book: Book) => Promise<unknown>]> = [
  ["placeMarketOrder", (k, b) => placeMarketOrder({ symbol: "NVDA", qty: 1, side: "buy" }, k, b)],
  ["closePositionPartial", (k, b) => closePositionPartial("NVDA", 1, "sell", k, b, "idem-1")],
  ["closePosition", (k, b) => closePosition("NVDA", k, b)],
  ["cancelOrder", (k, b) => cancelOrder("alp_9", k, b)],
];

beforeEach(() => {
  made.length = 0;
  sent.length = 0;
  process.env.ALPACA_API_KEY = "ENV_KEY";
  process.env.ALPACA_API_SECRET = "ENV_SECRET";
  process.env.ALPACA_BASE_URL = "https://api.alpaca.markets";
});

describe.each(SENDERS)("%s", (_name, send) => {
  it("keys that could not be read: refused, never sent on the server's env keys", async () => {
    for (const keys of [undefined, null]) await expect(send(keys, "PAPER")).rejects.toBeInstanceOf(OrderRefused);
    expect([made, sent]).toEqual([[], []]);
  });

  it("a Paper order whose keys point at the Live address is refused", async () => {
    await expect(send(LIVE, "PAPER")).rejects.toThrow(/Paper order's keys point at https:\/\/api\.alpaca\.markets/);
    expect([made, sent]).toEqual([[], []]);
  });

  it("a Live order is refused on Paper keys, with or without a saved address", async () => {
    await expect(send(PAPER, "LIVE")).rejects.toBeInstanceOf(OrderRefused);
    await expect(send({ ...PAPER, baseUrl: PAPER_HOST }, "LIVE")).rejects.toBeInstanceOf(OrderRefused);
    expect([made, sent]).toEqual([[], []]);
  });

  it("a book that is neither Paper nor Live is refused", async () => {
    await expect(send(PAPER, "paper" as Book)).rejects.toBeInstanceOf(OrderRefused);
    expect(sent).toEqual([]);
  });

  it("each book's own keys go to its own address", async () => {
    await send(PAPER, "PAPER");
    await send(LIVE, "LIVE");
    expect(made).toEqual([{ baseUrl: PAPER_HOST, keyId: "PK_paper" }, { baseUrl: "https://api.alpaca.markets", keyId: "AK_live" }]);
    expect(sent).toHaveLength(2);
  });
});

it("a refused order reads as a definite no (4xx), so its row is marked REJECTED and not left PENDING", async () => {
  const err = await placeMarketOrder({ symbol: "NVDA", qty: 1, side: "buy" }, null, "LIVE").catch((e) => e);
  expect(err.statusCode).toBe(403);
});
