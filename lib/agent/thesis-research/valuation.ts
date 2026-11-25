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
  /** The Street's EPS consensus (Nasdaq): this fiscal year and next quarter. */
  epsFiscalYear: number | null;
  epsNextQuarter: number | null;
  /** The estimate for the next report on the reported quarters' own basis (Finnhub's calendar). */
  nextQuarterEstimate?: number | null;
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
 * The reported quarters and their next-report estimate are Finnhub's; the
 * fiscal-year consensus is Nasdaq's, and for some stocks the two are on
 * different bases: IOT (2026-11-25) reported $0.20 adjusted while Nasdaq's
 * consensus read $0.03 GAAP, and the block printed 293× beside 54.5×; DOCU,
 * PANW, CRWD, ESTC, WDAY and CRM read the same way. The test is the same
 * quarter in both: Nasdaq's next quarter more than 1.5× off Finnhub's estimate
 * for it (DOCU $0.53 and $1.20; CEG $2.77 and $2.73 agree). With no Finnhub
 * estimate, Nasdaq's next quarter more than 3× off the last reported quarter
 * (a season stays under it: CEG $5.06 to $2.77 is 1.8×).
 */
const SAME_QUARTER_APART = 1.5;
/** Two vendors' estimates for the same quarter on one basis sit within about 10% (CEG, MU, ACN, V); past that, both figures are printed. */
const SAME_QUARTER_DIFFERS = 1.1;
const LAST_QUARTER_APART = 3;
const ratio = (a: number, b: number) => Math.max(a, b) / Math.min(a, b);
function basisGap(v: ValuationInput): { r: number; against: number; what: string } | null {
  const street = v.epsNextQuarter;
  if (street == null || street <= 0) return null;
  const est = v.nextQuarterEstimate;
  if (est != null && est > 0) {
    return ratio(street, est) > SAME_QUARTER_APART ? { r: ratio(street, est), against: est, what: "the estimate for that quarter on the reported quarters' basis" } : null;
  }
  const last = v.quarterlyEps[0];
  if (last == null || last <= 0) return null;
  return ratio(street, last) > LAST_QUARTER_APART ? { r: ratio(street, last), against: last, what: "the last reported quarter" } : null;
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
  const gap = basisGap(v);
  if (!gap && v.epsFiscalYear != null) earnings.push(times(p, v.epsFiscalYear, "this fiscal year's EPS consensus"));
  if (v.nextQuarterEstimate != null) earnings.push(times(p, v.nextQuarterEstimate * 4, "next quarter's EPS estimate × 4"));
  else if (!gap && v.epsNextQuarter != null) earnings.push(times(p, v.epsNextQuarter * 4, "next quarter's EPS consensus × 4"));
  if (earnings.length) lines.push(`Earnings: ${earnings.join(" · ")}`);
  if (gap) {
    lines.push(
      `No multiple on the Street's EPS consensus${v.epsFiscalYear != null ? ` (${usd(v.epsFiscalYear)} this fiscal year)` : ""}: ` +
        `its next quarter (${usd(v.epsNextQuarter!)}) is ${gap.r.toFixed(1)}× off ${gap.what} (${usd(gap.against)}), so it is likely on a different basis (GAAP and adjusted).`,
    );
  } else {
    // Under the line but not the same: both figures, so a reader sees the gap (CRM $2.41 and $3.47, KEYS $2.81 and $3.66).
    const est = v.nextQuarterEstimate;
    const street = v.epsNextQuarter;
    if (est != null && est > 0 && street != null && street > 0 && ratio(street, est) > SAME_QUARTER_DIFFERS) {
      lines.push(`The Street's next quarter (${usd(street)}) and the estimate on the reported quarters' basis (${usd(est)}) differ by ${Math.round((ratio(street, est) - 1) * 100)}%: the consensus may be on a different basis.`);
    }
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
