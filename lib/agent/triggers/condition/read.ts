/**
 * How each measure is read: does a condition hold against the evaluation
 * context. This is the checker beside today's (docs/plans/TRIGGER_TYPES.md,
 * PR 2): the trigger check runs both and logs any disagreement; after the
 * cutover it is the only one. One reader per measure, keyed like the catalog.
 *
 * Server-only: the earnings and insider helpers it reads sit next to their
 * vendor calls. The client half of each measure is ./measures, and the
 * barrel (./index) does not export this file.
 */

import type { Checker, EvaluationContext } from "../evaluate";
import { shouldFire } from "../evaluate";
import { daysUntilReport } from "../earnings";
import { trailFireLevel } from "../trail";
import type { Trigger } from "../types";
import { liveRsi, movePctOverSessions, volumeRatio, type IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";
import { insiderCluster } from "@/lib/market-data/insider-cluster";
import { unfiredMatches } from "@/lib/market-data/sec-events";
import { fromLegacy } from "./legacy";
import type { Condition, Watch, When } from "./types";
import { conditionsOf, isGroup, isRetired } from "./types";
import { num } from "./words";

interface Reader {
  holds(c: Condition, ctx: EvaluationContext): boolean;
  /** Compares the live price to a level, so a buy on it fires on the crossing. */
  readsPrice?(c: Condition): boolean;
  /** Reads the next scheduled report: a heads-up fires once per report. */
  readsReport?(c: Condition): boolean;
}

const DAY = 86_400_000;

/** The prices a variable stands for that come off the daily snapshot. */
const SNAPSHOT_LEVEL: Readonly<Partial<Record<string, (s: IndicatorSnapshot) => number | null>>> = {
  sma20: (s) => s.sma[20],
  sma50: (s) => s.sma[50],
  sma150: (s) => s.sma[150],
  sma200: (s) => s.sma[200],
  high20: (s) => s.high20,
  low20: (s) => s.low20,
  high52: (s) => s.high52w,
  low52: (s) => s.low52w,
};

function snapshotLevel(variable: string, ctx: EvaluationContext): number | null {
  const read = SNAPSHOT_LEVEL[variable];
  return read && ctx.indicators ? read(ctx.indicators) : null;
}

/** % above or below the variable, the way each one is measured. Null when the context can't say. */
const MOVE_FROM: Readonly<Partial<Record<string, (ctx: EvaluationContext) => number | null>>> = {
  // The quote's own change on the day, the number every app shows.
  prev_close: (ctx) => (typeof ctx.latestQuote?.changePct === "number" ? ctx.latestQuote.changePct : null),
  close_5d: (ctx) => (ctx.indicators && ctx.latestQuote ? movePctOverSessions(ctx.indicators, ctx.latestQuote.price, 5) : null),
  close_20d: (ctx) => (ctx.indicators && ctx.latestQuote ? movePctOverSessions(ctx.indicators, ctx.latestQuote.price, 20) : null),
};

const isLong = (ctx: EvaluationContext) => ctx.thesis.direction !== "SHORT";
const setting = (c: Condition, key: string) => c.settings?.[key];

/** Our gain from the entry, a short's being a fall. */
function gainFrom(base: number, price: number, ctx: EvaluationContext): number {
  return isLong(ctx) ? ((price - base) / base) * 100 : ((base - price) / base) * 100;
}

/** The big-winner switch: the peak ran this far off the buy, fast enough (playbook: +20% in ≤ 3 weeks, then hold). */
function ranUpFast(c: Condition, ctx: EvaluationContext, avg: number): boolean {
  const pct = num(setting(c, "fastWinnerPct"));
  const peak = ctx.position?.peakPrice;
  if (pct == null || peak == null) return false;
  if (gainFrom(avg, peak, ctx) < pct) return false;
  const within = num(setting(c, "fastWinnerDays"));
  if (within == null) return true;
  const opened = ctx.position?.openedAt;
  const peakAt = ctx.position?.peakAt;
  if (opened == null || peakAt == null) return false;
  const days = (peakAt.getTime() - opened.getTime()) / DAY;
  return days >= 0 && days <= within;
}

export const READERS: Readonly<Record<Watch, Reader>> = {
  price: {
    holds: (c, ctx) => {
      const price = ctx.latestQuote?.price;
      if (price == null) return false;
      // "Only on the close" waits for the 16:20 pass.
      if (setting(c, "close") === true && ctx.session === "INTRADAY") return false;
      const line = c.variable ? snapshotLevel(c.variable, ctx) : c.value;
      if (line == null) return false;
      return c.is === "above" ? price > line : price < line;
    },
    readsPrice: () => true,
  },

  move: {
    holds: (c, ctx) => {
      const v = c.value;
      const variable = c.variable;
      const price = ctx.latestQuote?.price;
      if (v == null || variable == null) return false;
      if (c.is === "near") {
        const line = snapshotLevel(variable, ctx);
        if (line == null || line <= 0 || price == null) return false;
        // A high is approached from below: above it counts as on it.
        const off = variable.startsWith("high") ? Math.max(0, ((line - price) / line) * 100) : (Math.abs(price - line) / line) * 100;
        return off <= v;
      }
      if (variable === "entry") {
        const avg = ctx.position?.avgCost;
        if (avg == null || avg <= 0 || price == null) return false;
        if (ranUpFast(c, ctx, avg)) return false;
        const gain = gainFrom(avg, price, ctx);
        return c.is === "above" ? gain >= v : gain <= -v;
      }
      if (variable === "peak") {
        const peak = ctx.position?.peakPrice;
        if (peak == null || peak <= 0 || price == null) return false;
        const trail = trailFireLevel(
          { pct: v, armAtGainPct: num(setting(c, "startOnceUpPct")), atrMultiple: num(setting(c, "widenAtr")) },
          { peak, avgCost: ctx.position?.avgCost, isLong: isLong(ctx), atr: ctx.indicators?.atr14 },
        );
        if (trail == null) return false;
        return isLong(ctx) ? price <= trail : price >= trail;
      }
      const move = MOVE_FROM[variable]?.(ctx) ?? null;
      if (move == null) return false;
      return c.is === "above" ? move >= v : move <= -v;
    },
    // A 1-day move reads the quote's own change and can't be re-read at the close.
    readsPrice: (c) => c.is === "near" || c.variable === "close_5d" || c.variable === "close_20d",
  },

  volume: {
    holds: (c, ctx) => {
      const ratio = ctx.indicators ? volumeRatio(ctx.indicators, ctx.today?.volume) : null;
      return ratio != null && c.value != null && ratio >= c.value;
    },
  },

  rsi: {
    holds: (c, ctx) => {
      if (!ctx.indicators || ctx.latestQuote == null || c.value == null) return false;
      const value = liveRsi(ctx.indicators, ctx.latestQuote.price, num(setting(c, "period")) ?? 14);
      if (value == null) return false;
      return c.is === "above" ? value > c.value : value < c.value;
    },
    readsPrice: () => true,
  },

  strength: {
    holds: (c, ctx) => {
      const window = setting(c, "window");
      const rs = ctx.indicators?.rsVsSpy[window === "1M" || window === "6M" ? window : "3M"];
      return rs != null && c.value != null && rs >= c.value;
    },
  },

  gap: {
    holds: (c, ctx) => {
      const snap = ctx.indicators;
      const minPct = c.value;
      if (!snap || minPct == null) return false;
      const minVol = num(setting(c, "volume")) ?? 3;
      const within = num(setting(c, "withinDays")) ?? 1;
      const prevClose = ctx.latestQuote?.prevClose;
      const open = ctx.today?.open;
      if (open != null && prevClose != null && prevClose > 0) {
        const ratio = volumeRatio(snap, ctx.today?.volume);
        if (((open - prevClose) / prevClose) * 100 >= minPct && ratio != null && ratio >= minVol) return true;
      }
      return snap.gaps.some((g) => g.sessionsAgo < within && g.pct >= minPct && g.volumeRatio != null && g.volumeRatio >= minVol);
    },
  },

  report: {
    holds: (c, ctx) => {
      if (c.value == null) return false;
      if (c.is === "before") {
        // 0 = reports today: a before-open print has happened, an after-close one is tonight.
        const next = ctx.upcomingEarnings;
        if (!next) return false;
        const days = daysUntilReport(next, ctx.now);
        return days >= 0 && days <= c.value;
      }
      const r = ctx.earnings;
      if (!r || r.epsActual == null) return false;
      const since = -daysUntilReport(r, ctx.now);
      return since >= (num(setting(c, "fromDay")) ?? 0) && since <= c.value;
    },
    readsReport: (c) => c.is === "before",
  },

  surprise: {
    holds: (c, ctx) => {
      const surprise = ctx.earnings?.surprisePct ?? null;
      const min = c.value != null && c.value > 0 ? c.value : null;
      if (surprise == null) return false;
      if (c.is === "beat") return surprise > 0 && (min == null || surprise >= min);
      return surprise < 0 && (min == null || Math.abs(surprise) >= min);
    },
  },

  filing: {
    // A matching filing this trigger hasn't fired on yet.
    holds: (c, ctx) => {
      const v = c.variable;
      if (!v) return false;
      const rule = v.startsWith("tier:")
        ? { tier: v === "tier:RED" ? ("RED" as const) : ("MATERIAL" as const) }
        : v.startsWith("item:")
          ? { items: [v.slice(5)] }
          : { forms: [v.slice(5)] };
      return unfiredMatches(rule, ctx.filings, ctx.firedFilings).length > 0;
    },
  },

  insiders: {
    holds: (c, ctx) => {
      const buys = ctx.indicators?.insiderBuys;
      if (!buys || c.value == null) return false;
      return insiderCluster(buys, num(setting(c, "days")) ?? 30, ctx.now).buyers >= c.value;
    },
  },

  repeat: {
    // Counted from the last actual review; a thesis nobody has looked at is due now.
    holds: (c, ctx) => {
      const last = ctx.thesis.lastReviewedAt ?? ctx.thesis.createdAt;
      return c.value != null && (ctx.now.getTime() - last.getTime()) / DAY >= c.value;
    },
  },

  from_date: {
    holds: (c, ctx) => {
      if (c.value == null) return false;
      if (c.variable === "buy") {
        // Counts from the fill; a watch can carry it ahead of one.
        const opened = ctx.position?.openedAt;
        return opened != null && (ctx.now.getTime() - opened.getTime()) / DAY >= c.value;
      }
      const event = ctx.thesis.catalystDate;
      if (c.variable !== "event" || !event) return false;
      const daysUntil = (event.getTime() - ctx.now.getTime()) / DAY;
      return c.is === "before" ? daysUntil >= 0 && daysUntil <= c.value : -daysUntil >= c.value;
    },
  },
};

export function whenHolds(w: When, ctx: EvaluationContext): boolean {
  if (!isGroup(w)) return READERS[w.watch].holds(w, ctx);
  return w.match === "all" ? w.conditions.every((x) => whenHolds(x, ctx)) : w.conditions.some((x) => whenHolds(x, ctx));
}

/** The condition shape's answers to `shouldFire`'s three questions, read off the catalog. */
export const SHAPE_CHECKER: Checker = {
  holds: (p, ctx) => {
    const w = fromLegacy(p);
    return !isRetired(w) && whenHolds(w, ctx);
  },
  readsPrice: (p) => {
    const w = fromLegacy(p);
    return !isRetired(w) && conditionsOf(w).some((c) => READERS[c.watch].readsPrice?.(c) === true);
  },
  readsUpcomingReport: (p) => {
    const w = fromLegacy(p);
    return !isRetired(w) && conditionsOf(w).some((c) => READERS[c.watch].readsReport?.(c) === true);
  },
};

export interface Disagreement {
  triggerId: string;
  kind: string;
  kinds: ReturnType<typeof shouldFire>;
  shape: ReturnType<typeof shouldFire> | { fires: false; reason: "error"; error: string };
}

/**
 * The same fire decision through the condition shape, compared with the one
 * the check acted on. Null when they agree. Never throws: an error in the new
 * checker is a disagreement, logged, and the check carries on with today's.
 */
export function compareWithShape(trigger: Trigger, ctx: EvaluationContext, kinds: ReturnType<typeof shouldFire>): Disagreement | null {
  try {
    const shape = shouldFire(trigger, ctx, SHAPE_CHECKER);
    if (shape.fires === kinds.fires && shape.reason === kinds.reason) return null;
    return { triggerId: trigger.id, kind: trigger.predicate.kind, kinds, shape };
  } catch (e) {
    return { triggerId: trigger.id, kind: trigger.predicate.kind, kinds, shape: { fires: false, reason: "error", error: e instanceof Error ? e.message : String(e) } };
  }
}
