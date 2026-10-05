/**
 * The condition shape's checker against today's, over every stored trigger.
 *
 * Each of the 487 distinct stored conditions (909 triggers), plus the kinds and
 * options nothing stores yet, is checked in 300
 * seeded random market situations: prices around its own level, a snapshot,
 * a position, a report, filings, dates, a stale quote, the close pass. The
 * two checkers must agree on whether it holds, whether it reads the price and
 * whether it reads the next report, and the whole fire decision (crossing,
 * stale quote, cooldown, re-arm, a report it already fired for) must come out
 * the same. docs/plans/TRIGGER_TYPES.md, PR 2.
 */

import stored from "./__fixtures__/stored-triggers.json";
import { KIND_CHECKER, shouldFire, type EvaluationContext } from "../evaluate";
import type { Trigger, TriggerAction, TriggerPredicate } from "../types";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";
import type { SecFiling } from "@/lib/market-data/sec-events";
import { READERS, SHAPE_CHECKER, compareWithShape } from "./read";

type Row = { action: TriggerAction; predicate: TriggerPredicate; scopes: string[]; count: number };

/** Kinds and options no stored trigger uses yet (RSI, a gap, an insider cluster, the trail's options…), so every reader is exercised. */
const UNSTORED: TriggerPredicate[] = [
  { kind: "RSI", threshold: 30, direction: "BELOW" },
  { kind: "RSI", period: 2, threshold: 70, direction: "ABOVE" },
  { kind: "GAP_UP", minPct: 4, minVolRatio: 3 },
  { kind: "GAP_UP", minPct: 4, minVolRatio: 2, withinDays: 3 },
  { kind: "INSIDER_CLUSTER", minBuyers: 2, days: 30 },
  { kind: "INSIDER_CLUSTER", minBuyers: 3, days: 90 },
  { kind: "NEW_HIGH", window: "20D" },
  { kind: "NEW_HIGH", window: "52W" },
  { kind: "PCT_FROM_52W_HIGH", max: 8 },
  { kind: "PRICE_MOVE_PCT", pct: 6, direction: "UP", window: "20D" },
  { kind: "TRAILING_FROM_HIGH", pct: 12, armAtGainPct: 15, atrMultiple: 3 },
  { kind: "GAIN_FROM_ENTRY", pct: 20, direction: "UP", skipIfPeakGainPct: 20, skipIfPeakWithinDays: 21 },
  { kind: "EARNINGS_SINCE", min: 1, max: 3 },
  { kind: "SEC_EVENT", tier: "RED" },
  { kind: "SEC_EVENT", forms: ["S-3", "NT 10-Q"] },
  { kind: "SEC_EVENT", tier: "MATERIAL", items: ["8.01"] },
  { kind: "REVIEW_CADENCE", days: 10, from: "EVENT", side: "AFTER" },
  { kind: "OR", predicates: [{ kind: "VS_SMA", period: 50, direction: "BELOW" }, { kind: "RSI", threshold: 25, direction: "BELOW" }] },
];
const rows: Row[] = [
  ...(stored as { rows: Row[] }).rows,
  ...UNSTORED.flatMap((predicate) => (["ENTER", "EXIT", "REVIEW"] as const).map((action) => ({ action, predicate, scopes: ["live"], count: 1 }))),
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
function anchor(p: TriggerPredicate): number {
  if ("level" in p && typeof p.level === "number") return p.level;
  if (p.kind === "AND" || p.kind === "OR") return p.predicates.map(anchor).find((a) => a !== 100) ?? 100;
  return 100;
}

const NOW = new Date("2026-10-05T15:00:00.000Z");
const REPORT = { symbol: "X", reportDate: "", hour: null, epsActual: null, epsEstimate: 1, surprisePct: null, revenueActual: null, revenueEstimate: null, quarter: 3, year: 2026 };
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function situation(p: TriggerPredicate, rand: () => number): EvaluationContext {
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

describe("the condition shape's checker agrees with today's on every stored trigger", () => {
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
        const a = shouldFire(t, ctx);
        const b = shouldFire(t, ctx, SHAPE_CHECKER);
        if (a.fires !== b.fires || a.reason !== b.reason) disagree.push({ p, i, a, b, on: "shouldFire" });
        if (disagree.length > 5) break;
      }
      if (disagree.length > 5) break;
    }
    expect(disagree).toEqual([]);
    // The grid is only proof if it lands on both sides: a fair share of situations must hold.
    expect(holds / (rows.length * SITUATIONS)).toBeGreaterThan(0.15);
  });

  it("names the disagreement, and never throws, when the new checker fails", () => {
    const original = READERS.price.holds;
    (READERS.price as { holds: typeof original }).holds = () => {
      throw new Error("boom");
    };
    try {
      const rand = prng(7);
      const t: Trigger = { id: "floor", predicate: { kind: "PRICE_BELOW", level: 100 }, action: "EXIT", rationale: "" };
      const ctx = situation(t.predicate, rand);
      const d = compareWithShape(t, ctx, shouldFire(t, ctx));
      expect(d).toEqual(expect.objectContaining({ triggerId: "floor", kind: "PRICE_BELOW", shape: expect.objectContaining({ reason: "error", error: "boom" }) }));
    } finally {
      (READERS.price as { holds: typeof original }).holds = original;
    }
  });
});
