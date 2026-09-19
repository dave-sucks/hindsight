/**
 * trade-results.test.ts — what the chat reads when Dave asks how the trades
 * have done (DAV-295). Replayed from the real closed book, 2026-09-18.
 *
 * SNOW +20.8% and ZETA +41.5% on the PEAD seat, PBH −11.3% and ANET +3.5%,
 * PRAX +6.6% and SRRK −3.8% and CYTK −6.3% on the Catalyst seat, EME −8.8%
 * on the Compounder. Eight closes, four up: 50% win.
 */
import { buildTradeResults, resultsHeadline, toTradeLine } from "./trade-results";
import type { ClosedTrade } from "./setup-scorecard";

const d = (s: string) => new Date(`${s}T16:00:00Z`);
const t = (
  symbol: string, analyst: string, setupId: string | null, entry: number, close: number,
  peak: number, pnl: number, opened: string, closed: string, initialStop: number | null = null,
): ClosedTrade => ({
  symbol, analyst, setupId, horizon: null, environment: "PAPER", direction: "LONG",
  entry, initialStop, close, peak, realizedPnl: pnl, closeReason: "STOP",
  openedAt: d(opened), closedAt: d(closed),
});

/** The real book: every close since the seats were rebuilt, newest first. */
const BOOK: ClosedTrade[] = [
  t("SRRK", "Catalyst Event PM", "PRE_CATALYST", 53.895, 51.825, 61.3, -192.51, "2026-08-13", "2026-09-14"),
  t("PBH", "PEAD Specialist", "PEAD", 52.975, 46.9886, 53.745, -802.1776, "2026-08-24", "2026-09-11"),
  t("ANET", "PEAD Specialist", "PEAD", 183.827484, 190.274, 202.995, 238.521092, "2026-08-20", "2026-09-01"),
  t("PRAX", "Catalyst Event PM", "PRE_CATALYST", 318.805, 339.69, 390.54, 417.7, "2026-07-20", "2026-08-31"),
  t("EME", "Secular Compounder", "COMPOUNDER_ACCUMULATION", 832.84, 759.72, 863.87, -731.2, "2026-08-13", "2026-08-28"),
  t("ZETA", "PEAD Specialist", "PEAD", 19.71, 27.885, 29.395, 1242.6, "2026-06-23", "2026-08-20", 17.5),
  t("CYTK", "Catalyst Event PM", "PRE_CATALYST", 82.31, 77.105, 83.72, -416.4, "2026-07-17", "2026-08-20"),
  t("SNOW", "PEAD Specialist", "PEAD", 265.029492307692, 320.08, 339.2, 2862.6264, "2026-06-09", "2026-08-19"),
];

describe("the closed book, 2026-09-18", () => {
  const r = buildTradeResults(BOOK);

  it("counts eight trades, four winners, and adds the realized dollars", () => {
    expect(r.trades).toBe(8);
    expect(r.wins).toBe(4);
    expect(r.winRatePct).toBe(50);
    expect(r.realizedTrades).toBe(8);
    expect(r.realizedPnl).toBeCloseTo(2619.16, 1);
  });

  it("R comes from the entry stop, and only from the trades that have one", () => {
    // ZETA: bought $19.71, stop $17.50 → $2.21 of risk; closed $27.885 → +3.7R.
    expect(r.avgR).toBe(3.7);
    expect(r.rTrades).toBe(1);
    expect(toTradeLine(BOOK[5]).r).toBe(3.7);
    expect(toTradeLine(BOOK[0]).r).toBeNull();
  });

  it("groups by setup and by analyst the same way /performance does", () => {
    const pead = r.bySetup.find((s) => s.setup.includes("drift") || s.setup.includes("Post-earnings"));
    expect(pead?.trades).toBe(4);
    expect(pead?.winRatePct).toBe(75);
    expect(r.byAnalyst.find((a) => a.analyst === "PEAD Specialist")?.trades).toBe(4);
    expect(r.byAnalyst.find((a) => a.analyst === "Catalyst Event PM")?.winRatePct).toBe(33);
  });

  it("names the give-back from the peak, which is the number the seats are judged on", () => {
    const pead = r.bySetup.find((s) => s.trades === 4);
    // SNOW peaked at $339.20 and closed $320.08 — 7.2 points given back.
    expect(pead?.avgGiveBackPts).toBeGreaterThan(0);
  });

  it("lists the newest closes first, with the gain, the days and why it closed", () => {
    expect(r.recent[0].symbol).toBe("SRRK");
    expect(r.recent[0].gainPct).toBe(-3.8);
    expect(r.recent[0].daysHeld).toBe(32);
    expect(r.recent[0].closeReason).toBe("STOP");
    expect(r.recent).toHaveLength(8);
    expect(buildTradeResults(BOOK, 3).recent).toHaveLength(3);
  });

  it("the headline says it is trade P&L, never the account's return", () => {
    const h = resultsHeadline(r, "since 2026-05-27");
    expect(h).toContain("8 closed trades since 2026-05-27");
    expect(h).toContain("50% win (4 of 8)");
    expect(h).toContain("+3.7R average over the 1 with a readable entry stop");
    expect(h).toContain("+$2,619.16 realized");
    expect(h).toContain("Realized trade P&L, not the account's return.");
  });

  it("an empty window says so rather than reporting zeros as a result", () => {
    expect(resultsHeadline(buildTradeResults([]), "in the last 7 days")).toBe("No closed trades in the last 7 days.");
  });

  it("a SHORT is measured the other way", () => {
    const short = { ...t("X", "A", "PEAD", 100, 90, 85, 500, "2026-08-01", "2026-08-10", 105), direction: "SHORT" };
    const line = toTradeLine(short);
    expect(line.gainPct).toBe(10);
    expect(line.r).toBe(2); // $5 of risk, $10 of move
  });
});

// QB review 2026-09-19 — three things this answer must not do.
describe("the numbers cannot disagree with themselves", () => {
  it("R comes from the one shared function, so the headline matches the per-setup line", () => {
    const r = buildTradeResults(BOOK);
    const pead = r.bySetup.find((s) => s.trades === 4);
    // Both sides read lib/performance/setup-scorecard's tradeR.
    expect(r.avgR).toBe(3.7);
    expect(pead?.avgR).toBe(3.7);
  });

  it("a trimmed trade's dollars are named as the closing leg only, never summed silently", () => {
    const trimmed = BOOK.map((t, i) => (i < 2 ? { ...t, trimmed: true } : t));
    const r = buildTradeResults(trimmed);
    expect(r.trimmedTrades).toBe(2);
    const h = resultsHeadline(r, "since 2026-05-27", "PAPER");
    expect(h).toContain("The dollars are the closing leg only: 2 of these were trimmed first");
  });

  it("with no trims the caveat is absent", () => {
    expect(resultsHeadline(buildTradeResults(BOOK), "since 2026-05-27", "PAPER")).not.toContain("closing leg only");
  });

  it("the book is always said, and an empty window says it too", () => {
    expect(resultsHeadline(buildTradeResults(BOOK), "since 2026-05-27", "PAPER")).toContain("on the paper book");
    expect(resultsHeadline(buildTradeResults([]), "in the last 7 days", "LIVE")).toBe("No closed trades in the last 7 days on the live book.");
  });
});
