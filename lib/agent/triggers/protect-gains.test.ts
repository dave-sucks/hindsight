/**
 * The Protect-gains line, and what it does to the account's 12 holdings at
 * 13:36 ET on 2026-10-16 (lib/agent/__fixtures__/book-2026-10-16.ts) under
 * both ways of counting the high.
 */
import { BOOK } from "@/lib/agent/__fixtures__/book-2026-10-16";
import { floorDue, nextProtectHigh, protectBreached, protectGainsOf, protectLine, raiseWords, type ProtectGains } from "./protect-gains";

const A3G5 = (from: ProtectGains["from"]): ProtectGains => ({ startPct: 3, giveBackPct: 5, from });
const A1G2 = (from: ProtectGains["from"]): ProtectGains => ({ startPct: 1, giveBackPct: 2, from });

describe("the line", () => {
  const long = { avgCost: 100, isLong: true };
  it("has no line until the high is startPct over the buy price", () => {
    expect(protectLine(long, 102.99, A3G5("NOW"))).toBeNull();
    expect(protectLine(long, 103, A3G5("NOW"))).toBe(100);
  });
  it("is the give-back from the high, never below the buy price", () => {
    expect(protectLine(long, 104, A3G5("NOW"))).toBe(100); // 98.80 would sit under the buy price
    expect(protectLine(long, 120, A3G5("NOW"))).toBe(114);
  });
  it("mirrors for a short", () => {
    const short = { avgCost: 100, isLong: false };
    expect(protectLine(short, 97.5, A3G5("NOW"))).toBeNull();
    expect(protectLine(short, 90, A3G5("NOW"))).toBe(94.5);
    expect(protectBreached(94.5, 94.5, false)).toBe(true);
  });
  it("is off until the account turns it on", () => {
    expect(protectGainsOf({ protectGainsOn: false, protectGainsStartPct: 3 })).toBeNull();
    expect(protectGainsOf({ protectGainsOn: true, protectGainsStartPct: 1, protectGainsGiveBackPct: 2, protectGainsFrom: "BUY" })).toEqual(A1G2("BUY"));
  });
});

describe("when the floor moves", () => {
  const long = { avgCost: 100, isLong: true };
  it("the first raise, from under the buy price, always lands", () => {
    expect(floorDue(long, 90, 100)).toBe(true);
    expect(floorDue(long, null, 100)).toBe(true);
  });
  it("after that, only in steps of at least 1%", () => {
    expect(floorDue(long, 100, 100.99)).toBe(false);
    expect(floorDue(long, 100, 101)).toBe(true);
    expect(floorDue(long, 110, 110.5)).toBe(false);
  });
  it("a floor raised past the target says so", () => {
    expect(raiseWords(long, 130, 123.5, { startPct: 3, giveBackPct: 5, from: "BUY" }, 120).summary).toBe(
      "Floor raised to $123.50 to protect the gain (5% under the $130.00 high since the buy), past its $120.00 target",
    );
  });
});

describe("the high", () => {
  const p = { protectHigh: null, peakPrice: 120, isLong: true };
  it("starts at the tracked high since the buy, or at the price now", () => {
    expect(nextProtectHigh(p, 110, true, A3G5("BUY"))).toBe(120);
    expect(nextProtectHigh(p, 110, true, A3G5("NOW"))).toBe(110);
  });
  it("only rises, and never on a stale price", () => {
    expect(nextProtectHigh({ ...p, protectHigh: 115 }, 118, true, A3G5("NOW"))).toBe(118);
    expect(nextProtectHigh({ ...p, protectHigh: 115 }, 112, true, A3G5("NOW"))).toBe(115);
    expect(nextProtectHigh({ ...p, protectHigh: 115 }, 130, false, A3G5("NOW"))).toBe(115);
    expect(nextProtectHigh(p, 130, false, A3G5("NOW"))).toBeNull();
  });
});

/** Each holding at 13:36: the line, and whether it sells now, the way the trigger check reads it. */
function book(s: ProtectGains) {
  return Object.fromEntries(
    BOOK.map((b) => {
      const high = nextProtectHigh({ protectHigh: null, peakPrice: b.peakPrice, isLong: true }, b.price, true, s);
      const line = protectLine({ avgCost: b.avgCost, isLong: true }, high, s);
      return [b.ticker, line == null ? "—" : `${line.toFixed(2)} ${protectBreached(b.price, line, true) ? "SELL" : "hold"}`];
    }),
  );
}

describe("the 2026-10-16 13:36 book", () => {
  it("counted from each buy, 3% / 5%: seven sell at once, every one below its buy price", () => {
    expect(book(A3G5("BUY"))).toEqual({
      AAPL: "333.57 hold", ASML: "1777.55 SELL", CEG: "292.68 SELL", CORT: "116.19 SELL", GEV: "997.82 SELL", IOT: "—",
      MSFT: "531.02 SELL", MU: "—", NVDA: "230.38 SELL", PLTR: "199.74 SELL", V: "383.88 hold", WST: "366.55 hold",
    });
    const sold = BOOK.filter((b) => book(A3G5("BUY"))[b.ticker].endsWith("SELL"));
    expect(Math.round(sold.reduce((sum, b) => sum + (b.price - b.avgCost) * b.quantity, 0))).toBe(-1943);
  });
  it("counted from each buy, 1% / 2%: the same seven", () => {
    expect(book(A1G2("BUY"))).toEqual({
      AAPL: "338.79 hold", ASML: "1833.68 SELL", CEG: "301.92 SELL", CORT: "119.86 SELL", GEV: "1029.33 SELL", IOT: "—",
      MSFT: "538.43 SELL", MU: "—", NVDA: "237.66 SELL", PLTR: "206.05 SELL", V: "396.00 hold", WST: "378.12 hold",
    });
  });
  it("counted from now: nothing sells when it is turned on; only the stocks already up start a line", () => {
    expect(book(A3G5("NOW"))).toEqual({ AAPL: "—", ASML: "—", CEG: "—", CORT: "—", GEV: "—", IOT: "—", MSFT: "—", MU: "—", NVDA: "—", PLTR: "—", V: "381.55 hold", WST: "362.37 hold" });
    expect(book(A1G2("NOW"))).toEqual({ AAPL: "336.57 hold", ASML: "—", CEG: "—", CORT: "—", GEV: "—", IOT: "—", MSFT: "—", MU: "—", NVDA: "—", PLTR: "—", V: "393.60 hold", WST: "373.82 hold" });
  });
});
