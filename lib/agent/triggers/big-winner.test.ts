/**
 * big-winner.test.ts — a stock that runs 20% off the buy inside three weeks
 * is not cut in half by the mechanical partial. The playbook's rule is "sell
 * part into strength at +20–25%, unless the stock did +20% in ≤ 3 weeks —
 * then hold", and both halves are load-bearing: the size alone would switch
 * the partial off for anything that ever touched +20%, including a six-month
 * grind, which is an ordinary winner and exactly what the partial is for.
 *
 * Replays from the live book, read 2026-09-20:
 *   SMMT — cost $14.35, peak $18.725, opened 2026-09-01, peak 2026-09-14.
 *          +30.5% in 13 days: a fast winner, the partial is off for good.
 *   MU   — cost $895.935, peak $1,034.58, opened 2026-07-17, peak 2026-09-09.
 *          +15.5% in 54 days: under the size bar AND slow. The partial stands.
 *   MU's clock with a peak that clears the bar — the same 54-day gap and the
 *          same cost basis, peak raised to $1,120 (+25%). This is the case
 *          the clock exists for: big enough, far too slow. No position on the
 *          book has both today, which is why the rule has to be pinned here
 *          and not left to the next one that does.
 *
 * The switch reads Position.peakPrice and Position.peakAt — the water mark
 * the trail reads and the clock the price monitor writes beside it — so it
 * needs no memory of its own and cannot drift from the trail.
 */
import { evaluateTrigger } from "./evaluate";
import { setupExitTriggers } from "./setup-exits";
import {
  getSetup,
  BIG_WINNER_PEAK_GAIN_PCT,
  BIG_WINNER_PEAK_WITHIN_DAYS,
} from "@/lib/agent/knowledge/setups";
import type { TriggerPredicate } from "./types";

const PARTIAL: TriggerPredicate = {
  kind: "GAIN_FROM_ENTRY",
  pct: 12,
  direction: "UP",
  skipIfPeakGainPct: BIG_WINNER_PEAK_GAIN_PCT,
  skipIfPeakWithinDays: BIG_WINNER_PEAK_WITHIN_DAYS,
};

const fires = (
  p: TriggerPredicate,
  o: {
    price: number;
    avgCost: number;
    peak: number | null;
    openedAt?: string;
    peakAt?: string | null;
    direction?: string;
  },
) =>
  evaluateTrigger(p, {
    now: new Date("2026-09-20T15:00:00Z"),
    latestQuote: { price: o.price, changePct: 1 },
    position: {
      avgCost: o.avgCost,
      peakPrice: o.peak,
      openedAt: o.openedAt ? new Date(o.openedAt) : new Date("2026-09-01T00:00:00Z"),
      peakAt: o.peakAt === null ? null : new Date(o.peakAt ?? "2026-09-05T00:00:00Z"),
    },
    thesis: { createdAt: new Date("2026-07-01T00:00:00Z"), direction: o.direction ?? "LONG" },
  } as never);

/** The three live rows, exactly as the Position table holds them. */
const SMMT = {
  avgCost: 14.35,
  peak: 18.725,
  openedAt: "2026-09-01T21:15:27.803Z",
  peakAt: "2026-09-14T21:00:28.791Z",
};
const MU = {
  avgCost: 895.935,
  peak: 1034.58,
  openedAt: "2026-07-17T20:51:25.540Z",
  peakAt: "2026-09-09T18:00:24.734Z",
};

describe("the partial at 2R, and the winner it lets run", () => {
  it("SMMT: +30.5% in 13 days turns the partial off for good", () => {
    expect(fires(PARTIAL, { ...SMMT, price: 18.0 })).toBe(false);
    // Still off after it gives some back — the trail, not the partial, manages it now.
    expect(fires(PARTIAL, { ...SMMT, price: 16.5 })).toBe(false);
  });

  it("MU: +15.5% is under the size bar, so the partial still fires at 2R", () => {
    expect(fires(PARTIAL, { ...MU, price: 1010 })).toBe(true);
  });

  it("MU's clock with a peak that clears the bar: +25% over 54 days is a grind, and it is still trimmed", () => {
    // Same buy, same 54 days to the high — only the peak is raised. Without
    // the clock this returns false and a half-year climb loses its partial.
    expect(fires(PARTIAL, { ...MU, peak: 1120, price: 1080 })).toBe(true);
  });

  it("the clock runs from the buy, not from today", () => {
    const within = { openedAt: "2026-05-01T00:00:00Z", peakAt: "2026-05-15T00:00:00Z" };
    // The peak was set four months ago, but it came 14 days after the buy.
    expect(fires(PARTIAL, { ...within, avgCost: 100, peak: 125, price: 118 })).toBe(false);
    // One day past three weeks is a grind.
    expect(
      fires(PARTIAL, {
        openedAt: "2026-05-01T00:00:00Z",
        peakAt: "2026-05-23T00:00:00Z",
        avgCost: 100,
        peak: 125,
        price: 118,
      }),
    ).toBe(true);
    // Exactly three weeks is still fast — the partial is off.
    expect(
      fires(PARTIAL, {
        openedAt: "2026-05-01T00:00:00Z",
        peakAt: "2026-05-22T00:00:00Z",
        avgCost: 100,
        peak: 125,
        price: 118,
      }),
    ).toBe(false);
  });

  it("exactly at the size bar counts as a big winner", () => {
    const fast = { openedAt: "2026-09-01T00:00:00Z", peakAt: "2026-09-08T00:00:00Z" };
    expect(fires(PARTIAL, { ...fast, avgCost: 100, peak: 120, price: 118 })).toBe(false);
    expect(fires(PARTIAL, { ...fast, avgCost: 100, peak: 119.9, price: 118 })).toBe(true);
  });

  it("no tracked peak, and no clock beside it, both leave the partial alone", () => {
    const plain: TriggerPredicate = { kind: "GAIN_FROM_ENTRY", pct: 12, direction: "UP" };
    expect(fires(plain, { ...SMMT, price: 18.0 })).toBe(true);
    expect(fires(PARTIAL, { ...SMMT, peak: null, price: 18.0 })).toBe(true);
    // A position the price monitor has never stamped: we can't show the run
    // was fast, so the partial stands rather than silently switching off.
    expect(fires(PARTIAL, { ...SMMT, peakAt: null, price: 18.0 })).toBe(true);
  });

  it("a SHORT measures its run the other way, on the same clock", () => {
    const fast = { openedAt: "2026-09-01T00:00:00Z", peakAt: "2026-09-08T00:00:00Z" };
    const slow = { openedAt: "2026-05-01T00:00:00Z", peakAt: "2026-08-01T00:00:00Z" };
    // Down 22% at its low in a week — a big winner.
    expect(
      fires(PARTIAL, { ...fast, avgCost: 100, peak: 78, price: 86, direction: "SHORT" }),
    ).toBe(false);
    // Down 15% at its low — ordinary.
    expect(
      fires(PARTIAL, { ...fast, avgCost: 100, peak: 85, price: 86, direction: "SHORT" }),
    ).toBe(true);
    // Down 22%, but it took three months.
    expect(
      fires(PARTIAL, { ...slow, avgCost: 100, peak: 78, price: 86, direction: "SHORT" }),
    ).toBe(true);
  });

  it("the fill writes both halves on a trade and a target, never on a compounder or a catalyst", () => {
    const written = (horizon: string) =>
      setupExitTriggers({ setup: getSetup("PEAD")!, horizon, entry: 100, stop: 94, mintId: () => "x" })
        .find((t) => t.action === "TRIM")?.predicate as
        | { skipIfPeakGainPct?: number; skipIfPeakWithinDays?: number }
        | undefined;
    expect(written("TARGET")?.skipIfPeakGainPct).toBe(BIG_WINNER_PEAK_GAIN_PCT);
    expect(written("TARGET")?.skipIfPeakWithinDays).toBe(BIG_WINNER_PEAK_WITHIN_DAYS);
    expect(written("TRADE")?.skipIfPeakWithinDays).toBe(BIG_WINNER_PEAK_WITHIN_DAYS);
    expect(written("COMPOUNDER")?.skipIfPeakGainPct).toBeUndefined();
    expect(written("COMPOUNDER")?.skipIfPeakWithinDays).toBeUndefined();
    expect(written("CATALYST")?.skipIfPeakWithinDays).toBeUndefined();
  });
});
