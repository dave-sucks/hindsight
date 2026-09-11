/**
 * Position sizing — three plain settings on the analyst, one helper.
 *
 *   Smallest trade   (AgentConfig.minPositionSize)  — a buy is never less.
 *   Largest trade    (AgentConfig.maxPositionSize)  — a buy is never more;
 *                                                     STRONG/HIGH conviction
 *                                                     buys exactly this.
 *   Most in one stock (AgentConfig.maxPositionTotal) — adding to a winner
 *                                                     stops here.
 *
 * Until 2026-09-08 there were two more numbers: `realMaxPosition`, a
 * "live promotion cap" that was a second largest-trade applying only to
 * live money (and only mattered when it was lower — one analyst), and a
 * hidden ×2 constant that decided how far adds could grow a position. Both
 * are gone: the cap folded into the largest trade, the constant became the
 * third setting so the principal can see and change it.
 *
 * The tool gate (place_trade / manage_position) and the Settings UI both
 * call these helpers, so the number on screen is the number that rejects
 * a trade.
 *
 * Since DAV-251 the three dollar limits are the CLAMP, not the picker: a
 * buy with no explicit size is sized by risk — how much is lost if the stop
 * hits — from the one setting `AgentConfig.riskPct` (sizeByRisk below).
 * MU was ~$16k over a 14% stop (−$2,290); at 1% risk the same trade is
 * ~$7k and costs ~$1,000 at the stop. Playbook E4.
 */

import {
  BINARY_RISK_MULTIPLIER,
  PORTFOLIO_HEAT_PCT,
  MAX_NAMES_PER_INDUSTRY,
} from "@/lib/agent/knowledge/setups";

export { PORTFOLIO_HEAT_PCT, MAX_NAMES_PER_INDUSTRY };

/**
 * Fallback per-entry cap when an analyst has no largest trade configured at
 * all. Matches place_trade's historical inline fallback.
 */
export const DEFAULT_POSITION_CAP = 5000;

/**
 * "Most in one stock" when the setting is unset (0/undefined): twice the
 * largest trade — the value every existing analyst was backfilled with.
 */
const DEFAULT_TOTAL_MULTIPLE = 2;

export interface PositionBandInput {
  /** AgentConfig.minPositionSize — the smallest trade. 0/undefined = no floor. */
  minPositionSize?: number;
  /** AgentConfig.maxPositionSize — the largest trade. */
  maxPositionSize?: number;
}

export interface PositionBand {
  /** Smallest notional a single entry may be. 0 = no floor. */
  floor: number;
  /** Largest notional a single entry may be. null = none configured. */
  ceiling: number | null;
  /**
   * True when the configured smallest trade sits above the largest — a
   * misconfiguration; the band collapses to the largest trade instead of
   * refusing every buy as both too small and too big.
   */
  floorClampedByCeiling: boolean;
}

export function positionBand(input: PositionBandInput): PositionBand {
  const { minPositionSize, maxPositionSize } = input;
  const ceiling =
    maxPositionSize != null && Number.isFinite(maxPositionSize) && maxPositionSize > 0
      ? maxPositionSize
      : null;
  const rawFloor =
    minPositionSize != null && Number.isFinite(minPositionSize) && minPositionSize > 0
      ? minPositionSize
      : 0;
  const floorClampedByCeiling = ceiling != null && rawFloor > ceiling;
  return {
    floor: floorClampedByCeiling ? (ceiling as number) : rawFloor,
    ceiling,
    floorClampedByCeiling,
  };
}

/**
 * The most this analyst may hold in one stock (cost basis + a pending add).
 * The setting when it is set; otherwise twice the largest trade. The
 * smallest-trade floor deliberately does NOT apply to adds — a $2k add onto
 * a $12k winner is a legitimate scale-in, not an undersized position.
 */
export function positionTotalCap(opts: {
  maxPositionSize?: number;
  maxPositionTotal?: number;
}): number {
  if (
    opts.maxPositionTotal != null &&
    Number.isFinite(opts.maxPositionTotal) &&
    opts.maxPositionTotal > 0
  ) {
    return opts.maxPositionTotal;
  }
  const { ceiling } = positionBand(opts);
  return (ceiling ?? DEFAULT_POSITION_CAP) * DEFAULT_TOTAL_MULTIPLE;
}

// ─── Entry size from the analyst's settings ─────────────────────────────────

/**
 * How much a new position is, in dollars: the analyst's own band, placed by
 * conviction. A normal thesis buys the smallest trade the analyst allows;
 * a STRONG or HIGH conviction thesis buys the largest.
 *
 * This replaces `Thesis.targetSizePct` (DAV-237, 2026-09-08): a percent of
 * portfolio the AGENT wrote on every thesis, which nothing but two refusal
 * gates ever read — place_trade always sized from the agent's `notional`
 * and clamped it to this band. Two numbers from the model, one from the
 * principal, and the principal's was the only one that ever bound. CYTK's
 * 4% guess under a $5,000 floor blocked a real buy crossing on 09-08.
 */
export function entrySizeForConviction(opts: {
  conviction?: string | null;
  band: PositionBand;
}): number {
  const { floor, ceiling } = opts.band;
  const largest = ceiling ?? (floor > 0 ? floor : DEFAULT_POSITION_CAP);
  const smallest = floor > 0 ? floor : largest;
  return opts.conviction === "STRONG" || opts.conviction === "HIGH" ? largest : smallest;
}

// ─── Entry size from risk (DAV-251) ─────────────────────────────────────────

/** Risk per trade when an analyst has none set, % of equity (DAV-245 ruling 2). */
export const DEFAULT_RISK_PCT = 1;

/** Conviction scales the risk, not the dollars (DAV-245 ruling 2). Constants, not settings. */
export const CONVICTION_RISK_MULTIPLIER: Record<string, number> = {
  LOW: 0.5,
  MEDIUM: 0.75,
  HIGH: 1,
  STRONG: 1.25,
};

/** In a CAUTION market new entries are half size (playbook Part C). */
export const CAUTION_SIZE_MULTIPLIER = 0.5;

export type Regime = "RISK_ON" | "CAUTION" | "RISK_OFF";

export interface RiskSizingInput {
  /** Account equity, dollars. */
  equity: number;
  /** AgentConfig.riskPct — % of equity at risk on a normal (HIGH) buy. */
  riskPct?: number | null;
  conviction?: string | null;
  entry: number;
  stop: number;
  direction?: "LONG" | "SHORT";
  /** A dated binary event (PDUFA, readout) — risk is halved. */
  binary?: boolean;
  regime?: Regime | null;
  band: PositionBand;
}

export interface RiskSizing {
  shares: number;
  notional: number;
  /** Dollars lost if the stop hits, at the final size. */
  riskDollars: number;
  /** riskDollars as % of equity. */
  riskPctOfEquity: number;
  /** What the formula alone asked for, before the dollar limits. */
  formulaNotional: number;
  /** Which dollar limit moved the size, if one did. */
  clampedBy: "LARGEST_TRADE" | "SMALLEST_TRADE" | null;
  /** One sentence for the proposal: the arithmetic, in dollars. */
  line: string;
}

const $ = (n: number) => `$${Math.round(n).toLocaleString()}`;

/**
 * shares = (equity × riskPct × conviction × binary × regime) ÷ |entry − stop|,
 * clamped inside the analyst's smallest / largest trade.
 *
 * Returns null when there is no usable stop distance (stop on the wrong side
 * of entry, or equity unknown) — the caller falls back to the band placed by
 * conviction and says so. Never refuses: a formula size under the smallest
 * trade is raised to it and the line says the risk is above target; over the
 * largest trade it is capped and the line says so.
 */
export function sizeByRisk(input: RiskSizingInput): RiskSizing | null {
  const { equity, entry, stop, band } = input;
  const isLong = input.direction !== "SHORT";
  const perShare = isLong ? entry - stop : stop - entry;
  if (!(equity > 0) || !(entry > 0) || !(perShare > 0)) return null;

  const riskPct = input.riskPct != null && input.riskPct > 0 ? input.riskPct : DEFAULT_RISK_PCT;
  const conviction = (input.conviction ?? "MEDIUM").toUpperCase();
  const convictionMult = CONVICTION_RISK_MULTIPLIER[conviction] ?? CONVICTION_RISK_MULTIPLIER.MEDIUM;
  const binaryMult = input.binary ? BINARY_RISK_MULTIPLIER : 1;
  const regimeMult = input.regime === "CAUTION" ? CAUTION_SIZE_MULTIPLIER : 1;

  const targetRisk = equity * (riskPct / 100) * convictionMult * binaryMult * regimeMult;
  const formulaShares = Math.floor(targetRisk / perShare);
  const formulaNotional = formulaShares * entry;

  let shares = formulaShares;
  let clampedBy: RiskSizing["clampedBy"] = null;
  if (band.ceiling != null && formulaNotional > band.ceiling) {
    shares = Math.floor(band.ceiling / entry);
    clampedBy = "LARGEST_TRADE";
  } else if (band.floor > 0 && formulaNotional < band.floor) {
    shares = Math.ceil(band.floor / entry);
    clampedBy = "SMALLEST_TRADE";
  }
  shares = Math.max(1, shares);
  const notional = shares * entry;
  const riskDollars = shares * perShare;
  const riskPctOfEquity = (riskDollars / equity) * 100;

  const factors = [
    `${riskPct}% of ${$(equity)}`,
    `× ${convictionMult} (${conviction})`,
    ...(input.binary ? [`× ${BINARY_RISK_MULTIPLIER} (binary catalyst)`] : []),
    ...(input.regime === "CAUTION" ? [`× ${CAUTION_SIZE_MULTIPLIER} (CAUTION market)`] : []),
  ].join(" ");
  let line =
    `Sized by risk: ${factors} = ${$(targetRisk)} at risk over a $${perShare.toFixed(2)} stop distance ` +
    `→ ${formulaShares} shares (${$(formulaNotional)}).`;
  if (clampedBy === "LARGEST_TRADE") {
    line += ` Capped at the largest trade: ${shares} shares (${$(notional)}), ${$(riskDollars)} at risk (${riskPctOfEquity.toFixed(2)}% of equity).`;
  } else if (clampedBy === "SMALLEST_TRADE") {
    const targetPct = (targetRisk / equity) * 100;
    line += ` Raised to the smallest trade: ${shares} shares (${$(notional)}), ${$(riskDollars)} at risk — ${riskPctOfEquity.toFixed(2)}% of equity, above this trade's ${targetPct.toFixed(2)}% target because the stop is wide for this seat's minimum.`;
  }
  return { shares, notional, riskDollars, riskPctOfEquity, formulaNotional, clampedBy, line };
}
