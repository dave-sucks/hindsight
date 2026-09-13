/**
 * setup-scorecard.ts — keep score the way traders do: per setup, in units
 * of risk (TRADING_PLAYBOOK.md Part A "the four numbers", Part B step 9).
 * DAV-248.
 *
 * Pure. One row per setup × horizon × analyst × environment:
 *   trades, win rate, average R (gain ÷ the risk taken at entry), average
 *   hold, average give-back from the peak, and how often that setup's sell
 *   proposals were declined or left to expire.
 *
 * R needs the stop the trade opened with, which is not the stop it closed
 * with (stops rise). Position.initialStop carries it from 2026-09-11 on; older
 * trades read it off the INITIATE decision's text ("… stop $86.00)").
 * A trade with no readable entry stop counts in every column except R.
 */

import { getSetup } from "@/lib/agent/knowledge/setups";

export interface ClosedTrade {
  setupId: string | null;
  horizon: string | null;
  analyst: string;
  environment: string;
  direction: string;
  entry: number;
  initialStop: number | null;
  close: number;
  peak: number | null;
  openedAt: Date;
  closedAt: Date;
}

export interface SellProposalCount {
  setupId: string | null;
  horizon: string | null;
  analyst: string;
  environment: string;
  proposals: number;
  declined: number;
}

export interface SetupRow {
  setupId: string | null;
  setupName: string;
  horizon: string;
  analyst: string;
  environment: string;
  trades: number;
  wins: number;
  winRatePct: number;
  /** Average R over the trades with a readable entry stop; null if none. */
  avgR: number | null;
  rTrades: number;
  avgHoldDays: number;
  /** Peak gain minus close gain, percentage points; null if no peaks. */
  avgGiveBackPts: number | null;
  sellProposals: number;
  sellDeclined: number;
  /** Declined or expired ÷ proposed, %; null with no proposals. */
  declineRatePct: number | null;
}

/** The entry stop from an INITIATE decision's text: "… (target $95.00, stop $74.00)". */
export function parseStopFromDecision(reasoning: string | null | undefined): number | null {
  const m = reasoning?.match(/stop \$([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const isShort = (d: string) => d === "SHORT";

/** Gain in units of the risk taken. Null when the entry stop isn't on the losing side of entry. */
export function tradeR(t: Pick<ClosedTrade, "direction" | "entry" | "initialStop" | "close">): number | null {
  if (t.initialStop == null) return null;
  const risk = isShort(t.direction) ? t.initialStop - t.entry : t.entry - t.initialStop;
  if (!(risk > 0)) return null;
  const gain = isShort(t.direction) ? t.entry - t.close : t.close - t.entry;
  return gain / risk;
}

/** Peak gain minus close gain, in percentage points of entry. */
export function giveBackPts(t: Pick<ClosedTrade, "direction" | "entry" | "peak" | "close">): number | null {
  if (t.peak == null || !(t.entry > 0)) return null;
  const pct = (p: number) => ((isShort(t.direction) ? t.entry - p : p - t.entry) / t.entry) * 100;
  return Math.max(0, pct(t.peak) - pct(t.close));
}

const keyOf = (x: { setupId: string | null; horizon: string | null; analyst: string; environment: string }) =>
  [x.setupId ?? "", x.horizon ?? "", x.analyst, x.environment].join("|");

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function setupName(setupId: string | null): string {
  if (!setupId) return "Unlabelled";
  return getSetup(setupId)?.name ?? setupId;
}

export function buildScorecard(trades: ClosedTrade[], sells: SellProposalCount[] = []): SetupRow[] {
  const groups = new Map<string, ClosedTrade[]>();
  for (const t of trades) groups.set(keyOf(t), [...(groups.get(keyOf(t)) ?? []), t]);
  const sellBy = new Map<string, { proposals: number; declined: number }>();
  for (const s of sells) {
    const k = keyOf(s);
    const cur = sellBy.get(k) ?? { proposals: 0, declined: 0 };
    sellBy.set(k, { proposals: cur.proposals + s.proposals, declined: cur.declined + s.declined });
  }
  // A setup can have sell proposals (open positions) and no closed trade yet.
  for (const k of sellBy.keys()) if (!groups.has(k)) groups.set(k, []);

  const rows: SetupRow[] = [];
  for (const [k, ts] of groups) {
    const [setupId, horizon, analyst, environment] = k.split("|");
    const rs = ts.map(tradeR).filter((r): r is number => r != null);
    const gbs = ts.map(giveBackPts).filter((g): g is number => g != null);
    const wins = ts.filter((t) => (isShort(t.direction) ? t.close < t.entry : t.close > t.entry)).length;
    const sell = sellBy.get(k) ?? { proposals: 0, declined: 0 };
    rows.push({
      setupId: setupId || null,
      setupName: setupName(setupId || null),
      horizon: horizon || "—",
      analyst,
      environment,
      trades: ts.length,
      wins,
      winRatePct: ts.length ? Math.round((wins / ts.length) * 100) : 0,
      avgR: rs.length ? Math.round(mean(rs)! * 100) / 100 : null,
      rTrades: rs.length,
      avgHoldDays: ts.length
        ? Math.round(mean(ts.map((t) => (t.closedAt.getTime() - t.openedAt.getTime()) / 86_400_000))!)
        : 0,
      avgGiveBackPts: gbs.length ? Math.round(mean(gbs)! * 10) / 10 : null,
      sellProposals: sell.proposals,
      sellDeclined: sell.declined,
      declineRatePct: sell.proposals ? Math.round((sell.declined / sell.proposals) * 100) : null,
    });
  }
  return rows.sort((a, b) => b.trades - a.trades || a.setupName.localeCompare(b.setupName));
}

/**
 * One data line per setup for a prompt — the analyst's own record, all
 * horizons folded together: "Base breakout: 12 trades, 42% win, 1.9R, 11d
 * held, 6.0pts given back from the peak." Setups with no closed trade are
 * left out. Empty array = nothing to say.
 */
export function scorecardLines(trades: ClosedTrade[]): string[] {
  const bySetup = new Map<string, ClosedTrade[]>();
  for (const t of trades) bySetup.set(t.setupId ?? "", [...(bySetup.get(t.setupId ?? "") ?? []), t]);
  const lines: string[] = [];
  for (const [id, ts] of [...bySetup.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const row = buildScorecard(ts.map((t) => ({ ...t, horizon: null, analyst: "", environment: "" })))[0];
    lines.push(
      `${setupName(id || null)}: ${row.trades} trade${row.trades === 1 ? "" : "s"}, ${row.winRatePct}% win` +
        (row.avgR != null ? `, ${row.avgR >= 0 ? "+" : ""}${row.avgR.toFixed(1)}R` : "") +
        `, ${row.avgHoldDays}d held` +
        (row.avgGiveBackPts != null ? `, ${row.avgGiveBackPts.toFixed(1)}pts given back from the peak` : "") +
        ".",
    );
  }
  return lines;
}
