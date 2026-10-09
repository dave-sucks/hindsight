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
import { SITUATIONS } from "./situations";

const runInput = () =>
  ({
    portfolio: {
      cash: 31000, buyingPower: 62000, portfolioValue: 100000, positions: [],
      exposure: { long: 0, short: 0, net: 0, utilizationPct: 0 },
    },
    watchlist: [], activeTheses: [],
    priorityReviews: [], triggersFiredSinceLastRun: [], triggersMatchingNow: [],
    earnings: { reportingSoon: [], justReported: [] },
    filings: { recent: [] },
  }) as unknown as RunInput;

const prompt = () =>
  buildDailyRunSystemPromptV2(
    { name: "Catalyst Event PM", minConfidence: 70, maxPositionSize: 14000, minPositionSize: 3000, maxOpenPositions: 6 },
    runInput(),
  );

describe("the built prompt names the sold-stock review; the answers arrive as guidance", () => {
  it("names the block get_theses returns, and says every entry is work today", () => {
    const p = prompt();
    expect(p).toContain("`sold_to_review`");
    expect(p).toContain("every `sold_to_review` entry");
  });

  it("the four answers, the call that puts one back on watch and how the rest clears are SOLD_ONE_REVIEW's", () => {
    const g = SITUATIONS.SOLD_ONE_REVIEW.guidance;
    expect(g).toContain("Keep watching with a re-entry level priced off today's chart.");
    expect(g).toContain("Keep watching on a review cadence.");
    expect(g).toContain("Keep watching with nothing set (legal, and it costs nothing).");
    expect(g).toContain("Let it go.");
    expect(g).toContain('change_status "WATCHING"');
    expect(g).toContain("write the one-line reason on an update_thesis and it clears");
    expect(g).toContain("the exit price, the date, why it sold, whether the belief survived");
  });

  it("the prompt no longer carries its own copy", () => {
    expect(prompt()).not.toContain("keep watching on a review cadence");
  });

  // The paragraph it sits in still has to say what it said before.
  it("leaves the rest of the book paragraph intact", () => {
    const p = prompt();
    expect(p).toContain("the one-line entries in `quiet_theses` are not today's work");
    expect(p).toContain("`guidance`");
  });
});
