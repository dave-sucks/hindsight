/**
 * The account at the app's own prices, on the stand-in book of Tue Nov 10
 * (lib/agent/__fixtures__/account-2026-11-10.json): stand-in quantities and
 * cash, the real closes from the quote path, and the real prices the broker
 * marked each holding at 2:37 AM that night, after-hours prints (MU at
 * $756.70 against its $725.11 close).
 *
 * At the broker's marks the stand-in book is worth $96,793.85; at the close it
 * is $95,802.32, down $1,475.68 on the day against Monday's closing $97,278.00.
 */
import nov10 from "@/lib/agent/__fixtures__/account-2026-11-10.json";
import { dayChangeAt, priceBook } from "./value-at-quotes";

const quotes = Object.fromEntries(
  Object.entries(nov10.quotes).map(([s, q]) => [s, { quote: { ...q, d: null, dp: null, o: null, h: null, l: null, source: "alpaca" as const } }]),
);
const cash = Number(nov10.broker.cash);
const mondayClose = Number(nov10.broker.last_equity);
/** The broker's prior close that evening: Monday's close (balance_asof Nov 9). */
const monday = { equity: mondayClose, asOf: nov10.broker.balance_asof };
const DAY = { dollars: -1475.68, pct: -1.517 };

describe("the Nov 10 book at the app's own prices", () => {
  const book = priceBook(cash, nov10.positions, quotes, false);

  it("each holding at its close, never the broker's after-hours mark: MU at $725.11, not $756.70", () => {
    expect(nov10.positions.find((p) => p.symbol === "MU")!.current_price).toBe("756.7");
    expect(book.held.find((h) => h.ticker === "MU")).toMatchObject({ qty: 12, price: 725.11 });
    expect(book.value).toBeCloseTo(95_802.32, 2);
    expect(book.closeOf).toBe("2026-11-10");
    expect(book.unquoted).toEqual([]);
  });

  it("the day at the close against Monday's closing equity, not against the broker's after-hours marks", () => {
    expect(Number(nov10.broker.equity) - mondayClose).toBeCloseTo(-484.15, 2);
    const day = dayChangeAt(book, monday, [], "2026-11-10")!;
    expect(day.dollars).toBeCloseTo(DAY.dollars, 2);
    expect(day.pct).toBeCloseTo(DAY.pct, 3);
  });

  it("once the broker has moved its prior close to Tuesday's (balance_asof Nov 10, as read live at 3:16 AM), the day is Tuesday's digest figure, and nothing without one", () => {
    const rolled = { equity: Number(nov10.brokerRolled.last_equity), asOf: nov10.brokerRolled.balance_asof };
    expect(rolled.equity).toBeCloseTo(book.value, 2);
    expect(dayChangeAt(book, rolled, [], "2026-11-11", DAY)).toEqual(DAY);
    expect(dayChangeAt(book, rolled, [], "2026-11-11")).toBeNull();
  });

  it("a deposit the day before, read before the next open, is never the day's loss", () => {
    // $10,000 posted on Nov 10; at 8 AM on Nov 11 it is inside the cash and inside Tuesday's closing equity.
    const funded = priceBook(cash + 10_000, nov10.positions, quotes, false);
    const deposit = [{ date: "2026-11-10", amount: 10_000 }];
    const rolled = { equity: Number(nov10.brokerRolled.last_equity) + 10_000, asOf: "2026-11-10" };
    expect(dayChangeAt(funded, rolled, deposit, "2026-11-11", DAY)!.dollars).toBeCloseTo(DAY.dollars, 2);
    expect(dayChangeAt(funded, rolled, deposit, "2026-11-11")).toBeNull();
    // Before the broker moves on, the deposit is after Monday's close and comes off.
    expect(dayChangeAt(funded, monday, deposit, "2026-11-11")!.dollars).toBeCloseTo(DAY.dollars, 2);
  });

  it("a deposit posted before today's open, dated today, comes off the session's change", () => {
    const funded = priceBook(cash + 5_000, nov10.positions, quotes, true);
    expect(dayChangeAt(funded, monday, [{ date: "2026-11-10", amount: 5_000 }], "2026-11-10")!.dollars).toBeCloseTo(DAY.dollars, 2);
  });

  it("a buy filled today counts at what it cost, with no deposit", () => {
    // 10 shares of a new holding bought at $100 out of cash, now $110: the day is $100 better.
    const bought = priceBook(cash - 1_000, [...nov10.positions, { symbol: "XYZ", qty: "10", side: "long", current_price: "111" }], { ...quotes, XYZ: { quote: { ...quotes.MU.quote, c: 110, pc: 95 } } }, false);
    expect(dayChangeAt(bought, monday, [], "2026-11-10")!.dollars).toBeCloseTo(DAY.dollars + 100, 2);
  });

  it("in the session the value is at the latest trades and names no close", () => {
    expect(priceBook(cash, nov10.positions, quotes, true).closeOf).toBeNull();
  });

  it("a holding no vendor priced is valued at the broker's price, and the value is then no close", () => {
    const { MU: _mu, ...rest } = quotes;
    const partial = priceBook(cash, nov10.positions, rest, false);
    expect(partial.unquoted).toEqual(["MU"]);
    expect(partial.held.find((h) => h.ticker === "MU")!.price).toBe(756.7);
    expect(partial.closeOf).toBeNull();
  });
});
