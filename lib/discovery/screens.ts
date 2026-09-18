/**
 * screens.ts — deterministic candidate screens, one per setup family
 * (DAV-255, playbook Part D "Screen" lines).
 *
 * A screen takes what the vendors already give us — the earnings calendar
 * row and the chart (lib/market-data/price-structure) — and says, with the
 * numbers, whether a name is a candidate for that setup today. Pure: no
 * fetches, no clock beyond `now`. The tool (lib/agent/tools/run-screen.ts)
 * builds the pool, fetches the bars, and hands rows here.
 *
 * Every rejection is named, so the chat can say why a name that looked
 * interesting isn't a candidate ("a beat the market sold: −8.2% on the
 * reaction day"). Every pass carries a `screenRow` — the numbers that made
 * the cut, in one line — which rides into dispatch_thesis_research as the
 * writer's seed.
 */

import type { PriceStructure } from "@/lib/market-data/price-structure";
import type { EarningsReport } from "@/lib/agent/triggers/earnings";
import {
  BREAKOUT_VOLUME_RATIO,
  CHASE_LIMIT_PCT,
  EP_GAP_MIN_PCT,
  EP_GAP_MIN_VOLUME_RATIO,
  PEAD_ENTRY_WINDOW,
  PEAD_MAX_RUN_PAST_GAP_PCT,
  PEAD_MIN_SURPRISE_PCT,
  PEAD_REACTION_VOLUME_RATIO,
  PULLBACK_NEAR_SMA_PCT,
} from "@/lib/agent/knowledge/setups";

export type ScreenSetup = "PEAD" | "EPISODIC_PIVOT" | "MA_PULLBACK" | "BASE_BREAKOUT" | "MOMENTUM_FLAG";

export interface ScreenInput {
  ticker: string;
  /** The chart through the last completed session; null when bars failed. */
  structure: PriceStructure | null;
  /** The reported row, for the earnings setups. */
  report?: EarningsReport | null;
  /** Calendar days since the report (the report day is 0), when known. */
  daysSinceReport?: number | null;
  /**
   * Trailing returns over 1, 3 and 6 months (lib/market-data/movers).
   * The momentum screen is about the run, not today's move, so it needs
   * them; every other screen ignores them (DAV-287).
   */
  trailing?: { move1m: number | null; move3m: number | null; move6m: number | null } | null;
}

export interface ScreenRow {
  ticker: string;
  setup: ScreenSetup;
  /** Sort key — higher is a better candidate. */
  score: number;
  /** The numbers that made the cut, one line — the writer's seed. */
  screenRow: string;
}

export interface ScreenReject {
  ticker: string;
  setup: ScreenSetup;
  reason: string;
}

export interface ScreenResult {
  passed: ScreenRow[];
  rejected: ScreenReject[];
}

/** D2: "already moved 30–100%+ in 1–3 months". The bar for "has run". */
export const MOMENTUM_MIN_RUN_PCT = 30;
/** D2: the daily range a momentum trade needs to pay for its risk. */
export const MOMENTUM_MIN_ADR_PCT = 3;
/** Further above its rising average than this is extended, not resting. */
export const MOMENTUM_MAX_EXTENDED_PCT = 15;

const pct = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
const $ = (n: number) => `$${n.toFixed(2)}`;

/**
 * The reaction to the report: the first gap on or after the report day,
 * read off the chart's recent gaps (newest first). Null when the chart
 * shows no 3%+ gap in the window — a quiet reaction.
 */
function reactionGap(s: PriceStructure, reportDate: string) {
  const onOrAfter = s.gaps.filter((g) => g.date >= reportDate).sort((a, b) => a.date.localeCompare(b.date));
  return onOrAfter[0] ?? null;
}

/** D4 — a clean beat the market under-reacted to, inside the entry window. */
export function screenPead(rows: ScreenInput[]): ScreenResult {
  const passed: ScreenRow[] = [];
  const rejected: ScreenReject[] = [];
  for (const r of rows) {
    const setup = "PEAD" as const;
    const rep = r.report;
    if (!rep || rep.epsActual == null) {
      rejected.push({ ticker: r.ticker, setup, reason: "no reported figures" });
      continue;
    }
    if (rep.surprisePct == null) {
      rejected.push({ ticker: r.ticker, setup, reason: "no usable EPS estimate, so no surprise to measure" });
      continue;
    }
    if (rep.surprisePct < PEAD_MIN_SURPRISE_PCT) {
      rejected.push({ ticker: r.ticker, setup, reason: `EPS surprise ${pct(rep.surprisePct)} is under the ${PEAD_MIN_SURPRISE_PCT}% bar` });
      continue;
    }
    if (rep.revenueActual != null && rep.revenueEstimate != null && rep.revenueActual < rep.revenueEstimate) {
      rejected.push({ ticker: r.ticker, setup, reason: "revenue missed — an EPS beat on a revenue miss is cost, not demand" });
      continue;
    }
    if (r.daysSinceReport != null && r.daysSinceReport > PEAD_ENTRY_WINDOW[1]) {
      rejected.push({ ticker: r.ticker, setup, reason: `reported ${r.daysSinceReport} days ago — the drift entry is days ${PEAD_ENTRY_WINDOW[0]}–${PEAD_ENTRY_WINDOW[1]}` });
      continue;
    }
    const s = r.structure;
    if (!s) {
      rejected.push({ ticker: r.ticker, setup, reason: "no chart" });
      continue;
    }
    const gap = reactionGap(s, rep.reportDate);
    if (gap && gap.direction === "DOWN") {
      rejected.push({ ticker: r.ticker, setup, reason: `a beat the market sold: gapped ${pct(gap.pct)} on ${gap.date}${gap.volumeRatio != null ? ` on ${gap.volumeRatio.toFixed(1)}× volume` : ""}` });
      continue;
    }
    if (gap && gap.volumeRatio != null && gap.volumeRatio < PEAD_REACTION_VOLUME_RATIO) {
      rejected.push({ ticker: r.ticker, setup, reason: `reaction-day volume ${gap.volumeRatio.toFixed(1)}× is under the ${PEAD_REACTION_VOLUME_RATIO}× bar` });
      continue;
    }
    if (gap && s.price < gap.mid) {
      rejected.push({ ticker: r.ticker, setup, reason: `the gap didn't hold: ${$(s.price)} is under the gap-day midpoint ${$(gap.mid)}` });
      continue;
    }
    const runPastGap = gap ? ((s.price - gap.high) / gap.high) * 100 : null;
    if (runPastGap != null && runPastGap > PEAD_MAX_RUN_PAST_GAP_PCT) {
      rejected.push({ ticker: r.ticker, setup, reason: `already ${pct(runPastGap)} past the gap-day high — most of the edge is gone` });
      continue;
    }
    const parts = [
      `reported ${rep.reportDate}`,
      `EPS ${pct(rep.surprisePct)} vs the street`,
      rep.revenueActual != null && rep.revenueEstimate != null ? `revenue ${pct(((rep.revenueActual - rep.revenueEstimate) / Math.abs(rep.revenueEstimate)) * 100)}` : null,
      gap ? `gapped ${pct(gap.pct)} on ${gap.volumeRatio != null ? `${gap.volumeRatio.toFixed(1)}×` : "?"} volume, held (low ${$(gap.low)}, mid ${$(gap.mid)})` : "no 3%+ gap on the reaction",
      `price ${$(s.price)}`,
      s.atr14 ? `ATR ${$(s.atr14.dollars)}` : null,
    ].filter(Boolean);
    passed.push({ ticker: r.ticker, setup, score: rep.surprisePct + (gap?.volumeRatio ?? 0), screenRow: parts.join("; ") });
  }
  passed.sort((a, b) => b.score - a.score);
  return { passed, rejected };
}

/** D3 — a neglected stock gaps 8%+ on 3×+ volume on real news. */
export function screenEpisodicPivot(rows: ScreenInput[]): ScreenResult {
  const passed: ScreenRow[] = [];
  const rejected: ScreenReject[] = [];
  for (const r of rows) {
    const setup = "EPISODIC_PIVOT" as const;
    const s = r.structure;
    if (!s) {
      rejected.push({ ticker: r.ticker, setup, reason: "no chart" });
      continue;
    }
    const gap = s.gaps.find((g) => g.direction === "UP");
    if (!gap) {
      rejected.push({ ticker: r.ticker, setup, reason: "no gap up in the last 10 sessions" });
      continue;
    }
    if (gap.pct < EP_GAP_MIN_PCT) {
      rejected.push({ ticker: r.ticker, setup, reason: `gap ${pct(gap.pct)} is under the ${EP_GAP_MIN_PCT}% bar` });
      continue;
    }
    if (gap.volumeRatio == null || gap.volumeRatio < EP_GAP_MIN_VOLUME_RATIO) {
      rejected.push({ ticker: r.ticker, setup, reason: `gap-day volume ${gap.volumeRatio?.toFixed(1) ?? "?"}× is under the ${EP_GAP_MIN_VOLUME_RATIO}× bar` });
      continue;
    }
    const m3 = s.relativeStrength.vsSpy?.m3;
    if (m3 != null && m3 > 30) {
      rejected.push({ ticker: r.ticker, setup, reason: `already ran: ${pct(m3)} vs SPY over 3 months — not neglected` });
      continue;
    }
    if (s.price < gap.mid) {
      rejected.push({ ticker: r.ticker, setup, reason: `the gap didn't hold: ${$(s.price)} is under the gap-day midpoint ${$(gap.mid)}` });
      continue;
    }
    passed.push({
      ticker: r.ticker,
      setup,
      score: gap.pct * (gap.volumeRatio ?? 1),
      screenRow: `gapped ${pct(gap.pct)} on ${gap.date} on ${gap.volumeRatio.toFixed(1)}× volume; gap-day low ${$(gap.low)}, mid ${$(gap.mid)}, high ${$(gap.high)}; price ${$(s.price)}${s.atr14 ? `; ATR ${$(s.atr14.dollars)}` : ""}`,
    });
  }
  passed.sort((a, b) => b.score - a.score);
  return { passed, rejected };
}

/** D5 — a confirmed uptrend pulled back to its rising 20- or 50-day on light volume. */
export function screenPullback(rows: ScreenInput[]): ScreenResult {
  const passed: ScreenRow[] = [];
  const rejected: ScreenReject[] = [];
  const near = PULLBACK_NEAR_SMA_PCT + 1; // within 3%: the screen is looser than the arm (D5 "within 2–3%")
  for (const r of rows) {
    const setup = "MA_PULLBACK" as const;
    const s = r.structure;
    if (!s) {
      rejected.push({ ticker: r.ticker, setup, reason: "no chart" });
      continue;
    }
    if (s.verdict !== "UPTREND" && s.verdict !== "PULLBACK_IN_UPTREND") {
      rejected.push({ ticker: r.ticker, setup, reason: `not in an uptrend (${s.verdict ?? "unknown"})` });
      continue;
    }
    const m3 = s.relativeStrength.vsSpy?.m3;
    if (m3 != null && m3 <= 0) {
      rejected.push({ ticker: r.ticker, setup, reason: `lagging SPY over 3 months (${pct(m3)})` });
      continue;
    }
    const candidates = [
      ["20-day", s.sma.d20],
      ["50-day", s.sma.d50],
    ] as const;
    const touched = candidates.find(([, m]) => m && m.slope === "RISING" && Math.abs(m.pctFromPrice) <= near);
    if (!touched) {
      const d20 = s.sma.d20 ? `${pct(s.sma.d20.pctFromPrice)} from the 20-day` : "no 20-day";
      const d50 = s.sma.d50 ? `${pct(s.sma.d50.pctFromPrice)} from the 50-day` : "no 50-day";
      rejected.push({ ticker: r.ticker, setup, reason: `not within ${near}% of a rising average (${d20}, ${d50})` });
      continue;
    }
    if (s.volume.lastVsAvg20 != null && s.volume.lastVsAvg20 > 1.5) {
      rejected.push({ ticker: r.ticker, setup, reason: `the pullback came on ${s.volume.lastVsAvg20.toFixed(1)}× volume — distribution, not a healthy dip` });
      continue;
    }
    const [label, m] = touched;
    const tt = s.trendTemplate ? `${s.trendTemplate.passed}/${s.trendTemplate.of}` : "?";
    passed.push({
      ticker: r.ticker,
      setup,
      score: (m3 ?? 0) + (s.trendTemplate?.passed ?? 0),
      screenRow: `${pct(m!.pctFromPrice)} from the rising ${label} ${$(m!.value)}; Trend Template ${tt}; vs SPY 3M ${m3 != null ? pct(m3) : "?"}; last session ${s.volume.lastVsAvg20?.toFixed(2) ?? "?"}× volume; price ${$(s.price)}${s.atr14 ? `; ATR ${$(s.atr14.dollars)}` : ""}`,
    });
  }
  passed.sort((a, b) => b.score - a.score);
  return { passed, rejected };
}

/** D1 — a Stage 2 stock in a tight base under a clear pivot, volume drying up. */
export function screenBaseBreakout(rows: ScreenInput[]): ScreenResult {
  const passed: ScreenRow[] = [];
  const rejected: ScreenReject[] = [];
  for (const r of rows) {
    const setup = "BASE_BREAKOUT" as const;
    const s = r.structure;
    if (!s) {
      rejected.push({ ticker: r.ticker, setup, reason: "no chart" });
      continue;
    }
    if (!s.trendTemplate || s.trendTemplate.passed < s.trendTemplate.of - 1) {
      rejected.push({ ticker: r.ticker, setup, reason: `Trend Template ${s.trendTemplate ? `${s.trendTemplate.passed}/${s.trendTemplate.of}` : "unreadable"}` });
      continue;
    }
    if (!s.base) {
      rejected.push({ ticker: r.ticker, setup, reason: "no base (no sideways stretch of 20+ sessions inside a 15% range)" });
      continue;
    }
    if (s.base.lastContractionPct > 8) {
      rejected.push({ ticker: r.ticker, setup, reason: `last contraction ${s.base.lastContractionPct.toFixed(1)}% — not tight yet (≤ 8%)` });
      continue;
    }
    const distToPivot = ((s.base.pivot - s.price) / s.price) * 100;
    if (s.base.brokenOut && -distToPivot > CHASE_LIMIT_PCT) {
      rejected.push({ ticker: r.ticker, setup, reason: `already ${pct(-distToPivot)} past the pivot ${$(s.base.pivot)} — past the chase limit` });
      continue;
    }
    if (s.volume.lastVsAvg20 != null && s.volume.lastVsAvg20 > BREAKOUT_VOLUME_RATIO && !s.base.brokenOut) {
      rejected.push({ ticker: r.ticker, setup, reason: `volume ${s.volume.lastVsAvg20.toFixed(1)}× inside the base — not drying up` });
      continue;
    }
    passed.push({
      ticker: r.ticker,
      setup,
      score: 100 - Math.abs(distToPivot) - s.base.lastContractionPct,
      screenRow: `base ${s.base.lengthBars} sessions, ${s.base.depthPct.toFixed(1)}% deep, last contraction ${s.base.lastContractionPct.toFixed(1)}%; pivot ${$(s.base.pivot)} (${pct(distToPivot)} away${s.base.brokenOut ? ", broken out" : ""}); base low ${$(s.base.low)}; Trend Template ${s.trendTemplate.passed}/${s.trendTemplate.of}; price ${$(s.price)}${s.atr14 ? `; ATR ${$(s.atr14.dollars)}` : ""}`,
    });
  }
  passed.sort((a, b) => b.score - a.score);
  return { passed, rejected };
}

/**
 * D2 — a momentum leader resting. The stock has already run (that is the
 * point: it is a leader), its daily range is wide enough to pay for the
 * risk, and it is pulling back in an orderly way against a rising short
 * average rather than breaking down.
 *
 * The one screen that is about the run rather than today's move: a stock up
 * 200% over a month that is quiet today is invisible to every other pool we
 * have (DAV-287). It is only as good as the universe it is handed — today's
 * movers miss the quiet climbers, and the ranked universe is the Signals
 * lane's half of this ticket.
 */
export function screenMomentum(rows: ScreenInput[]): ScreenResult {
  const passed: ScreenRow[] = [];
  const rejected: ScreenReject[] = [];
  for (const r of rows) {
    const setup = "MOMENTUM_FLAG" as const;
    const s = r.structure;
    if (!s) {
      rejected.push({ ticker: r.ticker, setup, reason: "no chart" });
      continue;
    }
    const run1m = r.trailing?.move1m ?? null;
    const run3m = r.trailing?.move3m ?? null;
    const best = Math.max(run1m ?? -Infinity, run3m ?? -Infinity);
    if (!Number.isFinite(best)) {
      rejected.push({ ticker: r.ticker, setup, reason: "no 1- or 3-month return to rank on" });
      continue;
    }
    if (best < MOMENTUM_MIN_RUN_PCT) {
      rejected.push({
        ticker: r.ticker,
        setup,
        reason: `hasn't run: ${run1m != null ? `1M ${pct(run1m)}` : "1M ?"}, ${run3m != null ? `3M ${pct(run3m)}` : "3M ?"} — under the ${MOMENTUM_MIN_RUN_PCT}% bar`,
      });
      continue;
    }
    // A leader that is already broken is not a flag. The six-month number
    // is the shell test: AEMD was +374% on the day and −38% over six months.
    const run6m = r.trailing?.move6m ?? null;
    if (run6m != null && run6m <= 0) {
      rejected.push({ ticker: r.ticker, setup, reason: `up on the month but ${pct(run6m)} over six — a bounce in a downtrend, not a leader` });
      continue;
    }
    if (s.verdict !== "UPTREND" && s.verdict !== "PULLBACK_IN_UPTREND") {
      rejected.push({ ticker: r.ticker, setup, reason: `not in an uptrend (${s.verdict ?? "unknown"})` });
      continue;
    }
    const adr = s.adr20Pct;
    if (adr == null || adr < MOMENTUM_MIN_ADR_PCT) {
      rejected.push({ ticker: r.ticker, setup, reason: `daily range ${adr != null ? `${adr.toFixed(1)}%` : "unknown"} — under the ${MOMENTUM_MIN_ADR_PCT}% a momentum trade needs to pay for its risk` });
      continue;
    }
    // Resting against a rising short average is the flag. Far above it is
    // extended — the chase rule would refuse the buy anyway.
    const short = [
      ["10-day", s.sma.d20],
      ["20-day", s.sma.d20],
      ["50-day", s.sma.d50],
    ] as const;
    const riding = short.find(([, m]) => m && m.slope === "RISING" && m.pctFromPrice <= MOMENTUM_MAX_EXTENDED_PCT);
    if (!riding) {
      const d20 = s.sma.d20 ? `${pct(s.sma.d20.pctFromPrice)} from the 20-day` : "no 20-day";
      rejected.push({ ticker: r.ticker, setup, reason: `extended or not riding a rising average (${d20})` });
      continue;
    }
    const [label, m] = riding;
    const tt = s.trendTemplate ? `${s.trendTemplate.passed}/${s.trendTemplate.of}` : "?";
    passed.push({
      ticker: r.ticker,
      setup,
      score: best,
      screenRow:
        `up ${run1m != null ? pct(run1m) : "?"} over 1M, ${run3m != null ? pct(run3m) : "?"} over 3M` +
        `${run6m != null ? `, ${pct(run6m)} over 6M` : ""}; ` +
        `daily range ${adr.toFixed(1)}%; ${pct(m!.pctFromPrice)} from the rising ${label} ${$(m!.value)}; ` +
        `Trend Template ${tt}; price ${$(s.price)}${s.atr14 ? `; ATR ${$(s.atr14.dollars)}` : ""}`,
    });
  }
  passed.sort((a, b) => b.score - a.score);
  return { passed, rejected };
}

export function runScreen(setup: ScreenSetup, rows: ScreenInput[]): ScreenResult {
  switch (setup) {
    case "PEAD":
      return screenPead(rows);
    case "EPISODIC_PIVOT":
      return screenEpisodicPivot(rows);
    case "MA_PULLBACK":
      return screenPullback(rows);
    case "BASE_BREAKOUT":
      return screenBaseBreakout(rows);
    case "MOMENTUM_FLAG":
      return screenMomentum(rows);
  }
}
