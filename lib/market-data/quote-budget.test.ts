/**
 * quote-budget.test.ts — who is refused when a vendor's minute runs low.
 *
 * 2026-09-15, 10:00 ET: the pages' quote polling had spent Finnhub's 60 calls
 * and ~29 stocks went unpriced on the trigger pass. The rule since: the
 * trigger check is never the caller that yields.
 */
import { mayCall, noteAllowance, resetQuoteBudget, withAllowance, QuoteHeldError, RESERVED_SHARE } from "./quote-budget";

const NOW = new Date("2026-09-15T14:00:00Z").getTime();
const said = (limit: number, remaining: number, resetInSeconds = 40) =>
  new Headers({
    "x-ratelimit-limit": String(limit),
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-reset": String(Math.floor(NOW / 1000) + resetInSeconds),
  });

beforeEach(() => resetQuoteBudget());

describe("before the vendor has said anything this minute", () => {
  it("nobody is refused", () => {
    expect(mayCall("alpaca:PK1", "other", NOW)).toBe(true);
    expect(mayCall("finnhub", "other", NOW)).toBe(true);
  });
});

describe("Alpaca — 10,000 a minute, a fifth held back", () => {
  it("everyone is served while more than the reserve is left", () => {
    noteAllowance("alpaca:PK1", said(10_000, 2_001), NOW);
    expect(mayCall("alpaca:PK1", "other", NOW)).toBe(true);
  });

  it("at the reserve, only the trigger check is served", () => {
    noteAllowance("alpaca:PK1", said(10_000, 10_000 * RESERVED_SHARE.alpaca), NOW);
    expect(mayCall("alpaca:PK1", "other", NOW)).toBe(false);
    expect(mayCall("alpaca:PK1", "trigger-check", NOW)).toBe(true);
  });

  it("the trigger check is served even when the vendor says nothing is left", () => {
    noteAllowance("alpaca:PK1", said(10_000, 0), NOW);
    expect(mayCall("alpaca:PK1", "trigger-check", NOW)).toBe(true);
  });

  it("one key running low does not hold another key's callers", () => {
    noteAllowance("alpaca:PK1", said(10_000, 5), NOW);
    expect(mayCall("alpaca:AK2", "other", NOW)).toBe(true);
  });

  it("the minute turns over and the refusal ends", () => {
    noteAllowance("alpaca:PK1", said(10_000, 5, 40), NOW);
    expect(mayCall("alpaca:PK1", "other", NOW + 39_000)).toBe(false);
    expect(mayCall("alpaca:PK1", "other", NOW + 40_000)).toBe(true);
  });
});

describe("Finnhub, the fallback — 60 a minute, 45 held back for a book falling back at once", () => {
  it("others stop at 45 left; the trigger check does not", () => {
    noteAllowance("finnhub", said(60, 46), NOW);
    expect(mayCall("finnhub", "other", NOW)).toBe(true);
    noteAllowance("finnhub", said(60, 45), NOW);
    expect(mayCall("finnhub", "other", NOW)).toBe(false);
    expect(mayCall("finnhub", "trigger-check", NOW)).toBe(true);
  });
});

describe("calls in flight count against what is left", () => {
  it("a burst cannot walk through the reserve between two replies", async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "setTimeout", "clearTimeout"] });
    try {
      noteAllowance("alpaca:PK1", said(10_000, 2_003));
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const started: number[] = [];
      const burst = Array.from({ length: 10 }, (_, i) =>
        withAllowance("alpaca:PK1", "other", async () => {
          started.push(i);
          await gate;
          return i;
        }).catch((e) => e),
      );
      release();
      const out = await Promise.all(burst);
      // 2,003 left, 2,000 reserved: three calls start, seven are refused unspent.
      expect(started).toEqual([0, 1, 2]);
      expect(out.filter((o) => o instanceof QuoteHeldError)).toHaveLength(7);
      expect(String(out[3])).toContain("held for the trigger check (rate limit reserve)");
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("a reply with no allowance on it", () => {
  it("changes nothing", () => {
    noteAllowance("alpaca:PK1", said(10_000, 5), NOW);
    noteAllowance("alpaca:PK1", new Headers(), NOW);
    noteAllowance("alpaca:PK1", undefined, NOW);
    expect(mayCall("alpaca:PK1", "other", NOW)).toBe(false);
  });
});
