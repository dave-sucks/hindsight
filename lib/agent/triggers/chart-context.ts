/**
 * chart-context.ts — the numbers behind a chart-kind fire, in one line.
 *
 * A TRIGGER_FIRED row that says "Within 2% of the 50-day — buy" makes the
 * next agent re-fetch what the evaluator already knew. The fire carries the
 * figures instead: "50-day $378.22; price $376.10 (−0.6%)" (DAV-247
 * review). Pure.
 */

import type { TriggerPredicate } from "./types";
import {
  liveRsi,
  movePctOverSessions,
  volumeRatio,
  type IndicatorSnapshot,
} from "@/lib/market-data/indicator-snapshot";

const $ = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;

export function describeChartFire(
  p: TriggerPredicate,
  snap: IndicatorSnapshot | null | undefined,
  price: number | null | undefined,
  today?: { open?: number | null; volume?: number | null; prevClose?: number | null } | null,
): string | null {
  if (!snap) return null;
  const px = price != null && price > 0 ? price : null;
  switch (p.kind) {
    case "VS_SMA":
    case "NEAR_SMA": {
      const avg = snap.sma[p.period];
      if (avg == null || px == null) return null;
      return `${p.period}-day ${$(avg)}; price ${$(px)} (${pct(((px - avg) / avg) * 100)} from it)`;
    }
    case "VOLUME_RATIO": {
      const r = volumeRatio(snap, today?.volume);
      return r == null || today?.volume == null
        ? null
        : `volume so far ${(today.volume / 1e6).toFixed(2)}M = ${r.toFixed(2)}× the 20-day average`;
    }
    case "NEW_HIGH": {
      const hi = p.window === "20D" ? snap.high20 : snap.high52w;
      return px == null ? null : `prior ${p.window === "20D" ? "20-day" : "52-week"} high ${$(hi)}; price ${$(px)}`;
    }
    case "PCT_FROM_52W_HIGH":
      return px == null ? null : `52-week high ${$(snap.high52w)}; price ${$(px)} (${(((snap.high52w - px) / snap.high52w) * 100).toFixed(1)}% below)`;
    case "RS_VS_SPY": {
      const rs = snap.rsVsSpy[p.window];
      return rs == null ? null : `${p.window} return vs SPY ${rs >= 0 ? "+" : ""}${rs} pts (as of ${snap.asOf})`;
    }
    case "GAP_UP": {
      if (today?.open != null && today.prevClose) {
        const g = ((today.open - today.prevClose) / today.prevClose) * 100;
        const r = volumeRatio(snap, today.volume);
        if (g >= p.minPct) return `opened ${pct(g)} over the prior close ${$(today.prevClose)}${r != null ? ` on ${r.toFixed(1)}× volume so far` : ""}`;
      }
      const g = snap.gaps.find((x) => x.pct >= p.minPct);
      return g ? `gapped ${pct(g.pct)} ${g.sessionsAgo} session${g.sessionsAgo === 1 ? "" : "s"} ago (gap-day low ${$(g.low)}, high ${$(g.high)})` : null;
    }
    case "RSI": {
      const v = px == null ? null : liveRsi(snap, px, p.period ?? 14);
      return v == null ? null : `RSI(${p.period ?? 14}) ${v}`;
    }
    case "PRICE_MOVE_PCT": {
      if (p.window === "1D" || px == null) return null;
      const n = p.window === "5D" ? 5 : 20;
      const m = movePctOverSessions(snap, px, n);
      const base = snap.closes[snap.closes.length - n];
      return m == null || base == null ? null : `${n}-session move ${pct(m)} from ${$(base)}`;
    }
    case "AND":
    case "OR": {
      const parts = p.predicates
        .map((c) => describeChartFire(c, snap, price, today))
        .filter((x): x is string => !!x);
      return parts.length ? parts.join("; ") : null;
    }
    default:
      return null;
  }
}
