/**
 * system-prompt.test.ts — the daily run as a portfolio manager (DAV-253).
 * What the prompt deletes and adds, pinned; the prompt builder is pure.
 */
import { morningRunSent } from "@/lib/agent/__fixtures__/morning-run-sent";
import { dailyRunRequest } from "./system-prompt";
import { situationText } from "./situation-skills";
import type { RunInput } from "./run-input";

const runInput = {
  portfolio: { cash: 31000, buyingPower: 62000, portfolioValue: 100000, positions: [], exposure: { long: 0, short: 0, net: 0, utilizationPct: 0 } },
  watchlist: [],
  activeTheses: [],
 
  triggersFiredSinceLastRun: [],
  triggersMatchingNow: [{ thesisId: "t", ticker: "IOT", triggerId: "b", action: "ENTER", predicateSummary: "price above $39.55", rationale: "", matchDetail: "" }],
  earnings: { reportingSoon: [], justReported: [] },
  filings: { recent: [{ ticker: "PRAX", date: "2026-07-02", tier: "serious" as const, summary: "8-K — auditor change (4.01)", url: "https://www.sec.gov/prax" }] },
} as unknown as RunInput;

const prompt = morningRunSent({ name: "PEAD Specialist", maxPositionSize: 14000, minPositionSize: 3000 }, runInput);

describe("the morning run — the daily run as a portfolio manager", () => {
  it("deletes the per-horizon data discipline block and the three-path fired buy", () => {
    expect(prompt).not.toContain("Per-horizon data discipline");
    expect(prompt).not.toContain("THREE legal paths");
    expect(prompt).not.toContain("Retune the buy trigger");
  });
  it("a fired buy's answers are its skill's: a proposed buy is left alone, a pass leaves what it waits for, and nothing is refused", () => {
    // WST 2026-11-09 to 11-17: five proposals, the buy moved to that day's price after each. AAPL 11-13: the move withdrew the run's own proposal.
    const buy = situationText("BUY_ARRIVES", false);
    expect(buy).toContain("Leave the buy as it is: the proposal waits on it.");
    expect(buy).toContain("name it and leave the triggers saying what you wait for.");
    expect(buy).toContain("Today's price is no reason for a new buy price.");
    // A watch with no buy and no review is a stock nothing looks at again.
    expect(buy).toContain("take the buy off and keep a review that brings it back, or stop watching.");
    expect(buy).not.toContain("move the buy price to where the chart now puts it");
    // Plan checks were deleted (2026-11-13): no text points at one.
    expect(buy).not.toMatch(/plan.check/);
    expect(prompt).not.toContain("a fired buy is a decision with two answers");
  });
  it("the prompt does not restate the deleted plan checks", () => {
    expect(prompt).not.toContain("give it a wake, or let it go");
  });
  it("regime and cash are inputs: the rules are its own text, and the kickoff names today's stocks at their buy price", () => {
    expect(prompt).toContain("## Regime and cash");
    expect(prompt).toContain("Your cash is in the portfolio snapshot.");
    expect(prompt).toContain("Watched stocks at their buy price this morning: IOT.");
    expect(prompt).toContain("Cautious** (SPY more than 1% under its 50-day)");
    expect(prompt).toContain("Risk-off** (SPY more than 1% under its 200-day)");
  });
  it("filings on the book this week are listed, and a held name's review runs its setup's checklist", () => {
    expect(prompt).toContain("## Filings on your book this week");
    expect(prompt).toContain("PRAX 2026-07-02 — 8-K — auditor change (4.01) · serious");
    // The playbook's checklist is the review skill's, and the filing's reading is the filing skill's.
    expect(situationText("REVIEW_DUE", true)).toContain("3. Is the playbook still working? Check its failure signs and its time limit.");
    expect(situationText("FILING", true)).toContain("1. What does the document say? Read it.");
    expect(prompt).not.toContain("REVIEW from a filing trigger");
  });
});

// DAV-292 — the run is told how full the analyst is. Replay: the Secular
// Compounder on 2026-09-18 held ABT, ASML, CEG and WST against a limit of 4,
// with ETN's buy live; the PEAD Specialist held 4 of 6.
describe("the morning run — the analyst's room", () => {
  const pos = (symbol: string) => ({ symbol, direction: "LONG", quantity: 10, avgCost: 100, currentPrice: 101, unrealizedPnl: 10, unrealizedPnlPct: 1, targetPrice: null });
  const withBook = (symbols: string[]) =>
    ({ ...runInput, portfolio: { ...(runInput as unknown as { portfolio: object }).portfolio, positions: symbols.map(pos) } }) as unknown as RunInput;

  it("Compounder, 4 of 4: says it is full and what it holds; what to do with a buy that fired is the buy tool's refusal", () => {
    const p = morningRunSent(
      { name: "Secular Compounder", maxPositionSize: 10000, minPositionSize: 4000, maxOpenPositions: 4 },
      withBook(["ABT", "ASML", "CEG", "WST"]),
    );
    expect(p).toContain("Positions: 4 of 4 — this analyst is FULL.");
    expect(p).toContain("It holds $ABT, $ASML, $CEG, $WST.");
    expect(p).not.toContain("**This analyst is full.**");
    expect(situationText("BUY_ARRIVES", false)).not.toMatch(/full|slot/);
  });

  it("PEAD, 4 of 6: says two are free and carries no full-analyst rule", () => {
    const p = morningRunSent(
      { name: "PEAD Specialist", maxPositionSize: 14000, minPositionSize: 3000, maxOpenPositions: 6 },
      withBook(["FIVE", "IOT", "MU", "NVDA"]),
    );
    expect(p).toContain("Positions: 4 of 6 — 2 free.");
    expect(p).not.toContain("**This analyst is full.**");
  });
});

describe("the morning run — the Market and portfolio block", () => {
  const block = "## Market and portfolio\n\n### Portfolio snapshot\nThe account, stand-in";
  it("prints the block in the first message, after the date line and before the book's week", () => {
    const now = new Date("2026-07-06T12:00:00Z");
    const r = dailyRunRequest({ name: "PEAD Specialist", maxPositionSize: 14000, minPositionSize: 3000 }, { ...runInput, portfolioPieces: [{ id: "portfolio_snapshot", text: "### Portfolio snapshot\nThe account, stand-in" }] }, now);
    expect(r.message.startsWith(`Mon, Jul 6, 2026, 8:00 AM ET, the PAPER account.\n\n${block}\n\n## Filings on your book this week`)).toBe(true);
    expect(r.instructions).not.toContain("## Market and portfolio");
  });
});
