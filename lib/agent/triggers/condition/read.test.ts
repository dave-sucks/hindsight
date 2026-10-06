/**
 * The trigger checker against the one it replaced (frozen in
 * ./__fixtures__/kind-checker.ts), over every stored trigger.
 *
 * Each distinct stored condition (the fixture condition.test.ts describes), plus
 * the kinds and options nothing stores yet, is checked in 300 seeded random
 * market situations: prices around its own level, a snapshot,
 * a position, a report, filings, dates, a stale quote, the close pass. The
 * two checkers must agree on whether it holds, whether it reads the price and
 * whether it reads the next report, and the whole fire decision (crossing,
 * stale quote, cooldown, re-arm, a report it already fired for) must come out
 * the same, for the trigger stored as a kind and stored as the shape. docs/plans/TRIGGER_TYPES.md, PR 2.
 */

import stored from "./__fixtures__/stored-triggers.json";
import { UNSTORED, type StoredRow } from "./__fixtures__/unstored-triggers";
import { shouldFire, type EvaluationContext } from "../evaluate";
import { KIND_CHECKER } from "./__fixtures__/kind-checker";
import type { Trigger, TriggerAction } from "../types";
import { liveRsi, movePctOverSessions, volumeRatio, type IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";
import { insiderCluster } from "@/lib/market-data/insider-cluster";
import { daysUntilReport } from "../earnings";
import { trailFireLevel } from "../trail";
import type { SecFiling } from "@/lib/market-data/sec-events";
import { SHAPE_CHECKER } from "./read";
import { toStoredPredicate } from "./stored";
import type { LegacyPredicate } from "./legacy-types";

type Row = { action: TriggerAction; predicate: StoredRow; scopes: string[]; count: number };

const rows: Row[] = [
  ...(stored as unknown as { rows: Row[] }).rows,
  ...UNSTORED.flatMap((predicate) => (["ENTER", "EXIT", "REVIEW"] as const).map((action) => ({ action, predicate: predicate as StoredRow, scopes: ["live"], count: 1 }))),
];

/** mulberry32: the same situations on every run. */
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A price the predicate is about, so the situations land on both sides of it. */
function anchor(p: LegacyPredicate): number {
  if ("level" in p && typeof p.level === "number") return p.level;
  if (p.kind === "AND" || p.kind === "OR") return p.predicates.map(anchor).find((a) => a !== 100) ?? 100;
  return 100;
}

const NOW = new Date("2026-10-05T15:00:00.000Z");
const REPORT = { symbol: "X", reportDate: "", hour: null, epsActual: null, epsEstimate: 1, surprisePct: null, revenueActual: null, revenueEstimate: null, quarter: 3, year: 2026 };
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function situation(p: LegacyPredicate, rand: () => number): EvaluationContext {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const between = (a: number, b: number) => a + rand() * (b - a);
  const base = anchor(p);
  const price = base * between(0.7, 1.3);
  const changePct = between(-15, 15);
  const closes = Array.from({ length: 60 }, (_, i) => base * (1 + 0.25 * Math.sin(i / 7 + rand() * 3)) * between(0.95, 1.05));
  const snapshot: IndicatorSnapshot = {
    asOf: ymd(day(-1)),
    sma: { 20: base * between(0.8, 1.2), 50: base * between(0.8, 1.2), 150: rand() < 0.1 ? null : base * between(0.8, 1.2), 200: base * between(0.8, 1.2) },
    high20: base * between(1, 1.25),
    low20: base * between(0.75, 1),
    high52w: base * between(1, 1.5),
    low52w: base * between(0.5, 1),
    volumeAvg20: rand() < 0.1 ? null : 1_000_000,
    closes,
    rsVsSpy: { "1M": between(-20, 20), "3M": between(-20, 20), "6M": rand() < 0.1 ? null : between(-20, 20) },
    gaps: rand() < 0.5 ? [] : [{ sessionsAgo: pick([1, 2, 3, 5]), pct: between(3, 12), volumeRatio: rand() < 0.2 ? null : between(1, 5), low: base, mid: base, high: base }],
    atr14: rand() < 0.3 ? null : base * between(0.01, 0.08),
    insiderBuys: rand() < 0.3 ? undefined : Array.from({ length: pick([0, 1, 3, 5]) }, (_, i) => ({ name: `insider ${i % 4}`, date: ymd(day(-Math.floor(between(0, 120)))), shares: 1000, price: base })),
  };
  const avgCost = base * between(0.7, 1.3);
  const peakPrice = Math.max(avgCost, price) * between(1, 1.4);
  const openedAt = day(-between(0, 90));
  const reported = rand() < 0.6;
  const filings: SecFiling[] = Array.from({ length: pick([0, 1, 2, 3]) }, (_, i) => {
    const kind = pick([
      { form: "8-K", rootForm: "8-K", items: [pick(["5.02", "1.01", "4.02", "7.01", "8.01", "2.05"])] },
      { form: "S-3", rootForm: "S-3", items: [] },
      { form: "NT 10-Q", rootForm: "NT 10-Q", items: [] },
      { form: "SCHEDULE 13D", rootForm: "SCHEDULE 13D", items: [] },
    ]);
    const tier = kind.items.some((x) => ["4.02"].includes(x)) || kind.rootForm === "NT 10-Q" ? "RED" : kind.items.some((x) => ["5.02", "1.01", "2.05"].includes(x)) || kind.rootForm === "S-3" || kind.rootForm === "SCHEDULE 13D" ? "MATERIAL" : "CONTEXT";
    return { accession: `acc-${i}`, cik: "0", ticker: "X", ...kind, filedDate: ymd(day(-i)), tier, url: "" } as SecFiling;
  });
  return {
    latestQuote: rand() < 0.05 ? undefined : { price, changePct, prevClose: rand() < 0.15 ? undefined : price / (1 + changePct / 100), stale: rand() < 0.15 },
    earnings: reported
      ? { ...REPORT, reportDate: ymd(day(-Math.floor(between(0, 10)))), epsActual: rand() < 0.15 ? null : 1, surprisePct: rand() < 0.15 ? null : between(-20, 20) }
      : null,
    upcomingEarnings: rand() < 0.6 ? { ...REPORT, reportDate: ymd(day(Math.floor(between(0, 20)))) } : null,
    filings,
    firedFilings: rand() < 0.3 ? ["acc-0"] : undefined,
    indicators: rand() < 0.08 ? null : snapshot,
    today: rand() < 0.1 ? null : { open: price * between(0.92, 1.12), volume: between(0, 4_000_000) },
    session: pick(["INTRADAY", "CLOSE", undefined] as const),
    position: rand() < 0.2 ? null : { avgCost, peakPrice: rand() < 0.1 ? null : peakPrice, openedAt, peakAt: rand() < 0.2 ? null : day(-between(0, 90)) },
    thesis: {
      createdAt: day(-between(30, 200)),
      lastReviewedAt: rand() < 0.2 ? null : day(-between(0, 60)),
      catalystDate: rand() < 0.3 ? null : day(between(-40, 40)),
      direction: rand() < 0.15 ? "SHORT" : "LONG",
    },
    now: NOW,
  };
}

function triggerState(row: Row, ctx: EvaluationContext, rand: () => number): Trigger {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const lastFiredAt = rand() < 0.5 ? undefined : day(-rand() * 10).toISOString();
  return {
    id: "t",
    predicate: row.predicate,
    action: row.action,
    rationale: "",
    cooldownDays: pick([undefined, 0, 1, 3, 7]),
    lastFiredAt,
    firedReports: rand() < 0.3 && ctx.upcomingEarnings ? [ctx.upcomingEarnings.reportDate] : undefined,
    rearmedAt: lastFiredAt && rand() < 0.2 ? day(-rand() * 5).toISOString() : undefined,
    writtenPrice: rand() < 0.2 ? (ctx.latestQuote?.price ?? 100) * 0.97 : undefined,
    writtenAt: rand() < 0.5 ? NOW.toISOString() : day(-3).toISOString(),
  };
}

const SITUATIONS = 300;

describe("the checker agrees with the one it replaced on every stored trigger", () => {
  it(`agrees on ${rows.length} conditions × ${SITUATIONS} situations`, () => {
    const rand = prng(20261005);
    const disagree: unknown[] = [];
    let holds = 0;
    for (const row of rows) {
      const p = row.predicate;
      if (SHAPE_CHECKER.readsPrice(p) !== KIND_CHECKER.readsPrice(p)) disagree.push({ p, on: "readsPrice" });
      if (SHAPE_CHECKER.readsUpcomingReport(p) !== KIND_CHECKER.readsUpcomingReport(p)) disagree.push({ p, on: "readsUpcomingReport" });
      for (let i = 0; i < SITUATIONS; i++) {
        const ctx = situation(p, rand);
        const kinds = KIND_CHECKER.holds(p, ctx);
        if (kinds) holds++;
        if (SHAPE_CHECKER.holds(p, ctx) !== kinds) disagree.push({ p, i, kinds, on: "holds" });
        const t = triggerState(row, ctx, rand);
        const a = shouldFire(t, ctx, KIND_CHECKER);
        const b = shouldFire(t, ctx);
        if (a.fires !== b.fires || a.reason !== b.reason) disagree.push({ p, i, a, b, on: "shouldFire" });
        // Stored in the condition shape since the cutover: the same decision.
        const c = shouldFire({ ...t, predicate: toStoredPredicate(t.predicate) as StoredRow }, ctx);
        if (c.fires !== b.fires || c.reason !== b.reason) disagree.push({ p, i, b, c, on: "stored as the shape" });
        if (disagree.length > 5) break;
      }
      if (disagree.length > 5) break;
    }
    expect(disagree).toEqual([]);
    // The grid is only proof if it lands on both sides: a fair share of situations must hold.
    expect(holds / (rows.length * SITUATIONS)).toBeGreaterThan(0.15);
  });
});

/**
 * Exactly on the line. Random prices almost never equal a level, so a reader
 * that said "at least" where it should say "more than" would pass the grid
 * above. Here each measure's number is set to the situation's own line: the
 * typed level, the variable's number (an average, a high, the close N days
 * back, our entry, the high since we bought), the trail line, the big-winner
 * switch, the day of the report and N days before it, and a count of days to
 * the minute. Both
 * checkers must still agree, under every action. A filing has no number and
 * is left to the grid.
 */
describe("the checker agrees with the one it replaced exactly on every line", () => {
  const DAY = 86_400_000;
  const rand = prng(20261006);
  /** A situation with a quote, a snapshot and a position, for a condition at about `base`. */
  const live = (base = 100): EvaluationContext => {
    const ctx = situation({ kind: "PRICE_ABOVE", level: base }, rand);
    const price = ctx.latestQuote?.price ?? base;
    const changePct = ctx.latestQuote?.changePct ?? 2;
    ctx.latestQuote = { price, changePct, prevClose: price / (1 + changePct / 100), stale: false };
    if (!ctx.indicators) ctx.indicators = situation({ kind: "PRICE_ABOVE", level: base }, () => 0.5).indicators ?? null;
    ctx.indicators = { ...ctx.indicators!, volumeAvg20: 1_000_000, atr14: null };
    ctx.today = { open: price * 1.04, volume: 2_000_000 };
    ctx.position = { avgCost: price * 0.9, peakPrice: price * 1.2, openedAt: new Date(ctx.now.getTime() - 40 * DAY), peakAt: null };
    ctx.thesis = { ...ctx.thesis, direction: "LONG" };
    return ctx;
  };
  const withPrice = (ctx: EvaluationContext, price: number): EvaluationContext => ({ ...ctx, latestQuote: { ...ctx.latestQuote!, price } });
  const ago = (ctx: EvaluationContext, days: number) => new Date(ctx.now.getTime() - days * DAY);

  /** Every (condition, situation) pair that sits exactly on its line. */
  function cases(): Array<{ p: LegacyPredicate; ctx: EvaluationContext; on: string }> {
    const out: Array<{ p: LegacyPredicate; ctx: EvaluationContext; on: string }> = [];
    const add = (on: string, p: LegacyPredicate, ctx: EvaluationContext) => out.push({ p, ctx, on });
    for (let i = 0; i < 20; i++) {
      const c = live(50 + i * 25);
      const price = c.latestQuote!.price;
      const snap = c.indicators!;
      for (const session of ["INTRADAY", "CLOSE", undefined] as const) {
        add("a typed level", { kind: "PRICE_ABOVE", level: price }, { ...c, session });
        add("a typed level", { kind: "PRICE_BELOW", level: price }, { ...c, session });
        add("a typed level on the close", { kind: "PRICE_ABOVE", level: price, basis: "close" }, { ...c, session });
      }
      for (const period of [20, 50, 200] as const) {
        const line = snap.sma[period];
        if (line == null) continue;
        for (const direction of ["ABOVE", "BELOW"] as const) add("an average", { kind: "VS_SMA", period, direction }, withPrice(c, line));
        const near = withPrice(c, line * 1.04);
        add("near an average", { kind: "NEAR_SMA", period, withinPct: (Math.abs(near.latestQuote!.price - line) / line) * 100 }, near);
      }
      add("the 20-day high", { kind: "NEW_HIGH", window: "20D" }, withPrice(c, snap.high20!));
      add("the 52-week high", { kind: "NEW_HIGH", window: "52W" }, withPrice(c, snap.high52w!));
      const under = withPrice(c, snap.high52w! * 0.95);
      add("near the 52-week high", { kind: "PCT_FROM_52W_HIGH", max: ((snap.high52w! - under.latestQuote!.price) / snap.high52w!) * 100 }, under);
      const chg = c.latestQuote!.changePct;
      add("yesterday's close", { kind: "PRICE_MOVE_PCT", pct: Math.abs(chg), direction: chg >= 0 ? "UP" : "DOWN", window: "1D" }, c);
      for (const [window, n] of [["5D", 5], ["20D", 20]] as const) {
        const m = movePctOverSessions(snap, price, n);
        if (m != null && m !== 0) add(`the close ${n} days back`, { kind: "PRICE_MOVE_PCT", pct: Math.abs(m), direction: m > 0 ? "UP" : "DOWN", window }, c);
      }
      const avg = c.position!.avgCost!;
      const gain = ((price - avg) / avg) * 100;
      add("our entry", { kind: "GAIN_FROM_ENTRY", pct: Math.abs(gain), direction: gain >= 0 ? "UP" : "DOWN" }, c);
      // The big-winner switch: a peak exactly this far off the buy, exactly this many days (or 0) after it.
      const down = withPrice(c, avg * 0.92);
      const fell = ((avg - down.latestQuote!.price) / avg) * 100;
      const ran = ((c.position!.peakPrice! - avg) / avg) * 100;
      for (const days of [5, 21]) {
        for (const peakAt of [new Date(c.position!.openedAt!.getTime() + days * DAY), c.position!.openedAt!]) {
          add("the big-winner switch", { kind: "GAIN_FROM_ENTRY", pct: fell, direction: "DOWN", skipIfPeakGainPct: ran, skipIfPeakWithinDays: days }, { ...down, position: { ...down.position!, peakAt } });
        }
      }
      for (const pct of [5, 12, 25]) {
        const line = trailFireLevel({ pct }, { peak: c.position!.peakPrice, avgCost: avg, isLong: true, atr: null });
        if (line != null) add("the trail line", { kind: "TRAILING_FROM_HIGH", pct }, withPrice(c, line));
        const armed = trailFireLevel({ pct, armAtGainPct: 10 }, { peak: c.position!.peakPrice, avgCost: avg, isLong: true, atr: null });
        if (armed != null) add("the trail line, armed", { kind: "TRAILING_FROM_HIGH", pct, armAtGainPct: 10 }, withPrice(c, armed));
      }
      const ratio = volumeRatio(snap, c.today!.volume);
      if (ratio != null) add("the volume ratio", { kind: "VOLUME_RATIO", min: ratio }, c);
      for (const period of [14, 2] as const) {
        const rsi = liveRsi(snap, price, period);
        if (rsi == null) continue;
        for (const direction of ["ABOVE", "BELOW"] as const) add(`the ${period}-day RSI`, { kind: "RSI", period, threshold: rsi, direction }, c);
      }
      for (const window of ["1M", "3M"] as const) {
        const rs = snap.rsVsSpy[window];
        if (rs != null) add("strength vs the S&P", { kind: "RS_VS_SPY", window, min: rs }, c);
      }
      const gapPct = ((c.today!.open! - c.latestQuote!.prevClose!) / c.latestQuote!.prevClose!) * 100;
      if (ratio != null) add("today's gap", { kind: "GAP_UP", minPct: gapPct, minVolRatio: ratio }, c);
      const buys = [0, 1, 2].map((k) => ({ name: `insider ${k}`, date: ago(c, 10 + k).toISOString().slice(0, 10), shares: 1000, price }));
      const withBuys: EvaluationContext = { ...c, indicators: { ...snap, insiderBuys: buys } };
      add("insider buyers", { kind: "INSIDER_CLUSTER", minBuyers: insiderCluster(buys, 30, c.now).buyers, days: 30 }, withBuys);
      // The day of the report, N days before it, and N days after it.
      const report = { ...REPORT, epsActual: 1, surprisePct: 4 + i };
      for (const n of [0, 1, 3]) {
        const ahead = { ...c, upcomingEarnings: { ...report, reportDate: ymd(new Date(c.now.getTime() + n * DAY)) } };
        const days = daysUntilReport(ahead.upcomingEarnings, c.now);
        add(n === 0 ? "the report day, before" : `${n} days before the report`, { kind: "EARNINGS_WITHIN", days: Math.max(1, days) }, ahead);
        const behind = { ...c, earnings: { ...report, reportDate: ymd(ago(c, n)) } };
        const since = -daysUntilReport(behind.earnings, c.now);
        add(n === 0 ? "the report day, after" : `${n} days after the report`, { kind: "EARNINGS_SINCE", min: since, max: since }, behind);
        add("the report day through N days after", { kind: "EARNINGS_SINCE", min: 0, max: since }, behind);
      }
      add("the surprise", { kind: "EARNINGS_BEAT", minSurprisePct: report.surprisePct }, { ...c, earnings: { ...report, reportDate: ymd(ago(c, 1)) } });
      add("the surprise", { kind: "EARNINGS_MISS", minSurprisePct: report.surprisePct }, { ...c, earnings: { ...report, surprisePct: -report.surprisePct, reportDate: ymd(ago(c, 1)) } });
      // N days to the minute: since the last review, since the buy, before and after the event date.
      for (const days of [1, 7, 30]) {
        add("days since the last review", { kind: "REVIEW_CADENCE", days }, { ...c, thesis: { ...c.thesis, lastReviewedAt: ago(c, days) } });
        add("days since the buy", { kind: "REVIEW_CADENCE", days, from: "BUY" }, { ...c, position: { ...c.position!, openedAt: ago(c, days) } });
        add("days before the event", { kind: "REVIEW_CADENCE", days, from: "EVENT", side: "BEFORE" }, { ...c, thesis: { ...c.thesis, catalystDate: ago(c, -days) } });
        add("0 days before the event", { kind: "REVIEW_CADENCE", days, from: "EVENT", side: "BEFORE" }, { ...c, thesis: { ...c.thesis, catalystDate: c.now } });
        add("days after the event", { kind: "REVIEW_CADENCE", days, from: "EVENT", side: "AFTER" }, { ...c, thesis: { ...c.thesis, catalystDate: ago(c, days) } });
      }
    }
    return out;
  }

  it("on the typed level, every variable's number, the trail line, the report day and N days to the minute", () => {
    const all = cases();
    const disagree: unknown[] = [];
    let holds = 0;
    for (const { p, ctx, on } of all) {
      const kinds = KIND_CHECKER.holds(p as StoredRow, ctx);
      if (kinds) holds++;
      if (SHAPE_CHECKER.holds(p as StoredRow, ctx) !== kinds) disagree.push({ on, p, kinds });
      for (const action of ["ENTER", "EXIT", "REVIEW"] as const) {
        const t: Trigger = { id: "t", predicate: p as StoredRow, action, rationale: "" };
        const a = shouldFire(t, ctx, KIND_CHECKER);
        const b = shouldFire({ ...t, predicate: toStoredPredicate(p) as StoredRow }, ctx);
        if (a.fires !== b.fires || a.reason !== b.reason) disagree.push({ on, p, action, a, b });
      }
      if (disagree.length > 5) break;
    }
    expect(disagree).toEqual([]);
    // Every line in the list is reached, and on a line some conditions hold and some don't.
    expect(new Set(all.map((x) => x.on)).size).toBeGreaterThanOrEqual(30);
    expect(holds).toBeGreaterThan(0);
    expect(holds).toBeLessThan(all.length);
  });
});
