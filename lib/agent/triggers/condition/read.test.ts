/**
 * Exactly on the line. A price set to a level almost never happens by chance,
 * so a reader that said "at least" where it should say "more than" would pass
 * every random test. Here each measure's number is set to the situation's own
 * line: the typed level, the variable's number (an average, a high, the close
 * N days back, our entry, the high since we bought), the trail line, the day
 * of the report and N days before and after it, and a count of days to the
 * minute.
 *
 * The answers are the ones the checker this replaced gave (it agreed on every
 * line before it was deleted): a price above or below a level is strict, so
 * exactly on the line it doesn't hold; every move, ratio, count, report window
 * and day count includes its number, so on the line it does. A sale or review
 * fires exactly when the condition holds. A filing has no number and isn't here.
 */

import { shouldFire, type EvaluationContext } from "../evaluate";
import type { Trigger } from "../types";
import type { Condition, VariableId } from "./types";
import { SHAPE_CHECKER } from "./read";
import { liveRsi, movePctOverSessions, volumeRatio, type IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";
import { insiderCluster } from "@/lib/market-data/insider-cluster";
import { daysUntilReport } from "../earnings";
import { trailFireLevel } from "../trail";

const DAY = 86_400_000;
const NOW = new Date("2026-10-05T15:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const REPORT = { symbol: "X", reportDate: "", hour: null, epsActual: 1, epsEstimate: 1, surprisePct: 4, revenueActual: null, revenueEstimate: null, quarter: 3, year: 2026 };

/** A stock at `price` with a snapshot, a position, a gap and a volume day, all fixed. */
function live(price: number): EvaluationContext {
  const closes = Array.from({ length: 60 }, (_, i) => price * (1 + 0.2 * Math.sin(i / 6)));
  const indicators: IndicatorSnapshot = {
    asOf: ymd(ago(1)),
    sma: { 20: price * 0.95, 50: price * 0.9, 150: price * 0.85, 200: price * 0.8 },
    high20: price * 1.05,
    low20: price * 0.9,
    high52w: price * 1.2,
    low52w: price * 0.6,
    volumeAvg20: 1_000_000,
    closes,
    rsVsSpy: { "1M": 5.5, "3M": -2.25, "6M": 10 },
    gaps: [],
    atr14: null,
    insiderBuys: [0, 1, 2].map((k) => ({ name: `insider ${k}`, date: ymd(ago(10 + k)), shares: 1000, price })),
  };
  return {
    latestQuote: { price, changePct: 2, prevClose: price / 1.02, stale: false },
    earnings: null,
    upcomingEarnings: null,
    filings: [],
    indicators,
    today: { open: price * 1.04, volume: 2_000_000 },
    session: "INTRADAY",
    position: { avgCost: price * 0.9, peakPrice: price * 1.2, openedAt: ago(40), peakAt: null },
    thesis: { createdAt: ago(120), lastReviewedAt: ago(3), catalystDate: null, direction: "LONG" },
    now: NOW,
  };
}
const withPrice = (ctx: EvaluationContext, price: number): EvaluationContext => ({ ...ctx, latestQuote: { ...ctx.latestQuote!, price } });

type Case = { on: string; c: Condition; ctx: EvaluationContext; holds: boolean };

function cases(): Case[] {
  const out: Case[] = [];
  const add = (on: string, c: Condition, ctx: EvaluationContext, holds: boolean) => out.push({ on, c, ctx, holds });
  for (const base of [12.5, 100, 337.38]) {
    const ctx = live(base);
    const price = base;
    const snap = ctx.indicators!;
    for (const session of ["INTRADAY", "CLOSE"] as const) {
      const at = { ...ctx, session };
      add("a typed level", { watch: "price", is: "above", value: price }, at, false);
      add("a typed level", { watch: "price", is: "below", value: price }, at, false);
      add("a typed level on the close", { watch: "price", is: "above", value: price, settings: { close: true } }, at, false);
      add("a typed level on the close", { watch: "price", is: "below", value: price, settings: { close: true } }, at, false);
    }
    for (const period of [20, 50, 200] as const) {
      const line = snap.sma[period]!;
      const variable = `sma${period}` as VariableId;
      add("an average", { watch: "price", is: "above", variable }, withPrice(ctx, line), false);
      add("an average", { watch: "price", is: "below", variable }, withPrice(ctx, line), false);
      const near = withPrice(ctx, line * 1.04);
      add("near an average", { watch: "move", is: "near", value: (Math.abs(near.latestQuote!.price - line) / line) * 100, variable }, near, true);
    }
    add("the 20-day high", { watch: "price", is: "above", variable: "high20" }, withPrice(ctx, snap.high20!), false);
    add("the 52-week high", { watch: "price", is: "above", variable: "high52" }, withPrice(ctx, snap.high52w!), false);
    const under = withPrice(ctx, snap.high52w! * 0.95);
    add("near the 52-week high", { watch: "move", is: "near", value: ((snap.high52w! - under.latestQuote!.price) / snap.high52w!) * 100, variable: "high52" }, under, true);
    add("yesterday's close", { watch: "move", is: "above", value: 2, variable: "prev_close" }, ctx, true);
    for (const [variable, n] of [["close_5d", 5], ["close_20d", 20]] as const) {
      const m = movePctOverSessions(snap, price, n)!;
      add(`the close ${n} days back`, { watch: "move", is: m > 0 ? "above" : "below", value: Math.abs(m), variable }, ctx, true);
    }
    add("our entry", { watch: "move", is: "above", value: ((price - ctx.position!.avgCost!) / ctx.position!.avgCost!) * 100, variable: "entry" }, ctx, true);
    // The big-winner switch: a peak exactly this far off the buy, exactly this
    // many days after it, turns the stop from our entry off.
    const avg = ctx.position!.avgCost!;
    const down = withPrice(ctx, avg * 0.92);
    const fell = ((avg - down.latestQuote!.price) / avg) * 100;
    for (const days of [5, 21]) {
      const fast = { ...down, position: { ...down.position!, peakAt: new Date(down.position!.openedAt!.getTime() + days * DAY) } };
      const ran = ((fast.position.peakPrice! - avg) / avg) * 100;
      add("the stop from our entry", { watch: "move", is: "below", value: fell, variable: "entry" }, fast, true);
      add("the big-winner switch", { watch: "move", is: "below", value: fell, variable: "entry", settings: { fastWinnerPct: ran, fastWinnerDays: days } }, fast, false);
      const sameDay = { ...down, position: { ...down.position!, peakAt: down.position!.openedAt } };
      add("the big-winner switch, peak on the day we bought", { watch: "move", is: "below", value: fell, variable: "entry", settings: { fastWinnerPct: ran, fastWinnerDays: days } }, sameDay, false);
    }
    for (const pct of [5, 12, 25]) {
      const at = { peak: ctx.position!.peakPrice, avgCost: ctx.position!.avgCost!, isLong: true, atr: null };
      add("the trail line", { watch: "move", is: "below", value: pct, variable: "peak" }, withPrice(ctx, trailFireLevel({ pct }, at)!), true);
      add("the trail line, armed", { watch: "move", is: "below", value: pct, variable: "peak", settings: { startOnceUpPct: 10 } }, withPrice(ctx, trailFireLevel({ pct, armAtGainPct: 10 }, at)!), true);
    }
    const ratio = volumeRatio(snap, ctx.today!.volume)!;
    add("the volume ratio", { watch: "volume", value: ratio }, ctx, true);
    for (const period of [14, 2]) {
      const rsi = liveRsi(snap, price, period)!;
      add(`the ${period}-day RSI`, { watch: "rsi", is: "above", value: rsi, settings: { period } }, ctx, false);
      add(`the ${period}-day RSI`, { watch: "rsi", is: "below", value: rsi, settings: { period } }, ctx, false);
    }
    add("strength vs the S&P", { watch: "strength", value: 5.5, settings: { window: "1M" } }, ctx, true);
    add("strength vs the S&P", { watch: "strength", value: -2.25, settings: { window: "3M" } }, ctx, true);
    const gapPct = ((ctx.today!.open! - ctx.latestQuote!.prevClose!) / ctx.latestQuote!.prevClose!) * 100;
    add("today's gap", { watch: "gap", value: gapPct, settings: { volume: ratio } }, ctx, true);
    add("insider buyers", { watch: "insiders", value: insiderCluster(snap.insiderBuys!, 30, NOW).buyers, settings: { days: 30 } }, ctx, true);
    for (const n of [0, 1, 3]) {
      const ahead = { ...ctx, upcomingEarnings: { ...REPORT, reportDate: ymd(new Date(NOW.getTime() + n * DAY)) } };
      add(n === 0 ? "the report day, before" : `${n} days before the report`, { watch: "report", is: "before", value: Math.max(1, daysUntilReport(ahead.upcomingEarnings, NOW)) }, ahead, true);
      const behind = { ...ctx, earnings: { ...REPORT, reportDate: ymd(ago(n)) } };
      const since = -daysUntilReport(behind.earnings, NOW);
      add(n === 0 ? "the report day, after" : `${n} days after the report`, { watch: "report", is: "after", value: since, settings: { fromDay: since } }, behind, true);
      add("the report day through N days after", { watch: "report", is: "after", value: since, settings: { fromDay: 0 } }, behind, true);
    }
    add("the surprise", { watch: "surprise", is: "beat", value: 4 }, { ...ctx, earnings: { ...REPORT, reportDate: ymd(ago(1)) } }, true);
    add("the surprise", { watch: "surprise", is: "miss", value: 4 }, { ...ctx, earnings: { ...REPORT, surprisePct: -4, reportDate: ymd(ago(1)) } }, true);
    for (const days of [1, 7, 30]) {
      add("days since the last review", { watch: "repeat", value: days }, { ...ctx, thesis: { ...ctx.thesis, lastReviewedAt: ago(days) } }, true);
      add("days since the buy", { watch: "from_date", is: "after", value: days, variable: "buy" }, { ...ctx, position: { ...ctx.position!, openedAt: ago(days) } }, true);
      add("days before the event", { watch: "from_date", is: "before", value: days, variable: "event" }, { ...ctx, thesis: { ...ctx.thesis, catalystDate: ago(-days) } }, true);
      add("0 days before the event", { watch: "from_date", is: "before", value: days, variable: "event" }, { ...ctx, thesis: { ...ctx.thesis, catalystDate: NOW } }, true);
      add("days after the event", { watch: "from_date", is: "after", value: days, variable: "event" }, { ...ctx, thesis: { ...ctx.thesis, catalystDate: ago(days) } }, true);
    }
  }
  return out;
}

describe("exactly on the line", () => {
  const all = cases();

  it.each(all.map((x) => [x.on, JSON.stringify(x.c), x.holds, x] as const))("%s: %s holds = %s", (_on, _c, holds, { c, ctx }) => {
    expect(SHAPE_CHECKER.holds(c, ctx)).toBe(holds);
    for (const action of ["EXIT", "REVIEW"] as const) {
      const t: Trigger = { id: "t", predicate: c, action, rationale: "" };
      expect(shouldFire(t, ctx).fires).toBe(holds);
    }
  });

  it("reaches every line", () => {
    expect(new Set(all.map((x) => x.on)).size).toBeGreaterThanOrEqual(30);
  });
});
