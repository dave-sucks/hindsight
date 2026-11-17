import { CARDS_A_RUN, FULL_A_RUN, managerPick, managerRow } from "./card";
import { bookFlags } from "./book-table";

const names = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `T${from + i}`);

describe("the Portfolio Manager's read", () => {
  it("has no read of the whole book", () => {
    expect(managerPick({}, {}).refused).toMatch(/no read of the whole book/);
  });

  it("opens a limited number of stocks a run, whatever it asks for", () => {
    const ctx = {};
    const first = managerPick(ctx, { tickers: names(40) });
    expect(first.tickers).toHaveLength(CARDS_A_RUN);
    expect(first.note).toMatch(/Not opened: T8/);
    // A second call cannot open more; a stock already opened can be read again.
    expect(managerPick(ctx, { tickers: names(5, 20) }).refused).toBeTruthy();
    expect(managerPick(ctx, { tickers: ["t0"] }).tickers).toEqual(["T0"]);
  });

  it("opens fewer full cases, counted on their own", () => {
    const ctx = {};
    expect(managerPick(ctx, { tickers: names(6), full: true }).tickers).toHaveLength(FULL_A_RUN);
    expect(managerPick(ctx, { tickers: ["T5"], full: true }).refused).toBeTruthy();
  });

  it("a card is the belief, the triggers and the newest three lines, not the case", () => {
    const row = {
      ticker: "NVDA", status: "HOLDING", id: "th1", coreBelief: "Demand outruns supply.", invalidationConds: ["Orders fall"],
      bullCase: { bullets: [{ text: "bull" }] }, snapshot: "A long snapshot.", triggers: [{ id: "t1", says: "Sell if below $150" }],
      context: ["WHAT'S BEEN SAID", "  one", "  two", "  three", "  four", "Full history: …"].join("\n"),
    };
    const card = managerRow(row, false);
    expect(card.belief).toBe("Demand outruns supply.");
    expect(card.said).toEqual(["one", "two", "three"]);
    expect(card.bull_case).toBeUndefined();
    expect(card.snapshot).toBeUndefined();
    expect(managerRow(row, true).bull_case).toEqual(["bull"]);
  });
});

describe("what has been asked and said, on the stock's line", () => {
  const at = (d: string) => new Date(`${d}T15:00:00Z`);
  it("names a waiting trade, the declined and lapsed ones with how often, and the newest note of each author", () => {
    const flags = bookFlags(
      [
        { symbol: "MU", side: "SELL", intent: "CLOSE", status: "EXPIRED", createdAt: at("2026-11-10") },
        { symbol: "MU", side: "SELL", intent: "CLOSE", status: "EXPIRED", createdAt: at("2026-11-12") },
        { symbol: "MU", side: "SELL", intent: "PARTIAL_CLOSE", status: "AWAITING_APPROVAL", createdAt: at("2026-11-16") },
        { symbol: "MU", side: "BUY", intent: "OPEN", status: "FILLED", createdAt: at("2026-11-01") },
      ],
      [
        { author: "OWNER", tickers: ["MU"], body: "Holding through this.", impact: null, effect: null, createdAt: at("2026-11-11") },
        { author: "MARKET_REVIEWER", tickers: ["MU"], body: "x", impact: "high", effect: "weaker", createdAt: at("2026-11-14") },
        { author: "MARKET_REVIEWER", tickers: ["MU"], body: "x", impact: "low", effect: "neutral", createdAt: at("2026-11-09") },
      ],
    ).get("MU");
    expect(flags).toEqual([
      "a trim waits for the owner since Nov 16",
      "a sale lapsed unanswered 2 times, last Nov 12",
      "Market Reviewer Nov 14: weaker, high impact",
      `the owner's note Nov 11: "Holding through this."`,
    ]);
  });
});
