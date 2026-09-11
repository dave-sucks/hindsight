/**
 * format-data-block.ts — turn raw tool outputs into the markdown
 * data block the deep-research model reads as ground truth when writing
 * a thesis.
 *
 * Input: the unwrapped data payloads from the 5 new data tools plus
 * get_stock_data and get_sec_filings. Output: ~3-5KB of markdown.
 *
 * Used by the bake-off dev page (Phase 0) and will be used by the
 * thesis-writer pipeline (run-thesis-writer.ts Phase P).
 */

import type { PriceStructure } from "@/lib/market-data/price-structure";

interface StockDataInput {
  ticker: string;
  companyName?: string | null;
  exchange?: string | null;
  sector?: string | null;
  industry?: string | null;
  description?: string | null;
  quote?: {
    current: number | null;
    changePercent: number | null;
    open?: number | null;
    dayHigh?: number | null;
    dayLow?: number | null;
    week52High?: number | null;
    week52Low?: number | null;
    marketCap?: number | null;
    beta?: number | null;
    pe?: number | null;
  };
  /** The chart (lib/market-data/price-structure.ts) + which feed its volume came from. */
  technicals?: (PriceStructure & { volumeFeed?: "sip" | "iex" }) | null;
  recentNews?: { headline: string; source: string; date: string; url: string }[];
  analystTargets?: {
    consensus?: number;
    high?: number;
    low?: number;
    median?: number;
    numAnalysts?: number;
  } | null;
}

interface FinancialsInput {
  annual: {
    year: string;
    revenue: number | null;
    revenueGrowthPct: number | null;
    grossProfit: number | null;
    grossMarginPct: number | null;
    ebitda: number | null;
    ebitdaMarginPct: number | null;
    netIncome: number | null;
    netMarginPct: number | null;
    dilutedEps: number | null;
    epsGrowthPct: number | null;
    operatingCashFlow: number | null;
    capex: number | null;
    freeCashFlow: number | null;
  }[];
  forwardEstimates: {
    year: string;
    revenue: number | null;
    revenueGrowthPct: number | null;
    eps: number | null;
    epsGrowthPct: number | null;
  }[];
  ratios: {
    pe: number | null;
    pegRatio: number | null;
    debtToEquity: number | null;
    currentRatio: number | null;
    roa: number | null;
    roe: number | null;
    roic: number | null;
  } | null;
  errors?: string[];
}

interface AnalystCoverageInput {
  consensus: {
    rating: string;
    bullish: number;
    neutral: number;
    bearish: number;
    totalAnalysts: number;
    asOf: string | null;
  } | null;
  priceTargets: {
    low: number | null;
    average: number | null;
    median: number | null;
    high: number | null;
    currentPrice: number | null;
    impliedUpsidePct: number | null;
    numAnalysts: number | null;
  } | null;
  errors?: string[];
}

interface InsiderInput {
  windowDays: number;
  netDirection: "BUYING" | "SELLING" | "MIXED" | "FLAT";
  netValue: number;
  totalTxns: number;
  topInsiders: { name: string; role: string; netValue: number; netShares: number; txnCount: number }[];
  recentTxns: {
    date: string;
    insider: string;
    role: string;
    side: "BUY" | "SELL";
    shares: number;
    avgPrice: number;
    value: number;
  }[];
}

interface EarningsHistoryInput {
  history: {
    quarter: string;
    reportedAt: string | null;
    revenue: { actual: number | null; estimate: number | null; surprisePct: number | null };
    eps: { actual: number; estimate: number; surprisePct: number | null };
    outcome: "BEAT" | "MISS" | "INLINE" | "UNK";
  }[];
  beats: number;
  misses: number;
  beatRatePct: number | null;
  errors?: string[];
}

interface PeersInput {
  peers: string[];
  comparison: {
    ticker: string;
    marketCap: number | null;
    peRatio: number | null;
    revenueGrowthYoYPct: number | null;
    ytdReturnPct: number | null;
    rsi14: number | null;
    leaderScore: number;
  }[];
  rankings: { byGrowth: string[]; byYtd: string[]; byComposite: string[] };
  targetTickerRank: { growth: number; ytd: number; composite: number };
  errors?: string[];
}

interface FilingsInput {
  filings: { type: string; date: string; description: string }[];
}

export interface DataBlockInputs {
  ticker: string;
  pulledAt: Date;
  stockData: StockDataInput;
  financials: FinancialsInput | null;
  analystCoverage: AnalystCoverageInput | null;
  insider: InsiderInput | null;
  earningsHistory: EarningsHistoryInput | null;
  peers: PeersInput | null;
  filings: FilingsInput | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDollar(n: number | null | undefined, opts?: { compact?: boolean }): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (opts?.compact) {
    const abs = Math.abs(n);
    if (abs >= 1e12) return `${n < 0 ? "-" : ""}$${(abs / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${n < 0 ? "-" : ""}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${n < 0 ? "-" : ""}$${(abs / 1e6).toFixed(0)}M`;
    if (abs >= 1e3) return `${n < 0 ? "-" : ""}$${(abs / 1e3).toFixed(0)}K`;
  }
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtMillions(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n / 1e6).toLocaleString();
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

function padLeft(s: string, width: number): string {
  if (s.length >= width) return s;
  return " ".repeat(width - s.length) + s;
}

// ── Section builders ────────────────────────────────────────────────────────

function buildSnapshot(s: StockDataInput): string {
  const q = s.quote;
  const lines: string[] = [];
  if (q?.current != null) {
    const chg = q.changePercent != null ? ` (${fmtPct(q.changePercent, 2)})` : "";
    const range =
      q.dayLow != null && q.dayHigh != null
        ? ` · Day range: $${q.dayLow.toFixed(2)}-$${q.dayHigh.toFixed(2)}`
        : "";
    lines.push(`Current: $${q.current.toFixed(2)}${chg}${range}`);
  }
  if (q?.week52Low != null && q.week52High != null) {
    lines.push(`52w range: $${q.week52Low.toFixed(2)}-$${q.week52High.toFixed(2)}`);
  }
  const tagBits: string[] = [];
  if (q?.marketCap != null) tagBits.push(`Market cap: ${fmtDollar(q.marketCap, { compact: true })}`);
  if (q?.beta != null) tagBits.push(`Beta: ${q.beta.toFixed(2)}`);
  if (q?.pe != null) tagBits.push(`P/E: ${q.pe.toFixed(1)}`);
  if (tagBits.length) lines.push(tagBits.join(" · "));

  if (lines.length === 0) lines.push("(snapshot unavailable)");

  return lines.join("\n");
}

/**
 * The chart, in dollars (DAV-243). Before this section the writer priced a
 * plan off six numbers over 90 days of bars — asked to "cite the level," it
 * had one dollar figure, today's price, and used it (TOST entry $35.15 on a
 * $35.16 tape, 2026-09-02). Every level a setup in TRADING_PLAYBOOK.md
 * Part D anchors to is printed here with its date.
 */
function buildPriceStructure(s: StockDataInput): string {
  const t = s.technicals;
  if (!t) return "(chart unavailable — no daily bars)";
  const $ = (n: number) => `$${n.toFixed(2)}`;
  const sp = (n: number, digits = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
  const slope = (x: string) => x.toLowerCase();
  const lines: string[] = [];

  const feed = t.volumeFeed === "iex" ? "IEX-only volume — ratios are rough, dollar volume understated" : "consolidated volume";
  lines.push(`Chart: ${t.bars} daily sessions through ${t.asOf} (${feed}) · Verdict: ${t.verdict ?? "unknown"}`);

  const ma: string[] = [];
  for (const [label, m] of [
    ["20-day", t.sma.d20],
    ["50-day", t.sma.d50],
    ["150-day", t.sma.d150],
    ["200-day", t.sma.d200],
  ] as const) {
    if (m) ma.push(`${label} ${$(m.value)} (${slope(m.slope)}; price ${sp(m.pctFromPrice)}%)`);
  }
  if (t.ema.d10 != null) ma.push(`10-day EMA ${$(t.ema.d10)}`);
  if (t.ema.d21 != null) ma.push(`21-day EMA ${$(t.ema.d21)}`);
  if (ma.length) lines.push(`Moving averages — ${ma.join(" · ")}`);

  const vol: string[] = [];
  if (t.atr14) vol.push(`ATR(14) ${$(t.atr14.dollars)} (${t.atr14.pct.toFixed(1)}% of price)`);
  if (t.adr20Pct != null) vol.push(`average daily range (20d) ${t.adr20Pct.toFixed(1)}%`);
  if (t.rsi14 != null) vol.push(`RSI(14) ${t.rsi14}`);
  if (vol.length) lines.push(`Volatility — ${vol.join(" · ")}`);

  const r = t.range;
  lines.push(
    `Range — 20-day ${$(r.low20)}–${$(r.high20)} · 52-week ${$(r.low52w)}–${$(r.high52w)} · ` +
      `${r.pctBelow52wHigh.toFixed(1)}% below the 52-week high · ${r.pctAbove52wLow.toFixed(1)}% above the 52-week low`,
  );

  const sw: string[] = [];
  if (t.swings.lastHigh) sw.push(`last swing high ${$(t.swings.lastHigh.price)} (${t.swings.lastHigh.date})`);
  if (t.swings.lastLow) sw.push(`last swing low ${$(t.swings.lastLow.price)} (${t.swings.lastLow.date})`);
  lines.push(`Swings — ${sw.length ? sw.join(" · ") : "none confirmed in the window"}`);

  if (t.base) {
    const b = t.base;
    lines.push(
      `Base — ${b.lengthBars} sessions, ${b.startDate} to ${b.endDate}: pivot ${$(b.pivot)}, low ${$(b.low)}, ` +
        `${b.depthPct.toFixed(1)}% deep, last 10 sessions ${b.lastContractionPct.toFixed(1)}% tight; ` +
        `price ${b.brokenOut ? "above the pivot (broken out)" : "below the pivot"}`,
    );
  } else {
    lines.push("Base — none (no sideways stretch of 20+ sessions inside a 15% range)");
  }

  const v: string[] = [];
  if (t.volume.lastVsAvg20 != null) v.push(`last session ${t.volume.lastVsAvg20.toFixed(2)}× its 20-day average`);
  if (t.volume.upDownRatio20 != null) v.push(`up-day ÷ down-day volume (20d) ${t.volume.upDownRatio20.toFixed(2)}`);
  if (t.volume.avgDollarVolume50 != null) v.push(`average dollar volume (50d) ${fmtDollar(t.volume.avgDollarVolume50, { compact: true })}`);
  if (v.length) lines.push(`Volume — ${v.join(" · ")}`);

  lines.push(
    `Gaps (last 10 sessions, 3%+) — ` +
      (t.gaps.length
        ? t.gaps
            .map(
              (g) =>
                `${g.date} ${g.direction} ${sp(g.pct)}%` +
                (g.volumeRatio != null ? ` on ${g.volumeRatio.toFixed(1)}× volume` : "") +
                `: gap-day low ${$(g.low)} · mid ${$(g.mid)} · high ${$(g.high)}`,
            )
            .join("; ")
        : "none"),
  );

  const rs = (label: string, x: { m1: number | null; m3: number | null; m6: number | null }) =>
    `${label}: 1M ${x.m1 != null ? sp(x.m1) : "—"} · 3M ${x.m3 != null ? sp(x.m3) : "—"} · 6M ${x.m6 != null ? sp(x.m6) : "—"}`;
  const rsBits: string[] = [];
  if (t.relativeStrength.vsSpy) rsBits.push(rs("vs SPY", t.relativeStrength.vsSpy));
  if (t.relativeStrength.vsSector) rsBits.push(rs(`vs ${t.relativeStrength.vsSector.etf}`, t.relativeStrength.vsSector));
  if (rsBits.length) lines.push(`Relative strength (stock return minus benchmark, percentage points) — ${rsBits.join(" | ")}`);

  if (t.fib) {
    const f = t.fib;
    lines.push(
      `Retracements of the last up-leg (${$(f.legLow)} on ${f.legLowDate} → ${$(f.legHigh)} on ${f.legHighDate}) — ` +
        `38.2% ${$(f.retrace382)} · 50% ${$(f.retrace500)} · 61.8% ${$(f.retrace618)} · ` +
        `extensions 1.272 ${$(f.extension1272)} · 1.618 ${$(f.extension1618)} ` +
        `(candidates only: use one when it lines up with a level above — a moving average, swing or base edge)`,
    );
  }

  if (t.trendTemplate) {
    const tt = t.trendTemplate;
    lines.push(`Trend Template — ${tt.passed}/${tt.of}${tt.failing.length ? `; failing: ${tt.failing.join("; ")}` : ""}`);
  }

  const sg: string[] = [];
  if (t.suggested.trendStrength) sg.push(`trendStrength ${t.suggested.trendStrength.score} ("${t.suggested.trendStrength.note}")`);
  if (t.suggested.relativeStrength) sg.push(`relativeStrength ${t.suggested.relativeStrength.score} ("${t.suggested.relativeStrength.note}")`);
  if (sg.length) {
    lines.push(
      `Computed composite scores from this chart — ${sg.join(" · ")}. ` +
        `Use them unless your research says otherwise; if you change one, say why in its note.`,
    );
  }

  lines.push(
    `(These are real levels you can anchor an entry, target or stop to. ` +
      `An entry must be a price the stock has NOT reached — a pullback BELOW the tape ` +
      `or a breakout ABOVE it. Today's price is not an entry.)`,
  );
  return lines.join("\n");
}

function buildCompany(s: StockDataInput): string {
  const lines: string[] = [];
  const id: string[] = [];
  if (s.exchange) id.push(s.exchange);
  if (s.sector) id.push(`Sector: ${s.sector}`);
  if (s.industry) id.push(`Industry: ${s.industry}`);
  if (id.length) lines.push(id.join(" · "));
  if (s.description) lines.push(s.description.slice(0, 600));
  return lines.length > 0 ? lines.join("\n") : "(no company description available)";
}

function buildFinancials(f: FinancialsInput | null): string {
  if (!f) return "(financials unavailable)";
  if (f.annual.length === 0 && f.forwardEstimates.length === 0) {
    return `(no financial data returned${f.errors?.length ? ` — ${f.errors.join("; ")}` : ""})`;
  }

  const lines: string[] = [];
  // Table header — fixed-width columns so the model sees a real table.
  const periods = [
    ...f.annual.map((a) => a.year),
    ...f.forwardEstimates.map((e) => `${e.year}e`),
  ];
  const W = 9;
  lines.push("Annual ($M, growth %):");
  lines.push("");
  lines.push(pad("Metric", 18) + periods.map((p) => padLeft(p, W)).join(""));

  const metrics: { label: string; values: (string)[] }[] = [];
  const rows = [
    {
      label: "Revenue",
      annualPick: (a: typeof f.annual[number]) => fmtMillions(a.revenue),
      estimatePick: (e: typeof f.forwardEstimates[number]) => fmtMillions(e.revenue),
    },
    {
      label: "  % Growth",
      annualPick: (a: typeof f.annual[number]) => fmtPct(a.revenueGrowthPct, 1),
      estimatePick: (e: typeof f.forwardEstimates[number]) => fmtPct(e.revenueGrowthPct, 1),
    },
    {
      label: "Gross Profit",
      annualPick: (a: typeof f.annual[number]) => fmtMillions(a.grossProfit),
      estimatePick: () => "—",
    },
    {
      label: "  % Margin",
      annualPick: (a: typeof f.annual[number]) => fmtPct(a.grossMarginPct, 1),
      estimatePick: () => "—",
    },
    {
      label: "EBITDA",
      annualPick: (a: typeof f.annual[number]) => fmtMillions(a.ebitda),
      estimatePick: () => "—",
    },
    {
      label: "  % Margin",
      annualPick: (a: typeof f.annual[number]) => fmtPct(a.ebitdaMarginPct, 1),
      estimatePick: () => "—",
    },
    {
      label: "Net Income",
      annualPick: (a: typeof f.annual[number]) => fmtMillions(a.netIncome),
      estimatePick: () => "—",
    },
    {
      label: "Diluted EPS",
      annualPick: (a: typeof f.annual[number]) => (a.dilutedEps != null ? a.dilutedEps.toFixed(2) : "—"),
      estimatePick: (e: typeof f.forwardEstimates[number]) => (e.eps != null ? e.eps.toFixed(2) : "—"),
    },
    {
      label: "Operating CF",
      annualPick: (a: typeof f.annual[number]) => fmtMillions(a.operatingCashFlow),
      estimatePick: () => "—",
    },
    {
      label: "CapEx",
      annualPick: (a: typeof f.annual[number]) => fmtMillions(a.capex),
      estimatePick: () => "—",
    },
    {
      label: "Free Cash Flow",
      annualPick: (a: typeof f.annual[number]) => fmtMillions(a.freeCashFlow),
      estimatePick: () => "—",
    },
  ];

  for (const m of rows) {
    const values = [
      ...f.annual.map(m.annualPick),
      ...f.forwardEstimates.map(m.estimatePick),
    ];
    metrics.push({ label: m.label, values });
  }

  for (const m of metrics) {
    lines.push(pad(m.label, 18) + m.values.map((v) => padLeft(v, W)).join(""));
  }
  lines.push("");
  if (f.ratios) {
    // ROA / ROE / ROIC dropped from the inline ratios line on 2026-05-18
    // to trim ~60 tokens per data block. The three returns-on-X metrics
    // are highly correlated and rarely cited individually in the synthesis
    // output; P/E + PEG + D/E + Current give the same first-look read of
    // valuation + leverage + liquidity without the redundancy. The
    // underlying `f.ratios` object still carries them; only the rendered
    // line is trimmed.
    const parts: string[] = [];
    if (f.ratios.pe != null) parts.push(`P/E ${f.ratios.pe.toFixed(1)}`);
    if (f.ratios.pegRatio != null) parts.push(`PEG ${f.ratios.pegRatio.toFixed(2)}`);
    if (f.ratios.debtToEquity != null) parts.push(`D/E ${f.ratios.debtToEquity.toFixed(2)}`);
    if (f.ratios.currentRatio != null) parts.push(`Current ${f.ratios.currentRatio.toFixed(2)}`);
    if (parts.length > 0) lines.push(`Latest ratios — ${parts.join(" · ")}`);
  }
  if (f.errors && f.errors.length > 0) {
    lines.push(`(partial — ${f.errors.join("; ")})`);
  }
  return lines.join("\n");
}

function buildEarnings(e: EarningsHistoryInput | null): string {
  if (!e) return "(earnings history unavailable)";
  if (e.history.length === 0) {
    return `(no earnings history${e.errors?.length ? ` — ${e.errors.join("; ")}` : ""})`;
  }
  const lines: string[] = [];
  if (e.beatRatePct != null) {
    lines.push(
      `Beat rate: ${e.beatRatePct}% (${e.beats}/${e.beats + e.misses} clean outcomes across ${e.history.length}q)`,
    );
  }
  for (const q of e.history) {
    const revText =
      q.revenue.actual != null && q.revenue.estimate != null
        ? ` rev ${fmtDollar(q.revenue.actual, { compact: true })} vs ${fmtDollar(q.revenue.estimate, { compact: true })} est (${fmtPct(q.revenue.surprisePct, 1)})`
        : q.revenue.actual != null
          ? ` rev ${fmtDollar(q.revenue.actual, { compact: true })} (filed; no estimate on plan)`
          : "";
    const epsSurprise = q.eps.surprisePct != null ? ` (${fmtPct(q.eps.surprisePct, 1)})` : "";
    lines.push(
      `${q.quarter}${q.reportedAt ? ` reported ${q.reportedAt}` : ""}: EPS $${q.eps.actual.toFixed(2)} vs $${q.eps.estimate.toFixed(2)} est${epsSurprise}${revText} — ${q.outcome}`,
    );
  }
  if (e.errors && e.errors.length > 0) lines.push(`(partial — ${e.errors.join("; ")})`);
  return lines.join("\n");
}

function buildAnalystCoverage(a: AnalystCoverageInput | null): string {
  if (!a) return "(analyst coverage unavailable)";
  const lines: string[] = [];
  if (a.consensus) {
    lines.push(
      `Consensus: ${a.consensus.rating} · ${a.consensus.totalAnalysts} analyst(s) tracked ` +
        `(${a.consensus.bullish} Bullish / ${a.consensus.neutral} Neutral / ${a.consensus.bearish} Bearish)` +
        `${a.consensus.asOf ? ` · as of ${a.consensus.asOf}` : ""}`,
    );
  }
  if (a.priceTargets?.average != null) {
    const upText =
      a.priceTargets.impliedUpsidePct != null
        ? ` · Implied upside ${fmtPct(a.priceTargets.impliedUpsidePct, 1)} vs ${a.priceTargets.currentPrice != null ? `$${a.priceTargets.currentPrice.toFixed(2)}` : "current"}`
        : "";
    lines.push(
      `Targets: Low $${a.priceTargets.low?.toFixed(2) ?? "—"} · Avg $${a.priceTargets.average.toFixed(2)} · Median $${a.priceTargets.median?.toFixed(2) ?? "—"} · High $${a.priceTargets.high?.toFixed(2) ?? "—"}${upText}`,
    );
  }
  if (a.errors && a.errors.length > 0) lines.push(`(partial — ${a.errors.join("; ")})`);
  return lines.join("\n");
}

function buildInsider(i: InsiderInput | null): string {
  if (!i) return "(insider activity unavailable)";
  if (i.totalTxns === 0) return `No Form 4 transactions in the last ${i.windowDays} days.`;
  const lines: string[] = [];
  const valueStr =
    Math.abs(i.netValue) >= 1e6
      ? `$${(Math.abs(i.netValue) / 1e6).toFixed(2)}M`
      : `$${Math.round(Math.abs(i.netValue) / 1e3)}K`;
  lines.push(
    `Net direction: ${i.netDirection} (${i.netValue >= 0 ? "+" : "-"}${valueStr} across ${i.totalTxns} transaction(s), ${i.windowDays}d)`,
  );
  lines.push("");
  lines.push(`Top insiders by net value:`);
  for (const ins of i.topInsiders.slice(0, 5)) {
    const v = ins.netValue;
    const vStr = Math.abs(v) >= 1e6 ? `$${(Math.abs(v) / 1e6).toFixed(2)}M` : `$${Math.round(Math.abs(v) / 1e3)}K`;
    lines.push(
      `  ${ins.name} (${ins.role}) — ${v >= 0 ? "+" : "-"}${vStr} · ${ins.netShares >= 0 ? "+" : ""}${ins.netShares.toLocaleString()} shares · ${ins.txnCount} txn`,
    );
  }
  if (i.recentTxns.length > 0) {
    lines.push("");
    lines.push(`Recent transactions:`);
    for (const t of i.recentTxns.slice(0, 10)) {
      lines.push(
        `  ${t.date} — ${t.insider} (${t.role}): ${t.side} ${t.shares.toLocaleString()} @ $${t.avgPrice.toFixed(2)} = ${fmtDollar(t.value, { compact: true })}`,
      );
    }
  }
  return lines.join("\n");
}

function buildPeers(p: PeersInput | null, targetTicker: string): string {
  if (!p) return "(peer comparison unavailable)";
  if (p.peers.length === 0 && p.comparison.length === 0) return "(no peers returned)";
  const lines: string[] = [];
  if (p.peers.length > 0) lines.push(`Peers: ${p.peers.join(", ")}`);
  lines.push("");
  // Table format.
  const W = 11;
  lines.push(
    pad("Ticker", 9) +
      padLeft("MktCap", W) +
      padLeft("P/E", W) +
      padLeft("RevGrth", W) +
      padLeft("YTD", W) +
      padLeft("RSI", W) +
      padLeft("Score", W),
  );
  for (const c of p.comparison) {
    const mc = c.marketCap != null ? fmtDollar(c.marketCap, { compact: true }) : "—";
    const pe = c.peRatio != null ? c.peRatio.toFixed(1) : "—";
    const grth = c.revenueGrowthYoYPct != null ? fmtPct(c.revenueGrowthYoYPct, 1) : "—";
    const ytd = c.ytdReturnPct != null ? fmtPct(c.ytdReturnPct, 1) : "—";
    const rsi = c.rsi14 != null ? String(c.rsi14) : "—";
    const score = String(c.leaderScore);
    const marker = c.ticker === targetTicker ? "*" : " ";
    lines.push(
      pad(`${c.ticker}${marker}`, 9) +
        padLeft(mc, W) +
        padLeft(pe, W) +
        padLeft(grth, W) +
        padLeft(ytd, W) +
        padLeft(rsi, W) +
        padLeft(score, W),
    );
  }
  lines.push("");
  lines.push(
    `$${targetTicker} ranks: growth ${p.targetTickerRank.growth}/${p.comparison.length} · YTD ${p.targetTickerRank.ytd}/${p.comparison.length} · composite ${p.targetTickerRank.composite}/${p.comparison.length}`,
  );
  if (p.errors && p.errors.length > 0) lines.push(`(partial — ${p.errors.join("; ")})`);
  return lines.join("\n");
}

function buildFilings(f: FilingsInput | null): string {
  if (!f || f.filings.length === 0) return "(no recent SEC filings)";
  return f.filings
    .slice(0, 12)
    .map((r) => `${r.date} — ${r.type}: ${r.description}`)
    .join("\n");
}

function buildAnalystTargets(s: StockDataInput): string {
  const t = s.analystTargets;
  if (!t) return "(price targets unavailable from snapshot — see Analyst Coverage section above)";
  const lines: string[] = [];
  if (t.consensus != null) {
    lines.push(
      `Snapshot targets — Low $${t.low?.toFixed(2) ?? "—"} · Avg $${t.consensus.toFixed(2)} · Median $${t.median?.toFixed(2) ?? "—"} · High $${t.high?.toFixed(2) ?? "—"}${t.numAnalysts != null ? ` (${t.numAnalysts} analyst${t.numAnalysts === 1 ? "" : "s"})` : ""}`,
    );
  }
  return lines.length ? lines.join("\n") : "(no snapshot targets)";
}

function buildNews(s: StockDataInput): string {
  const news = s.recentNews ?? [];
  if (news.length === 0) return "(no recent news)";
  // Capped at 5 (was 10) on 2026-05-18 — every news line is ~30-50 tokens
  // and 10 headlines wasn't pulling its weight in the synthesis output
  // (Bull/Bear sections cited the top 3-4 max). Synthesis still has its
  // own web_search budget for follow-up on anything in the snapshot.
  return news
    .slice(0, 5)
    .map((n) => `${n.date} — ${n.source}: ${n.headline}`)
    .join("\n");
}

// ── Main exporter ───────────────────────────────────────────────────────────

export function formatDataBlock(inputs: DataBlockInputs): string {
  const { ticker, pulledAt, stockData } = inputs;
  const T = ticker.toUpperCase();
  const company = stockData.companyName ?? T;
  const pulledStr =
    pulledAt
      .toISOString()
      .replace("T", " ")
      .replace(/:\d{2}\.\d{3}Z$/, " UTC");

  const sections: string[] = [];

  sections.push(
    `═══════════════════════════════════════════════════════════════════
STRUCTURED DATA: $${T} (${company})
Pulled ${pulledStr} — use these numbers as ground truth.
═══════════════════════════════════════════════════════════════════`,
  );

  sections.push(`## Snapshot\n\n${buildSnapshot(stockData)}`);

  sections.push(`## Price structure\n\n${buildPriceStructure(stockData)}`);

  sections.push(`## Company\n\n${buildCompany(stockData)}`);

  sections.push(`## Financials, Annual + Forward Estimates\n\n${buildFinancials(inputs.financials)}`);

  sections.push(`## Earnings History\n\n${buildEarnings(inputs.earningsHistory)}`);

  sections.push(`## Analyst Coverage\n\n${buildAnalystCoverage(inputs.analystCoverage)}`);

  sections.push(`## Analyst Price Targets (snapshot)\n\n${buildAnalystTargets(stockData)}`);

  sections.push(`## Insider Activity\n\n${buildInsider(inputs.insider)}`);

  sections.push(`## Peer Comparison\n\n${buildPeers(inputs.peers, T)}`);

  sections.push(`## Recent SEC Filings\n\n${buildFilings(inputs.filings)}`);

  sections.push(`## Recent News (last 7 days)\n\n${buildNews(stockData)}`);

  return sections.join("\n\n");
}
