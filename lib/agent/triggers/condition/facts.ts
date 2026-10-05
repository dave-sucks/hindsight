/**
 * The numbers behind a chart fire, in one line, one entry per measure.
 *
 * A TRIGGER_FIRED row that says "Buy if within 2% of 50-day average" makes the
 * next agent re-fetch what the check already knew. The fire carries the
 * figures instead: "50-day $378.22; price $376.10 (−0.6% from it)".
 *
 * Server-only, like the checker beside it (./read): it reads the daily
 * indicator snapshot's helpers.
 */

import { liveRsi, movePctOverSessions, volumeRatio, type IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";
import { describeCluster, insiderCluster } from "@/lib/market-data/insider-cluster";
import type { Condition, Watch, When } from "./types";
import { isGroup } from "./types";
import { shapeOf } from "./legacy";
import { num } from "./words";

interface Today {
  open?: number | null;
  volume?: number | null;
  prevClose?: number | null;
  /** The check's clock: an insider cluster counts back from it. */
  now?: Date;
}
type Facts = (c: Condition, snap: IndicatorSnapshot, px: number | null, today: Today | null | undefined) => string | null;

const $ = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;
const smaPeriod = (v: string | undefined) => (v && /^sma(\d+)$/.test(v) ? (Number(v.slice(3)) as 20 | 50 | 150 | 200) : null);

/** "50-day $378.22; price $376.10 (−0.6% from it)" — under, over or near an average. */
const average: Facts = (c, snap, px) => {
  const period = smaPeriod(c.variable);
  const avg = period ? snap.sma[period] : null;
  if (period == null || avg == null || px == null) return null;
  return `${period}-day ${$(avg)}; price ${$(px)} (${pct(((px - avg) / avg) * 100)} from it)`;
};

const FACTS: Partial<Record<Watch, Facts>> = {
  price: (c, snap, px) => {
    if (smaPeriod(c.variable)) return average(c, snap, px, null);
    if (c.variable === "high20" || c.variable === "high52") {
      const hi = c.variable === "high20" ? snap.high20 : snap.high52w;
      return px == null ? null : `prior ${c.variable === "high20" ? "20-day" : "52-week"} high ${$(hi)}; price ${$(px)}`;
    }
    return null;
  },
  move: (c, snap, px) => {
    if (smaPeriod(c.variable)) return average(c, snap, px, null);
    if (c.variable === "high52") {
      return px == null ? null : `52-week high ${$(snap.high52w)}; price ${$(px)} (${(((snap.high52w - px) / snap.high52w) * 100).toFixed(1)}% below)`;
    }
    if (c.variable === "close_5d" || c.variable === "close_20d") {
      if (px == null) return null;
      const n = c.variable === "close_5d" ? 5 : 20;
      const m = movePctOverSessions(snap, px, n);
      const base = snap.closes[snap.closes.length - n];
      return m == null || base == null ? null : `${n}-session move ${pct(m)} from ${$(base)}`;
    }
    return null;
  },
  volume: (_c, snap, _px, today) => {
    const r = volumeRatio(snap, today?.volume);
    return r == null || today?.volume == null ? null : `volume so far ${(today.volume / 1e6).toFixed(2)}M = ${r.toFixed(2)}× the 20-day average`;
  },
  strength: (c, snap) => {
    const window = (c.settings?.window ?? "3M") as keyof IndicatorSnapshot["rsVsSpy"];
    const rs = snap.rsVsSpy[window];
    return rs == null ? null : `${window} return vs SPY ${rs >= 0 ? "+" : ""}${rs} pts (as of ${snap.asOf})`;
  },
  gap: (c, snap, _px, today) => {
    const min = c.value ?? 0;
    if (today?.open != null && today.prevClose) {
      const g = ((today.open - today.prevClose) / today.prevClose) * 100;
      const r = volumeRatio(snap, today.volume);
      if (g >= min) return `opened ${pct(g)} over the prior close ${$(today.prevClose)}${r != null ? ` on ${r.toFixed(1)}× volume so far` : ""}`;
    }
    const g = snap.gaps.find((x) => x.pct >= min);
    return g ? `gapped ${pct(g.pct)} ${g.sessionsAgo} session${g.sessionsAgo === 1 ? "" : "s"} ago (gap-day low ${$(g.low)}, high ${$(g.high)})` : null;
  },
  // Names the buyers (DAV-252).
  insiders: (c, snap, _px, today) =>
    snap.insiderBuys && today?.now ? describeCluster(insiderCluster(snap.insiderBuys, num(c.settings?.days) ?? 30, today.now)) : null,
  rsi: (c, snap, px) => {
    const period = num(c.settings?.period) ?? 14;
    const v = px == null ? null : liveRsi(snap, px, period);
    return v == null ? null : `RSI(${period}) ${v}`;
  },
};

function whenFacts(w: When, snap: IndicatorSnapshot, px: number | null, today: Today | null | undefined): string | null {
  if (!isGroup(w)) return FACTS[w.watch]?.(w, snap, px, today) ?? null;
  const parts = w.conditions.map((c) => whenFacts(c, snap, px, today)).filter((x): x is string => !!x);
  return parts.length ? parts.join("; ") : null;
}

/** The figures behind a chart fire, or null when it has none (a typed price, a schedule) or the snapshot is missing. */
export function describeChartFire(
  p: unknown,
  snap: IndicatorSnapshot | null | undefined,
  price: number | null | undefined,
  today?: Today | null,
): string | null {
  const w = shapeOf(p);
  if (!snap || !w) return null;
  return whenFacts(w, snap, price != null && price > 0 ? price : null, today);
}
