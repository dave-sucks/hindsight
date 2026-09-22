/**
 * system-prompt.sold-review.test.ts — the built daily-run prompt tells the
 * run what `sold_to_review` is and what it owes each row (DAV-240).
 *
 * Same shape as system-prompt.capacity.test.ts, and for the same reason: a
 * block `get_theses` returns that the prompt never names is decoration. The
 * run reads the book paragraph to learn what is in the response; a list it
 * was never told about is a list it walks past.
 *
 * SMMT is the live case — sold 2026-09-21 at $16.92 for +$1,157.94 on a
 * protective stop, eight weeks before the November 14 PDUFA it was bought
 * for. 163 stocks sold, 9 ever back on the watchlist.
 */
import { buildDailyRunSystemPromptV2 } from "./system-prompt";
import type { RunInput } from "./run-input";

const runInput = () =>
  ({
    analyst: {
      name: "Catalyst Event PM", mandate: null, voice: null, directionBias: "LONG_ONLY",
      holdDurations: ["SWING"], sectors: [], industries: [], themes: [],
      marketCapMin: null, marketCapMax: null, exclusionList: [],
      minConfidence: 70, minPositionSize: 3000, maxPositionSize: 14000, maxOpenPositions: 6,
    },
    portfolio: {
      cash: 31000, buyingPower: 62000, portfolioValue: 100000, positions: [],
      exposure: { long: 0, short: 0, net: 0, utilizationPct: 0 },
    },
    watchlist: [], activeTheses: [], performance: null, recentClosedTrades: [],
    priorityReviews: [], triggersFiredSinceLastRun: [], triggersMatchingNow: [],
    latestDigest: null, earnings: { reportingSoon: [], justReported: [] },
    filings: { recent: [] }, intelligencePolicy: { maxSignalsPerRun: 0 },
  }) as unknown as RunInput;

const prompt = () =>
  buildDailyRunSystemPromptV2(
    { name: "Catalyst Event PM", minConfidence: 70, maxPositionSize: 14000, minPositionSize: 3000, maxOpenPositions: 6 },
    runInput(),
  );

describe("the built prompt names the sold-stock review", () => {
  it("names the block get_theses returns", () => {
    expect(prompt()).toContain("`sold_to_review`");
  });

  it("says it is work today, and that each row gets one answer", () => {
    const p = prompt();
    expect(p).toContain("Every one of them is work today, and each gets exactly one answer");
  });

  it("names all four answers the run already has", () => {
    const p = prompt();
    expect(p).toContain("keep watching with a re-entry level priced off today's chart");
    expect(p).toContain("keep watching on a review cadence");
    expect(p).toContain("keep watching with nothing set (legal, and it costs nothing)");
    expect(p).toContain("or let it go");
  });

  it("names the exact call that puts one back on watch, and how to clear the rest", () => {
    const p = prompt();
    expect(p).toContain('update_thesis(change_status: "WATCHING")');
    expect(p).toContain("write the one-line reason on an `update_thesis` and it clears");
  });

  it("says what each row carries, so the run knows it has the sale's facts", () => {
    const p = prompt();
    expect(p).toContain("the exit price, the date, why it sold, whether the belief survived");
  });

  // The paragraph it was added to still has to say what it said before.
  it("leaves the rest of the book paragraph intact", () => {
    const p = prompt();
    expect(p).toContain("`quiet_theses` is the one-line roster");
    expect(p).toContain("buyBlockedByFull");
  });
});
