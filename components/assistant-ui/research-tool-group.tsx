"use client";

/**
 * ResearchToolGroup — Custom ToolGroup component for MessagePrimitive.Parts.
 *
 * When consecutive tool calls are grouped by assistant-ui, this component
 * inspects the group and renders "research step" tools as steps inside a
 * single ChainOfThought block. Card-based tools (TradeCard, ThesisCard, etc.)
 * render normally alongside via {children}.
 *
 * Each step shows:
 *  - A concise label (headline summary)
 *  - A rich description with detailed findings
 *  - Per-step source badges
 */

import { useMessage } from "@assistant-ui/react";
import { useMemo, type ReactNode } from "react";
import {
  Activity,
  BarChart3,
  Calendar,
  FileText,
  Search,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
  ChainOfThoughtContent,
  ChainOfThoughtSearchResults,
  ChainOfThoughtSearchResult,
} from "@/components/ai-elements/chain-of-thought";

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}

function fmtVolume(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toString();
}

/** Favicon URL from a domain string */
function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
}

/** Render source badges for a step */
function SourceBadges({ sources }: { sources: string[] }) {
  if (sources.length === 0) return null;
  return (
    <ChainOfThoughtSearchResults>
      {sources.map((domain) => (
        <ChainOfThoughtSearchResult key={domain}>
          <img
            src={faviconUrl(domain)}
            alt=""
            width={12}
            height={12}
            className="size-3 rounded-sm"
          />
          {domain}
        </ChainOfThoughtSearchResult>
      ))}
    </ChainOfThoughtSearchResults>
  );
}

// ── Research Step Registry ──────────────────────────────────────────────────

interface ResearchStepConfig {
  icon: LucideIcon;
  loadingLabel: (ticker: string) => string;
  completeLabel: (ticker: string, result: Record<string, unknown>) => string;
  /** Rich description with detail — shown below the label */
  completeDescription?: (ticker: string, result: Record<string, unknown>) => ReactNode | null;
  sources?: string[];
}

// ── Step Configs ────────────────────────────────────────────────────────────

export const RESEARCH_STEPS: Record<string, ResearchStepConfig> = {

  // ── Phase 1: Market Context ──────────────────────────────────────────
  get_market_context: {
    icon: TrendingUp,
    sources: ["finnhub.io"],
    loadingLabel: () =>
      "Checking market conditions — pulling SPY, VIX, and sector ETFs from Finnhub",
    completeLabel: (_ticker, result) => {
      const spy = result.spy as { price?: number; change_pct?: number } | null;
      const rawVix = result.vix as { level?: number } | null;
      const vix = rawVix && rawVix.level && rawVix.level > 0.1 ? rawVix : null;
      const sectors = (result.sectors ?? []) as { symbol: string; change_pct: number }[];
      const spyStr = spy ? `SPY ${fmtPrice(spy.price)} (${fmtPct(spy.change_pct)})` : "SPY unavailable";
      const vixStr = vix ? `VIX ${vix.level!.toFixed(1)}` : "";
      const leaders = sectors.filter(s => s.change_pct > 0).slice(0, 2).map(s => s.symbol).join(", ");
      const laggards = sectors.filter(s => s.change_pct < 0).slice(-2).reverse().map(s => s.symbol).join(", ");
      let label = `Market check — ${spyStr}`;
      if (vixStr) label += `, ${vixStr}`;
      if (leaders) label += `. Leading: ${leaders}`;
      if (laggards) label += `. Lagging: ${laggards}`;
      return label;
    },
    completeDescription: (_ticker, result) => {
      const regime = result.regime as string | undefined;
      const spyTrend = result.spy_trend as { sma_20?: number; position?: string; pct_from_sma?: number } | null;
      const rawVix = result.vix as { level?: number; change_pct?: number | null } | null;
      const vix = rawVix && rawVix.level && rawVix.level > 0.1 ? rawVix : null;
      const macroEvents = (result.macro_events_today ?? []) as { event: string; impact: string }[];
      const earningsDensity = result.earnings_density as { count?: number; period?: string } | undefined;
      const sectors = (result.sectors ?? []) as { symbol: string; change_pct: number; momentum?: string }[];

      const lines: ReactNode[] = [];

      // Regime explanation
      if (regime) {
        const regimeMap: Record<string, string> = {
          RISK_ON: "Risk-on — VIX low, SPY trending above moving averages. Favorable for longs.",
          RISK_OFF: "Risk-off — Elevated VIX or SPY weakness. Favor defensive plays or shorts.",
          NEUTRAL: "Neutral regime — No strong directional bias in broad market.",
        };
        lines.push(<div key="regime">{regimeMap[regime] ?? `Regime: ${regime}`}</div>);
      }

      // SPY trend detail
      if (spyTrend?.position && spyTrend.pct_from_sma != null) {
        lines.push(<div key="spy-trend">{`SPY is ${spyTrend.position} its 20-day SMA by ${Math.abs(spyTrend.pct_from_sma).toFixed(1)}%`}</div>);
      }

      // VIX context
      if (vix?.level) {
        const vixContext = vix.level > 30 ? "High fear" : vix.level > 20 ? "Elevated uncertainty" : "Low volatility";
        lines.push(<div key="vix">{`${vixContext} (VIX ${vix.level.toFixed(1)})`}</div>);
      }

      // Macro events
      if (macroEvents.length > 0) {
        const highImpact = macroEvents.filter(e => e.impact === "HIGH");
        if (highImpact.length > 0) {
          lines.push(<div key="macro">{`${highImpact.length} high-impact macro event${highImpact.length !== 1 ? "s" : ""} today: ${highImpact.slice(0, 3).map(e => e.event).join(", ")}`}</div>);
        } else {
          lines.push(<div key="macro">{`${macroEvents.length} macro event${macroEvents.length !== 1 ? "s" : ""} today (none high-impact)`}</div>);
        }
      }

      // Earnings density
      if (earningsDensity?.count) {
        lines.push(<div key="earnings">{`${earningsDensity.count} companies reporting earnings ${earningsDensity.period ?? "this week"}`}</div>);
      }

      // Sector detail
      if (sectors.length > 0) {
        const sorted = [...sectors].sort((a, b) => b.change_pct - a.change_pct);
        const sectorLine = sorted.map(s =>
          `${s.symbol} ${fmtPct(s.change_pct)}`
        ).join("  ·  ");
        lines.push(<div key="sectors">{`Sectors: ${sectorLine}`}</div>);
      }

      if (lines.length === 0) return null;
      return <div className="space-y-1">{lines}</div>;
    },
  },

  // ── Per-ticker: Stock Data ────────────────────────────────────────────
  get_stock_data: {
    icon: BarChart3,
    sources: ["finnhub.io"],
    loadingLabel: (ticker) =>
      `Pulling quote, financials, and news for ${ticker} from Finnhub`,
    completeLabel: (ticker, result) => {
      const quote = result.quote as { price?: number; change_pct?: number } | null;
      const company = result.company as { name?: string } | null;
      const news = (result.news ?? []) as unknown[];
      const technicals = result.technicals as { trend?: string; rsi_14?: number } | null;
      let label = `Got ${ticker}`;
      if (company?.name) label += ` — ${company.name}`;
      if (quote?.price != null) label += `, ${fmtPrice(quote.price)} (${fmtPct(quote.change_pct)})`;
      if (technicals?.trend) label += `. Trend: ${technicals.trend}`;
      if (technicals?.rsi_14 != null) label += `, RSI ${technicals.rsi_14.toFixed(1)}`;
      if (news.length > 0) label += `. ${news.length} news article${news.length !== 1 ? "s" : ""}`;
      return label;
    },
    completeDescription: (_ticker, result) => {
      const company = result.company as { sector?: string; market_cap?: number; exchange?: string } | null;
      const financials = result.financials as { pe_ratio?: number; pb_ratio?: number; high_52w?: number; low_52w?: number; avg_volume_10d?: number; beta?: number } | null;
      const analyst = result.analyst_consensus as { buy?: number; hold?: number; sell?: number; strong_buy?: number; strong_sell?: number } | null;
      const news = (result.news ?? []) as { headline?: string; source?: string }[];
      const technicals = result.technicals as {
        rsi_14?: number; sma_20?: number; sma_50?: number;
        price_vs_sma20?: string; price_vs_sma50?: string;
        position_in_52w_range?: string; volume_ratio?: string;
        current_price?: number; trend?: string;
      } | null;

      const lines: ReactNode[] = [];

      // Company info line
      if (company?.sector || company?.market_cap) {
        const parts: string[] = [];
        if (company.sector) parts.push(company.sector);
        if (company.market_cap) parts.push(fmtCompact(company.market_cap * 1e6));
        if (company.exchange) parts.push(company.exchange);
        lines.push(<div key="company">{parts.join("  ·  ")}</div>);
      }

      // Financials
      if (financials) {
        const parts: string[] = [];
        if (financials.pe_ratio != null) parts.push(`P/E ${financials.pe_ratio.toFixed(1)}`);
        if (financials.pb_ratio != null) parts.push(`P/B ${financials.pb_ratio.toFixed(1)}`);
        if (financials.beta != null) parts.push(`Beta ${financials.beta.toFixed(2)}`);
        if (financials.high_52w != null && financials.low_52w != null) {
          parts.push(`52W ${fmtPrice(financials.low_52w)}–${fmtPrice(financials.high_52w)}`);
        }
        if (financials.avg_volume_10d != null) parts.push(`Avg vol ${fmtVolume(financials.avg_volume_10d)}`);
        if (parts.length > 0) lines.push(<div key="fin">{parts.join("  ·  ")}</div>);
      }

      // Technicals (merged from get_technical_analysis)
      if (technicals) {
        const techParts: string[] = [];
        if (technicals.rsi_14 != null) {
          const rsi = technicals.rsi_14;
          const level = rsi > 70 ? "overbought" : rsi < 30 ? "oversold" : rsi > 60 ? "bullish" : rsi < 40 ? "bearish" : "neutral";
          techParts.push(`RSI ${rsi.toFixed(1)} (${level})`);
        }
        if (technicals.current_price != null && technicals.sma_20 != null) {
          techParts.push(`SMA-20 ${fmtPrice(technicals.sma_20)} (${technicals.price_vs_sma20 ?? "—"})`);
        }
        if (technicals.sma_50 != null) {
          techParts.push(`SMA-50 ${fmtPrice(technicals.sma_50)} (${technicals.price_vs_sma50 ?? "—"})`);
        }
        if (technicals.position_in_52w_range) techParts.push(`52W pos: ${technicals.position_in_52w_range}`);
        if (technicals.volume_ratio) techParts.push(`Vol: ${technicals.volume_ratio}`);
        if (techParts.length > 0) lines.push(<div key="tech">{techParts.join("  ·  ")}</div>);
      }

      // Analyst consensus
      if (analyst) {
        const total = (analyst.strong_buy ?? 0) + (analyst.buy ?? 0) + (analyst.hold ?? 0) + (analyst.sell ?? 0) + (analyst.strong_sell ?? 0);
        if (total > 0) {
          const buyPct = Math.round(((analyst.strong_buy ?? 0) + (analyst.buy ?? 0)) / total * 100);
          lines.push(
            <div key="analyst">
              Analyst consensus: <span className={buyPct >= 60 ? "text-positive" : buyPct <= 40 ? "text-negative" : ""}>{buyPct}% Buy</span>
              {" · "}{total} analysts ({analyst.strong_buy ?? 0} strong buy, {analyst.buy ?? 0} buy, {analyst.hold ?? 0} hold, {analyst.sell ?? 0} sell)
            </div>
          );
        }
      }

      // Top news headlines
      if (news.length > 0) {
        const topNews = news.slice(0, 2);
        lines.push(
          <div key="news" className="space-y-0.5">
            {topNews.map((n, i) => (
              <div key={i} className="text-muted-foreground truncate">{n.source ? `${n.source}: ` : ""}{n.headline}</div>
            ))}
          </div>
        );
      }

      if (lines.length === 0) return null;
      return <div className="space-y-1">{lines}</div>;
    },
  },

  // ── Per-ticker: Earnings Data ─────────────────────────────────────────
  get_earnings_data: {
    icon: Calendar,
    sources: ["finnhub.io"],
    loadingLabel: (ticker) =>
      `Checking earnings history and upcoming reports for ${ticker}`,
    completeLabel: (ticker, result) => {
      const nextEarnings = result.next_earnings as { date?: string; eps_estimate?: number | null } | null;
      const beatRate = result.beat_rate as string | undefined;
      let label = `Earnings for ${ticker}`;
      if (nextEarnings?.date) {
        label += ` — next report ${nextEarnings.date}`;
      } else {
        label += ` — no upcoming report`;
      }
      if (beatRate && beatRate !== "no history") label += `. Beat rate: ${beatRate}`;
      return label;
    },
    completeDescription: (_ticker, result) => {
      const quarters = (result.recent_quarters ?? []) as {
        period: string; actual_eps: number; estimated_eps: number;
        surprise: number; surprise_pct: number;
      }[];
      const nextEarnings = result.next_earnings as { date?: string; eps_estimate?: number | null } | null;

      if (quarters.length === 0 && !nextEarnings?.date) return null;

      return (
        <div className="space-y-1">
          {nextEarnings?.date && nextEarnings.eps_estimate != null && (
            <div>
              Next report: {nextEarnings.date}, consensus EPS estimate ${nextEarnings.eps_estimate.toFixed(2)}
            </div>
          )}
          {quarters.length > 0 && (
            <div>
              Recent quarters:{" "}
              {quarters.map((q, i) => {
                const beat = q.surprise > 0;
                return (
                  <span key={i}>
                    {i > 0 && "  ·  "}
                    <span className={beat ? "text-positive" : "text-negative"}>
                      {q.period}: {beat ? "Beat" : "Miss"} by ${Math.abs(q.surprise).toFixed(2)} ({fmtPct(q.surprise_pct)})
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      );
    },
  },

  // ── Per-ticker: Options Flow ──────────────────────────────────────────
  get_options_flow: {
    icon: Activity,
    sources: ["financialmodelingprep.com"],
    loadingLabel: (ticker) =>
      `Scanning unusual options activity for ${ticker} via FMP`,
    completeLabel: (ticker, result) => {
      if (result.available === false) return `No options data available for ${ticker}`;
      const signal = (result.signal as string) ?? "neutral";
      const pcr = result.put_call_ratio;
      return `Options for ${ticker} — P/C ratio ${pcr ?? "N/A"}, signal: ${signal}`;
    },
    completeDescription: (_ticker, result) => {
      if (result.available === false) return null;
      const totalCalls = result.total_call_volume as number | undefined;
      const totalPuts = result.total_put_volume as number | undefined;
      const contracts = result.contracts_available as number | undefined;
      const unusual = (result.unusual_contracts ?? []) as { type: string; strike: number; expiration: string; volume: number }[];

      const lines: ReactNode[] = [];

      if (totalCalls != null && totalPuts != null) {
        lines.push(
          <div key="vol">Call volume: {fmtVolume(totalCalls)} · Put volume: {fmtVolume(totalPuts)} · {contracts ?? 0} contracts</div>
        );
      }

      if (unusual.length > 0) {
        lines.push(
          <div key="unusual" className="text-amber-500">
            {unusual.length} unusual contract{unusual.length !== 1 ? "s" : ""}:{" "}
            {unusual.slice(0, 3).map((u, i) => (
              <span key={i}>{i > 0 && ", "}{u.type} ${u.strike} exp {u.expiration} ({fmtVolume(u.volume)} vol)</span>
            ))}
          </div>
        );
      }

      if (lines.length === 0) return null;
      return <div className="space-y-1">{lines}</div>;
    },
  },

  // ── Per-ticker: SEC Filings ───────────────────────────────────────────
  get_sec_filings: {
    icon: FileText,
    sources: ["sec.gov"],
    loadingLabel: (ticker) =>
      `Looking up SEC filings for ${ticker} on EDGAR`,
    completeLabel: (ticker, result) => {
      const filings = (result.filings ?? result) as { type?: string; date?: string }[];
      const filingsArr = Array.isArray(filings) ? filings : [];
      if (filingsArr.length === 0) return `No recent SEC filings found for ${ticker}`;
      return `SEC filings for ${ticker} — ${filingsArr.length} filing${filingsArr.length !== 1 ? "s" : ""}`;
    },
    completeDescription: (_ticker, result) => {
      const filings = (result.filings ?? result) as { type?: string; date?: string; description?: string }[];
      const filingsArr = Array.isArray(filings) ? filings : [];
      if (filingsArr.length === 0) return null;

      return (
        <div className="space-y-0.5">
          {filingsArr.slice(0, 4).map((f, i) => (
            <div key={i}>
              {f.date} — <span className="text-foreground">{f.type}</span>
              {f.description && <span className="text-muted-foreground"> · {f.description.slice(0, 80)}</span>}
            </div>
          ))}
          {filingsArr.length > 4 && (
            <div className="text-muted-foreground">+{filingsArr.length - 4} more filings</div>
          )}
        </div>
      );
    },
  },

  // ── Phase 3: Portfolio State ──────────────────────────────────────────
  get_portfolio_state: {
    icon: BarChart3,
    sources: ["alpaca.markets"],
    loadingLabel: () => "Loading portfolio state",
    completeLabel: (_ticker, result) => {
      const theses = (result.run_theses as unknown[] | undefined)?.length ?? 0;
      const positions = (result.open_positions as unknown[] | undefined)?.length ?? 0;
      return `Portfolio state — ${theses} theses, ${positions} open positions`;
    },
  },

  // ── Phase 4: Close Position ───────────────────────────────────────────
  close_position: {
    icon: Activity,
    sources: ["alpaca.markets"],
    loadingLabel: (ticker) => `Closing position in ${ticker}`,
    completeLabel: (ticker, result) => {
      const pnl = result.realized_pnl as number | undefined;
      const outcome = result.outcome as string | undefined;
      if (pnl != null) {
        return `Closed ${ticker} — ${outcome} ($${pnl.toFixed(2)})`;
      }
      return `Closed position in ${ticker}`;
    },
  },

  web_search: {
    icon: Search,
    sources: ["perplexity.ai"],
    loadingLabel: (_ticker, args) => {
      const query = (args as Record<string, unknown>)?.query as string | undefined;
      return query ? `Searching: "${query.slice(0, 60)}"` : "Searching the web...";
    },
    completeLabel: (_ticker, result) => {
      const count = result.resultCount as number | undefined;
      const query = result.query as string | undefined;
      if (count != null && query) {
        return `Found ${count} signal${count !== 1 ? "s" : ""} for "${query.slice(0, 50)}"`;
      }
      if (result.error) return `Search failed: ${String(result.error).slice(0, 60)}`;
      return "Web search complete";
    },
    completeDescription: (_ticker, result) => {
      const results = result.results as Array<{ headline: string; summary: string; sourceUrls: string[] }> | undefined;
      if (!results || results.length === 0) return null;
      return (
        <ChainOfThoughtSearchResults>
          {results.slice(0, 5).map((r, i) => (
            <ChainOfThoughtSearchResult
              key={i}
              title={r.headline}
              url={r.sourceUrls?.[0] ?? ""}
              description={r.summary}
            />
          ))}
        </ChainOfThoughtSearchResults>
      );
    },
  },

};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extract ticker from tool args — tools use either `ticker` or `symbol` */
function extractTicker(args: Record<string, unknown>): string {
  return (args.ticker as string) ?? (args.symbol as string) ?? "";
}

// ── ToolGroup Component ─────────────────────────────────────────────────────

interface ToolGroupProps {
  startIndex: number;
  endIndex: number;
  children?: ReactNode;
}

export function ResearchToolGroup({
  startIndex,
  endIndex,
  children,
}: ToolGroupProps) {
  const content = useMessage((m) => m.content);

  const stepParts = useMemo(() => {
    const steps: Array<{
      toolName: string;
      config: ResearchStepConfig;
      args: Record<string, unknown>;
      result: Record<string, unknown> | undefined;
      key: string;
    }> = [];

    for (let i = startIndex; i <= endIndex; i++) {
      const part = (content as unknown[])[i] as Record<string, unknown>;
      if (part?.type !== "tool-call") continue;
      const toolName = part.toolName as string;
      const config = RESEARCH_STEPS[toolName];
      if (!config) continue;
      const args = (part.args as Record<string, unknown>)
        ?? (part.input as Record<string, unknown>)
        ?? {};
      const result = (part.result as Record<string, unknown> | undefined)
        ?? (part.output as Record<string, unknown> | undefined);
      const ticker = extractTicker(args);
      steps.push({ toolName, config, args, result, key: `${toolName}-${ticker}-${i}` });
    }

    return steps;
  }, [content, startIndex, endIndex]);

  if (stepParts.length === 0) {
    return <>{children}</>;
  }

  // Dynamic header based on what tools are actually in this group
  const tickers = [
    ...new Set(stepParts.map((s) => extractTicker(s.args)).filter(Boolean)),
  ];
  const hasMarketTools = stepParts.some(
    (s) => s.toolName === "get_market_context",
  );
  const headerLabel =
    tickers.length === 1
      ? `Researching ${tickers[0]}`
      : tickers.length > 1
        ? `Researching ${tickers.join(", ")}`
        : hasMarketTools
          ? "Market scan"
          : "Research";

  const anyLoading = stepParts.some((s) => s.result === undefined);

  return (
    <>
      <ChainOfThought defaultOpen={anyLoading}>
        <ChainOfThoughtHeader>{headerLabel}</ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          {stepParts.map((step) => {
            const ticker = extractTicker(step.args);
            const isComplete = step.result !== undefined;
            const label = isComplete
              ? step.config.completeLabel(ticker, step.result!)
              : step.config.loadingLabel(ticker);
            const status = isComplete ? "complete" : "active";

            const description = isComplete && step.config.completeDescription
              ? step.config.completeDescription(ticker, step.result!)
              : undefined;

            return (
              <ChainOfThoughtStep
                key={step.key}
                icon={step.config.icon}
                label={label}
                description={description}
                status={status}
              >
                {isComplete && step.config.sources && step.config.sources.length > 0 && (
                  <SourceBadges sources={step.config.sources} />
                )}
              </ChainOfThoughtStep>
            );
          })}
        </ChainOfThoughtContent>
      </ChainOfThought>
      {children}
    </>
  );
}
