/**
 * trail.atr.test.ts — the trail widens for a volatile stock (DAV-294,
 * playbook E5: "the larger of 3× the stock's average daily range or the
 * analyst's percent").
 *
 * Replays, from production 2026-09-18 (positions + the 09-17 daily snapshot):
 *   MU  — PEAD, cost $895.94, peak $1,034.58, ATR(14) $50.05. Three ATR is
 *         $150.15, which is 14.5% of the peak — wider than PEAD's written
 *         12%. The trail belongs at $884.56, not $910.43. MU is exactly the
 *         name the fixed percent shakes out: it moves 5% of its price in a
 *         normal day.
 *   ABT — Compounder, cost $103.66, peak $103.55, ATR(14) $2.58. Three ATR
 *         is 7.5% of the peak — narrower than the Compounder's 25%, so the
 *         quiet name keeps the written line. A trail only ever widens.
 *
 * The line must be the same in all three places that compute it: the
 * evaluator (which sells), ladder health (which the agents read), and the
 * thesis columns (which the sheet draws).
 */
import { effectiveTrailPct, trailFireLevel, trailWidenedByRange } from "./trail";
import { evaluateTrigger } from "./evaluate";
import { canonicalLevels } from "./price-levels";
import { computeLadderHealth } from "@/lib/agent/ladder-health";
import { PEAD_TRAIL, MU, ABT } from "./trail.atr.fixtures";
import type { Trigger } from "./types";

describe("MU 2026-09-18 — a $50-a-day stock", () => {
  it("three ATR is 14.5% of the peak, so the give-back widens from 12%", () => {
    expect(effectiveTrailPct(PEAD_TRAIL, { peak: MU.peak, atr: MU.atr })).toBe(14.5);
    expect(trailWidenedByRange(PEAD_TRAIL, { peak: MU.peak, atr: MU.atr })).toBe(true);
  });

  it("the line moves from $910.43 to $884.56", () => {
    const written = trailFireLevel(PEAD_TRAIL, { peak: MU.peak, avgCost: MU.avgCost, isLong: true });
    const widened = trailFireLevel(PEAD_TRAIL, { peak: MU.peak, avgCost: MU.avgCost, isLong: true, atr: MU.atr });
    expect(written).toBeCloseTo(910.43, 2);
    expect(widened).toBeCloseTo(884.57, 1);
  });

  it("the evaluator does not sell at $900 any more — that is inside one and a half days' range", () => {
    const at = (price: number, atr: number | null) =>
      evaluateTrigger(PEAD_TRAIL, {
        now: new Date("2026-09-18T15:00:00Z"),
        latestQuote: { price, changePct: -1 },
        position: { avgCost: MU.avgCost, peakPrice: MU.peak },
        thesis: { createdAt: new Date("2026-07-01T00:00:00Z"), direction: "LONG" },
        indicators: atr == null ? null : ({ atr14: atr } as never),
      } as never);
    expect(at(900, MU.atr)).toBe(false);
    expect(at(900, null)).toBe(true); // what it did before the range was read
    expect(at(880, MU.atr)).toBe(true);
  });

  it("the agents' floor block and the sheet's column draw the same widened line", () => {
    const trig: Trigger[] = [{ id: "trail", action: "EXIT", predicate: PEAD_TRAIL, rationale: "Trail." }];
    const health = computeLadderHealth({
      direction: "LONG",
      avgCost: MU.avgCost,
      currentPrice: 927.6,
      peakPrice: MU.peak,
      triggers: trig,
      atr14: MU.atr,
      now: new Date("2026-09-18T15:00:00Z"),
    });
    expect(health?.floor?.price).toBeCloseTo(884.57, 1);
    expect(health?.floor?.label).toContain("14.5%");

    const cols = canonicalLevels({
      triggers: trig.map((t) => ({ ...t, level: "THESIS" as const, inherited: false })),
      direction: "LONG",
      status: "HOLDING",
      avgCost: MU.avgCost,
      peakPrice: MU.peak,
      atr14: MU.atr,
    });
    // The stop COLUMN is a cache of absolute levels; a projected trail is
    // exposed as the floor, which is what the sheet and the trade page draw.
    expect(cols.floor?.price).toBeCloseTo(884.57, 1);
    expect(cols.columns.stopLoss).toBeNull();
  });

  it("no snapshot: every surface falls back to the written percent together", () => {
    const trig: Trigger[] = [{ id: "trail", action: "EXIT", predicate: PEAD_TRAIL, rationale: "Trail." }];
    const health = computeLadderHealth({
      direction: "LONG", avgCost: MU.avgCost, currentPrice: 927.6, peakPrice: MU.peak,
      triggers: trig, atr14: null, now: new Date("2026-09-18T15:00:00Z"),
    });
    const cols = canonicalLevels({
      triggers: trig.map((t) => ({ ...t, level: "THESIS" as const, inherited: false })),
      direction: "LONG", status: "HOLDING", avgCost: MU.avgCost, peakPrice: MU.peak,
    });
    expect(health?.floor?.price).toBeCloseTo(910.43, 1);
    expect(cols.floor?.price).toBeCloseTo(910.43, 1);
  });
});

describe("ABT 2026-09-18 — a quiet compounder", () => {
  const COMPOUNDER_TRAIL = { kind: "TRAILING_FROM_HIGH", pct: 25, atrMultiple: 3 } as const;
  it("three ATR is 7.5% of the peak, under the written 25% — the line does not move", () => {
    expect(effectiveTrailPct(COMPOUNDER_TRAIL, { peak: ABT.peak, atr: ABT.atr })).toBe(25);
    expect(trailWidenedByRange(COMPOUNDER_TRAIL, { peak: ABT.peak, atr: ABT.atr })).toBe(false);
    expect(trailFireLevel(COMPOUNDER_TRAIL, { peak: ABT.peak, avgCost: ABT.avgCost, isLong: true, atr: ABT.atr })).toBeCloseTo(77.66, 2);
  });
});

describe("the rule itself", () => {
  it("a trail with no multiple is untouched, and the multiple never tightens", () => {
    const plain = { kind: "TRAILING_FROM_HIGH", pct: 12 } as const;
    expect(effectiveTrailPct(plain, { peak: 1000, atr: 50 })).toBe(12);
    expect(effectiveTrailPct({ ...plain, atrMultiple: 3 }, { peak: 1000, atr: 1 })).toBe(12);
  });
  it("an unarmed trail still has no line, however volatile the stock", () => {
    expect(trailFireLevel(PEAD_TRAIL, { peak: 1000, avgCost: 990, isLong: true, atr: 50 })).toBeNull();
  });
  it("SHORT widens upward", () => {
    expect(trailFireLevel({ kind: "TRAILING_FROM_HIGH", pct: 10, atrMultiple: 3 }, { peak: 100, isLong: false, atr: 5 })).toBeCloseTo(115, 2);
  });
});

describe("the ratchet counts the range multiple", () => {
  it("widening the multiple on a held stock is a loosening, like widening the percent", async () => {
    const { protectiveRatchetViolations } = await import("./ratchet");
    const before = [{ id: "t", action: "EXIT" as const, predicate: PEAD_TRAIL, rationale: "Trail." }];
    const wider = [{ ...before[0], predicate: { ...PEAD_TRAIL, atrMultiple: 5 } }];
    const tighter = [{ ...before[0], predicate: { ...PEAD_TRAIL, atrMultiple: 2 } }];
    expect(protectiveRatchetViolations({ direction: "LONG", before, after: wider, inherited: [] })).toHaveLength(1);
    expect(protectiveRatchetViolations({ direction: "LONG", before, after: tighter, inherited: [] })).toEqual([]);
  });
});

/**
 * The gate that decides which stocks the 5-minute pass loads a daily
 * snapshot for. A range-widened trail reads ATR off that snapshot, so a
 * stock whose ONLY chart rung is the trail has to be in this list — MU,
 * FIVE, IOT, NVDA and SMMT all are exactly that shape on the live book.
 * Without it the evaluator falls back to the written percent while the
 * sheet, which looks the ATR up itself, draws the wider line: MU would show
 * a sale at $884.57 and sell at $910.43 (QB review, 2026-09-19).
 */
describe("the evaluator loads the snapshot for a range-widened trail", () => {
  it("a trail with a multiple needs indicators; a plain one does not", async () => {
    const { needsIndicators } = await import("./indicator-needs");
    expect(needsIndicators(PEAD_TRAIL)).toBe(true);
    expect(needsIndicators({ kind: "TRAILING_FROM_HIGH", pct: 12, armAtGainPct: 10 })).toBe(false);
  });

  it("MU's ladder asks for a snapshot even though the trail is its only chart rung", async () => {
    const { needsIndicators } = await import("./indicator-needs");
    const MU_LADDER = [
      { kind: "PRICE_BELOW", level: 969 },
      { kind: "GAIN_FROM_ENTRY", pct: 10, direction: "UP" },
      { kind: "REVIEW_CADENCE", days: 7 },
      PEAD_TRAIL,
    ] as const;
    expect(MU_LADDER.some((p) => needsIndicators(p))).toBe(true);
    expect(MU_LADDER.filter((p) => needsIndicators(p))).toHaveLength(1);
  });

  it("the evaluator and the sheet land on the same line for MU once the snapshot is loaded", () => {
    const withAtr = trailFireLevel(PEAD_TRAIL, { peak: MU.peak, avgCost: MU.avgCost, isLong: true, atr: MU.atr });
    const sheet = canonicalLevels({
      triggers: [{ id: "trail", action: "EXIT", predicate: PEAD_TRAIL, rationale: "Trail.", level: "THESIS" as const, inherited: false }],
      direction: "LONG",
      status: "HOLDING",
      avgCost: MU.avgCost,
      peakPrice: MU.peak,
      atr14: MU.atr,
    });
    expect(sheet.floor?.price).toBeCloseTo(withAtr as number, 4);
    expect(withAtr).toBeCloseTo(884.57, 1);
  });
});
