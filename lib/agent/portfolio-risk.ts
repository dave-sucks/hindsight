/**
 * portfolio-risk.ts — open risk ("heat") across the whole account.
 *
 * Heat = Σ over open positions of shares × (price − stop), as % of equity:
 * what the account loses if every stop hits at once. The playbook cap is
 * PORTFOLIO_HEAT_PCT (6%, Elder). Also counts names per industry — two in one
 * group is the limit (three semiconductor longs are one bet).
 *
 * Lines, never refusals (DAV-251): place_trade writes these into the buy
 * proposal so the principal sees them when approving.
 *
 * The stop is the thesis's floor (Thesis.stopLoss — the plan level the floor
 * trigger mirrors), falling back to Position.stopLoss. Trailing rungs are
 * not counted, so heat reads HIGH when a trail sits above the floor —
 * the conservative side. A position with no stop at all is named, not
 * guessed.
 */

import { MAX_NAMES_PER_INDUSTRY, PORTFOLIO_HEAT_PCT } from "@/lib/agent/position-sizing";

export interface RiskHolding {
  symbol: string;
  direction: string;
  qty: number;
  price: number;
  stop: number | null;
  industry: string | null;
}

export interface OpenRisk {
  riskDollars: number;
  riskPct: number;
  perName: { symbol: string; riskDollars: number }[];
  unstopped: string[];
  byIndustry: Map<string, string[]>;
}

export function openRisk(holdings: RiskHolding[], equity: number): OpenRisk {
  let riskDollars = 0;
  const perName: OpenRisk["perName"] = [];
  const unstopped: string[] = [];
  const byIndustry = new Map<string, string[]>();
  for (const h of holdings) {
    if (h.industry) byIndustry.set(h.industry, [...(byIndustry.get(h.industry) ?? []), h.symbol]);
    if (h.stop == null || !(h.stop > 0)) {
      unstopped.push(h.symbol);
      continue;
    }
    const perShare = h.direction === "SHORT" ? h.stop - h.price : h.price - h.stop;
    const r = Math.max(0, perShare) * h.qty;
    riskDollars += r;
    perName.push({ symbol: h.symbol, riskDollars: r });
  }
  perName.sort((a, b) => b.riskDollars - a.riskDollars);
  return { riskDollars, riskPct: equity > 0 ? (riskDollars / equity) * 100 : 0, perName, unstopped, byIndustry };
}

const $ = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** "Open risk after this buy: 5.8% of equity (cap 6%)…" */
export function heatLine(current: OpenRisk, equity: number, addedRisk = 0): string {
  const after = equity > 0 ? ((current.riskDollars + addedRisk) / equity) * 100 : 0;
  const top = current.perName.slice(0, 3).map((p) => `${p.symbol} ${$(p.riskDollars)}`).join(", ");
  return (
    `Open risk ${addedRisk > 0 ? "after this buy" : "now"}: ${after.toFixed(1)}% of equity (cap ${PORTFOLIO_HEAT_PCT}%)` +
    (after > PORTFOLIO_HEAT_PCT ? " — OVER the cap" : "") +
    (top ? `; largest: ${top}` : "") +
    (current.unstopped.length ? `; no stop, not counted: ${current.unstopped.join(", ")}` : "") +
    "."
  );
}

/** "Third name in Semiconductors (MU, NVDA)…" — only when the buy reaches the limit. */
export function industryLine(current: OpenRisk, industry: string | null | undefined, symbol: string): string | null {
  if (!industry) return null;
  const held = (current.byIndustry.get(industry) ?? []).filter((s) => s !== symbol);
  if (held.length < MAX_NAMES_PER_INDUSTRY) return null;
  return `This would be name ${held.length + 1} in ${industry} (${held.join(", ")}) — the playbook's limit is ${MAX_NAMES_PER_INDUSTRY}; they move as one bet.`;
}
