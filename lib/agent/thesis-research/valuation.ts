/**
 * valuation.ts — the Writer's valuation multiples at today's price, worked
 * out by code from numbers already in its data block.
 *
 * Until 2026-11-24 the block carried two unlabeled P/Es from Finnhub, each at
 * Finnhub's own price (the snapshot's was "normalized annual", the ratios
 * line's trailing; CEG read 43.1 and 22.9), and no forward multiple. The
 * Writer divided for itself and got it wrong. In the blind test it gave
 * ACN 16.7× (17.0×) and MU 4.5× (5.1×). Each multiple here names what it
 * divides by, so a multiple in the opinion can be checked against the block.
 */

export interface ValuationInput {
  price: number | null;
  /** At today's price (shares × price), the one the snapshot prints. */
  marketCap: number | null;
  /** Reported EPS of the last quarters, newest first (the figure the estimates are measured against). */
  quarterlyEps: number[];
  epsFiscalYear: number | null;
  epsNextQuarter: number | null;
  /** The newest filed year, in dollars. */
  lastYear: { year: string; revenue: number | null; freeCashFlow: number | null } | null;
}

const usd = (n: number): string => `$${n.toFixed(2)}`;

function compact(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  return `${s}$${(a / 1e6).toFixed(0)}M`;
}

/** price ÷ EPS in words, or why there is no multiple. */
function times(price: number, eps: number, what: string): string {
  if (eps <= 0) return `no multiple on ${what} (${eps < 0 ? "a loss" : "zero"}, ${usd(eps)})`;
  return `${(price / eps).toFixed(1)}× ${what} (${usd(eps)})`;
}

/**
 * How far apart the Street's next quarter and the newest reported quarter are,
 * when that is more than 3×; else null. The reported quarters are Finnhub's and
 * the consensus is Nasdaq's, and the two can be on different bases: IOT
 * (2026-11-25) reported $0.20 adjusted while the consensus read $0.03 GAAP, and
 * the block printed 293× beside 54.5×. One quarter seldom moves 3×; a season
 * does not (CEG $5.06 to $2.77 is 1.8×).
 */
const BASIS_APART = 3;
function basisApart(lastQuarter: number | undefined, nextQuarter: number | null): number | null {
  if (lastQuarter == null || nextQuarter == null || lastQuarter <= 0 || nextQuarter <= 0) return null;
  const r = Math.max(lastQuarter, nextQuarter) / Math.min(lastQuarter, nextQuarter);
  return r > BASIS_APART ? r : null;
}

/** The section's lines, or null when there is no price to value. */
export function valuationLines(v: ValuationInput): string | null {
  const p = v.price;
  if (p == null || !Number.isFinite(p) || p <= 0) return null;
  const lines: string[] = [];

  const cap = v.marketCap != null && v.marketCap > 0 ? v.marketCap : null;
  const earnings: string[] = [];
  const four = v.quarterlyEps.slice(0, 4);
  if (four.length === 4) earnings.push(times(p, four.reduce((a, b) => a + b, 0), "the last four quarters' EPS"));
  const apart = basisApart(v.quarterlyEps[0], v.epsNextQuarter);
  if (!apart) {
    if (v.epsFiscalYear != null) earnings.push(times(p, v.epsFiscalYear, "this fiscal year's EPS consensus"));
    if (v.epsNextQuarter != null) earnings.push(times(p, v.epsNextQuarter * 4, "next quarter's EPS consensus × 4"));
  }
  if (earnings.length) lines.push(`Earnings: ${earnings.join(" · ")}`);
  if (apart) {
    lines.push(
      `No multiple on the Street's EPS consensus: its next quarter (${usd(v.epsNextQuarter!)}) is ${apart.toFixed(1)}× off the last reported quarter (${usd(v.quarterlyEps[0])}), ` +
        "so the two are likely on different bases (GAAP and adjusted).",
    );
  }

  const y = v.lastYear;
  if (cap != null && y?.revenue != null && y.revenue > 0) {
    lines.push(`Sales: ${(cap / y.revenue).toFixed(1)}× ${y.year} revenue (${compact(y.revenue)}), on the market cap above`);
  }
  if (cap != null && y?.freeCashFlow != null) {
    lines.push(`Free cash flow: ${((y.freeCashFlow / cap) * 100).toFixed(1)}% yield on ${y.year}'s ${compact(y.freeCashFlow)}`);
  }
  return lines.length ? lines.join("\n") : null;
}
