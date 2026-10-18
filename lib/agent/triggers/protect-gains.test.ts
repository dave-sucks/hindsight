/**
 * The Protect-gains line, and what turning it on does to the account's 12
 * holdings at 13:36 ET on 2026-10-16 (lib/agent/__fixtures__/book-2026-10-16.ts).
 */
import { BOOK } from "@/lib/agent/__fixtures__/book-2026-10-16";
import { floorDue, nextProtectHigh, protectBreached, protectGainsOf, protectLine, raiseWords, type ProtectGains } from "./protect-gains";

const A3G5: ProtectGains = { startPct: 3, giveBackPct: 5 };
const A1G2: ProtectGains = { startPct: 1, giveBackPct: 2 };

describe("the line", () => {
  const long = { avgCost: 100, isLong: true };
  it("has no line until the high is startPct over the buy price", () => {
    expect(protectLine(long, 102.99, A3G5)).toBeNull();
    expect(protectLine(long, 103, A3G5)).toBe(100);
  });
  it("is the give-back from the high, never below the buy price", () => {
    expect(protectLine(long, 104, A3G5)).toBe(100); // 98.80 would sit under the buy price
    expect(protectLine(long, 120, A3G5)).toBe(114);
  });
  it("mirrors for a short", () => {
    const short = { avgCost: 100, isLong: false };
    expect(protectLine(short, 97.5, A3G5)).toBeNull();
    expect(protectLine(short, 90, A3G5)).toBe(94.5);
    expect(protectBreached(94.5, 94.5, false)).toBe(true);
  });
  it("is off until the account turns it on", () => {
    expect(protectGainsOf({ protectGainsOn: false, protectGainsStartPct: 3 })).toBeNull();
    expect(protectGainsOf({ protectGainsOn: true, protectGainsStartPct: 1, protectGainsGiveBackPct: 2 })).toEqual(A1G2);
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
    expect(raiseWords(long, 130, 123.5, A3G5, 120).summary).toBe(
      "Floor raised to $123.50 to protect the gain (5% under the $130.00 high since Protect gains was turned on), past its $120.00 target",
    );
  });
});

describe("the high since it was turned on", () => {
  it("starts at the first fresh price, then only rises, and never on a stale one", () => {
    expect(nextProtectHigh({ protectHigh: null, isLong: true }, 110, true)).toBe(110);
    expect(nextProtectHigh({ protectHigh: 115, isLong: true }, 118, true)).toBe(118);
    expect(nextProtectHigh({ protectHigh: 115, isLong: true }, 112, true)).toBe(115);
    expect(nextProtectHigh({ protectHigh: 115, isLong: true }, 130, false)).toBe(115);
    expect(nextProtectHigh({ protectHigh: null, isLong: true }, 130, false)).toBeNull();
  });
});

describe("the 2026-10-16 13:36 book, turned on then", () => {
  /** Each holding's floor line, its high starting at the price then: none sells. */
  const book = (s: ProtectGains) =>
    Object.fromEntries(
      BOOK.map((b) => {
        const line = protectLine({ avgCost: b.avgCost, isLong: true }, nextProtectHigh({ protectHigh: null, isLong: true }, b.price, true), s);
        return [b.ticker, line == null ? "—" : `${line.toFixed(2)} ${protectBreached(b.price, line, true) ? "SELL" : "hold"}`];
      }),
    );
  it("nothing sells; only the holdings already up 3% / 1% get a floor line", () => {
    expect(book(A3G5)).toEqual({ AAPL: "—", ASML: "—", CEG: "—", CORT: "—", GEV: "—", IOT: "—", MSFT: "—", MU: "—", NVDA: "—", PLTR: "—", V: "381.55 hold", WST: "362.37 hold" });
    expect(book(A1G2)).toEqual({ AAPL: "336.57 hold", ASML: "—", CEG: "—", CORT: "—", GEV: "—", IOT: "—", MSFT: "—", MU: "—", NVDA: "—", PLTR: "—", V: "393.60 hold", WST: "373.82 hold" });
  });
});
