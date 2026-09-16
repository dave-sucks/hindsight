/**
 * system-prompt.test.ts — the daily run as a portfolio manager (DAV-253).
 * What the prompt deletes and adds, pinned; the prompt builder is pure.
 */
import { buildDailyRunSystemPromptV2 } from "./system-prompt";
import type { RunInput } from "./run-input";

const runInput = {
  analyst: { name: "PEAD Specialist", mandate: null, voice: null, directionBias: "LONG_ONLY", holdDurations: ["SWING"], sectors: [], industries: [], themes: [], marketCapMin: null, marketCapMax: null, exclusionList: [], minConfidence: 70, minPositionSize: 3000, maxPositionSize: 14000, maxOpenPositions: 6 },
  portfolio: { cash: 31000, buyingPower: 62000, portfolioValue: 100000, positions: [], exposure: { long: 0, short: 0, net: 0, utilizationPct: 0 } },
  watchlist: [],
  activeTheses: [],
  performance: null,
  recentClosedTrades: [],
  priorityReviews: [],
  triggersFiredSinceLastRun: [],
  triggersMatchingNow: [{ thesisId: "t", ticker: "IOT", triggerId: "b", action: "ENTER", predicateSummary: "price above $39.55", rationale: "", matchDetail: "" }],
  latestDigest: null,
  earnings: { reportingSoon: [], justReported: [] },
  filings: { recent: [{ ticker: "PRAX", date: "2026-07-02", tier: "serious" as const, summary: "8-K — auditor change (4.01)", url: "https://www.sec.gov/prax" }] },
  intelligencePolicy: { maxSignalsPerRun: 0 },
} as unknown as RunInput;

const prompt = buildDailyRunSystemPromptV2({ name: "PEAD Specialist", minConfidence: 70, maxPositionSize: 14000, minPositionSize: 3000 }, runInput);

describe("buildDailyRunSystemPromptV2 — the daily run as a portfolio manager", () => {
  it("deletes the per-horizon data discipline block and the three-path fired buy", () => {
    expect(prompt).not.toContain("Per-horizon data discipline");
    expect(prompt).not.toContain("THREE legal paths");
    expect(prompt).not.toContain("Retune the buy trigger");
  });
  it("a fired buy has two answers, and a raise away is named as a flag, not refused", () => {
    expect(prompt).toContain("a fired buy is a decision with two answers");
    expect(prompt).toContain("Set the plan down with the reason");
    expect(prompt).toContain("ENTRY_RAISED_AWAY");
  });
  it("regime and cash are inputs: the cash line names today's names at their buy level", () => {
    expect(prompt).toContain("## Regime and cash");
    expect(prompt).toContain("Cash is $31,000 (31% of equity)");
    expect(prompt).toContain("(today: IOT)");
    expect(prompt).toContain("CAUTION");
  });
  it("filings on the book this week are listed, and a held name's review runs its setup's checklist", () => {
    expect(prompt).toContain("## Filings on your book this week");
    expect(prompt).toContain("PRAX 2026-07-02 — 8-K — auditor change (4.01) · serious");
    expect(prompt).toContain("A held name's review runs its setup's checklist");
    expect(prompt).toContain("REVIEW from a FILING trigger");
  });
});
