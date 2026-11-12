/**
 * The portfolio snapshot: the one set of numbers the digest and the agents
 * read. Stand-in amounts (lib/agent/__fixtures__/portfolio-snapshot-standin.ts).
 */
import { buildSnapshot, snapshotText } from "./snapshot";
import { STANDIN_INPUTS, STANDIN_SNAPSHOT } from "@/lib/agent/__fixtures__/portfolio-snapshot-standin";

describe("the portfolio snapshot's numbers", () => {
  it("values the account at its prices: cash plus every holding", () => {
    // 40,000 + 100 × 250 + 50 × 300
    expect(STANDIN_SNAPSHOT.value).toBe(80_000);
    expect(STANDIN_SNAPSHOT.holdings.map((h) => [h.ticker, h.value, Number(h.share!.toFixed(2))])).toEqual([
      ["AAA", 25_000, 31.25],
      ["BBB", 15_000, 18.75],
    ]);
  });

  it("the day is each holding's move from the prior close; since started is value less the money put in", () => {
    // AAA +10 × 100, BBB −10 × 50
    expect(STANDIN_SNAPSHOT.dayChange!.dollars).toBe(500);
    expect(STANDIN_SNAPSHOT.dayChange!.pct).toBeCloseTo((500 / 79_500) * 100, 6);
    expect(STANDIN_SNAPSHOT.lifetime).toEqual({ dollars: -20_000, pct: -20, contributed: 100_000 });
    const bbb = STANDIN_SNAPSHOT.holdings.find((h) => h.ticker === "BBB")!;
    expect(bbb.sinceBought).toEqual({ dollars: -5_000, pct: -25 });
  });

  it("a buy filled that day moves from its fill price, not the prior close", () => {
    const s = buildSnapshot({
      ...STANDIN_INPUTS,
      trades: [{ at: "2026-11-11T15:00:00.000Z", side: "BUY", ticker: "AAA", shares: 100, price: 245, prevClose: 240, analyst: null }],
    });
    expect(s.holdings.find((h) => h.ticker === "AAA")!.day!.dollars).toBe(500);
  });

  it("a sale that day counts what the sold shares made against the prior close", () => {
    const s = buildSnapshot({
      ...STANDIN_INPUTS,
      trades: [{ at: "2026-11-11T15:00:00.000Z", side: "SELL", ticker: "DDD", shares: 20, price: 105, prevClose: 100, analyst: null }],
    });
    expect(s.dayChange!.dollars).toBe(500 + 100);
  });

  it("a holding with no price is valued at cost, named, and leaves the day unknown", () => {
    const s = buildSnapshot({ ...STANDIN_INPUTS, holdings: [...STANDIN_INPUTS.holdings, { ticker: "EEE", shares: 10, avgCost: 50, price: null, prevClose: null, analyst: null }] });
    expect(s.value).toBe(80_500);
    expect(s.dayChange).toBeNull();
    expect(s.unpriced).toEqual(["EEE"]);
    expect(snapshotText(s)).toContain("No price for EEE: valued at what was paid.");
  });

  it("no money put in that can be read: since started says so", () => {
    expect(buildSnapshot({ ...STANDIN_INPUTS, contributed: null }).lifetime).toBeNull();
  });
});

describe("the snapshot's text", () => {
  const text = snapshotText(STANDIN_SNAPSHOT);

  it("reads as the account, the holdings, the day's trades and the proposals waiting", () => {
    expect(text.split("\n")).toEqual([
      "Your portfolio, Wed, Nov 11 at the 4:00 PM close",
      "Value $80,000.00 · cash $40,000.00 (50.0% of the account)",
      "Wed, Nov 11: +0.6% (+$500) · since you started: −20.0% (−$20,000) on $100,000 put in",
      "",
      "Holdings (2), largest first:",
      "- AAA: 100 shares at $250.00 = $25,000 (31.3%) · day +4.2% (+$1,000) · since bought at $200.00: +25.0% (+$5,000) · Analyst One",
      "- BBB: 50 shares at $300.00 = $15,000 (18.8%) · day −3.2% (−$500) · since bought at $400.00: −25.0% (−$5,000) · Analyst Two",
      "",
      "Bought or sold on Wed, Nov 11: nothing.",
      "",
      "Waiting for your approval (proposals, not trades, until you approve them):",
      '- Sell 50 shares of BBB, proposed 9 times since Tue, Oct 20 · Analyst Two. Its reason: "BBB closed under your sell line again, and I proposed selling all 50 shares. Nothing new broke at the company today."',
      '- Buy 10 shares of CCC, proposed Wed, Nov 11 · Analyst One. Its reason: "CCC crossed your buy level after a strong quarter."',
    ]);
  });

  it("carries no ids, no run logs and no borrowing money", () => {
    expect(text).not.toMatch(/\b(run|thesis|analyst):|cm[a-z0-9]{20,}|status COMPLETE|buying power|idle cash/i);
  });

  it("in the session it says the time and that the prices are live", () => {
    const live = snapshotText(buildSnapshot({ ...STANDIN_INPUTS, live: true, at: "2026-11-11T19:14:00.000Z" }));
    expect(live.split("\n")[0]).toBe("Your portfolio, Wed, Nov 11, 2:14 PM ET (market open, latest prices)");
    expect(live.split("\n")[2]).toMatch(/^Today: /);
  });

  it("cuts a long reason at its last full sentence, never inside an abbreviation", () => {
    const note =
      "Palantir is bouncing today, but the stock is still being repriced after earnings because bookings slowed even as revenue and guidance went up, and I would hold rather than approve the sale. The company did raise full-year guidance and U.S. commercial revenue grew again, which keeps the reason we own it intact for now.";
    const s = snapshotText(buildSnapshot({ ...STANDIN_INPUTS, waiting: [{ ...STANDIN_INPUTS.waiting[0], note }] }));
    expect(s).toContain('Its reason: "Palantir is bouncing today, but the stock is still being repriced after earnings because bookings slowed even as revenue and guidance went up, and I would hold rather than approve the sale."');
  });
});
