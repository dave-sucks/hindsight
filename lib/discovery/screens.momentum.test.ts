/**
 * screens.momentum.test.ts — the momentum leader screen (DAV-287, playbook
 * D2). The hole it fills: every pool we have is "what moved today", so a
 * stock up 200% over a month that is quiet today is invisible.
 *
 * The sanity check from the ticket, 2026-09-17: the screener's top gainer
 * was AEMD, +374% on the day and −38% over six months — a shell. SDGR was
 * +26% on the day, +152% over six months — the candidate. The screen has to
 * tell them apart on the run, not the day.
 */
import { screenMomentum, MOMENTUM_MIN_ADR_PCT, MOMENTUM_MIN_RUN_PCT, type ScreenInput } from "./screens";
import type { PriceStructure } from "@/lib/market-data/price-structure";

const chart = (over: Partial<PriceStructure> = {}): PriceStructure =>
  ({
    asOf: "2026-09-17",
    price: 30.24,
    verdict: "PULLBACK_IN_UPTREND",
    adr20Pct: 5.8,
    atr14: { dollars: 1.8, pctOfPrice: 6 },
    sma: {
      d20: { value: 28.5, slope: "RISING", pctFromPrice: 6.1 },
      d50: { value: 26.0, slope: "RISING", pctFromPrice: 16.3 },
      d150: null,
      d200: null,
    },
    volume: { lastVsAvg20: 1.2 },
    relativeStrength: { vsSpy: { m1: 20, m3: 30, m6: 40 } },
    trendTemplate: { passed: 7, of: 8, failing: [] },
    ...over,
  }) as unknown as PriceStructure;

const row = (ticker: string, trailing: ScreenInput["trailing"], over?: Partial<PriceStructure>): ScreenInput => ({
  ticker,
  structure: chart(over),
  trailing,
});

describe("the momentum screen, 2026-09-17", () => {
  it("SDGR passes on the run, with its 1/3/6-month numbers on the row", () => {
    const r = screenMomentum([row("SDGR", { move1m: 73.8, move3m: 100.2, move6m: 152.0 })]);
    expect(r.passed.map((p) => p.ticker)).toEqual(["SDGR"]);
    expect(r.passed[0].screenRow).toContain("up +73.8% over 1M");
    expect(r.passed[0].screenRow).toContain("+152.0% over 6M");
    expect(r.passed[0].screenRow).toContain("daily range 5.8%");
    expect(r.passed[0].screenRow).toContain("from the rising 10-day");
  });

  it("AEMD is rejected: up on the month, down over six — a bounce in a downtrend, not a leader", () => {
    const r = screenMomentum([row("AEMD", { move1m: 390.6, move3m: 120.0, move6m: -38.0 })]);
    expect(r.passed).toEqual([]);
    expect(r.rejected[0].reason).toContain("-38.0% over six");
  });

  it("a stock that has not run is rejected however good its chart", () => {
    const r = screenMomentum([row("KO", { move1m: 4.2, move3m: 9.1, move6m: 12.0 })]);
    expect(r.rejected[0].reason).toContain(`under the ${MOMENTUM_MIN_RUN_PCT}% bar`);
  });

  it("a quiet mover is rejected: a momentum trade needs range to pay for its risk", () => {
    const r = screenMomentum([row("SLOW", { move1m: 45, move3m: 60, move6m: 80 }, { adr20Pct: 1.4 })]);
    expect(r.rejected[0].reason).toContain(`under the ${MOMENTUM_MIN_ADR_PCT}%`);
  });

  it("an extended stock is rejected — that is a chase, not a flag", () => {
    const r = screenMomentum([
      row("EXT", { move1m: 60, move3m: 90, move6m: 120 }, {
        sma: {
          d20: { value: 20, slope: "RISING", pctFromPrice: 48 },
          d50: { value: 18, slope: "RISING", pctFromPrice: 66 },
          d150: null, d200: null,
        },
      } as Partial<PriceStructure>),
    ]);
    expect(r.rejected[0].reason).toContain("extended");
  });

  it("a broken leader is rejected on its trend, and a name with no history is not guessed at", () => {
    expect(
      screenMomentum([row("BRK", { move1m: 50, move3m: 60, move6m: 70 }, { verdict: "DOWNTREND" } as Partial<PriceStructure>)]).rejected[0].reason,
    ).toContain("not in an uptrend");
    expect(screenMomentum([row("NEW", { move1m: null, move3m: null, move6m: null })]).rejected[0].reason).toContain("no 1- or 3-month return");
  });

  it("ranks the biggest run first", () => {
    const r = screenMomentum([
      row("A", { move1m: 35, move3m: 40, move6m: 50 }),
      row("B", { move1m: 90, move3m: 110, move6m: 150 }),
    ]);
    expect(r.passed.map((p) => p.ticker)).toEqual(["B", "A"]);
  });
});
