"use client";

/**
 * ResearchToolGroup — Custom ToolGroup component for MessagePrimitive.Parts.
 *
 * When consecutive tool calls are grouped by assistant-ui, this component
 * inspects the group and renders "research step" tools as steps inside a
 * single ChainOfThought block. Card-based tools (StockCard, TradeCard, etc.)
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
  LineChart as LineChartIcon,
  MessageSquare,
  MessageSquareText,
  Newspaper,
  Search,
  Target,
  TrendingUp,
  Users,
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

  // ── Phase 1: Market Overview ──────────────────────────────────────────
  get_market_overview: {
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

      const lines: string[] = [];

      // Regime explanation
      if (regime) {
        const regimeMap: Record<string, string> = {
          RISK_ON: "Risk-on — VIX low, SPY trending above moving averages. Favorable for longs.",
          RISK_OFF: "Risk-off — Elevated VIX or SPY weakness. Favor defensive plays or shorts.",
          NEUTRAL: "Neutral regime — No strong directional bias in broad market.",
        };
        lines.push(regimeMap[regime] ?? `Regime: ${regime}`);
      }

      // SPY trend detail
      if (spyTrend?.position && spyTrend.pct_from_sma != null) {
        lines.push(`SPY is ${spyTrend.position} its 20-day SMA by ${Math.abs(spyTrend.pct_from_sma).toFixed(1)}%`);
      }

      // VIX context
      if (vix?.level) {
        const vixContext = vix.level > 30 ? "High fear" : vix.level > 20 ? "Elevated uncertainty" : "Low volatility";
        lines.push(`${vixContext} (VIX ${vix.level.toFixed(1)})`);
      }

      // Macro events
      if (macroEvents.length > 0) {
        const highImpact = macroEvents.filter(e => e.impact === "HIGH");
        if (highImpact.length > 0) {
          lines.push(`${highImpact.length} high-impact macro event${highImpact.length !== 1 ? "s" : ""} today: ${highImpact.slice(0, 3).map(e => e.event).join(", ")}`);
        } else {
          lines.push(`${macroEvents.length} macro event${macroEvents.length !== 1 ? "s" : ""} today (none high-impact)`);
        }
      }

      // Earnings density
      if (earningsDensity?.count) {
        lines.push(`${earningsDensity.count} companies reporting earnings ${earningsDensity.period ?? "this week"}`);
      }

      // Sector detail
      if (sectors.length > 0) {
        const sorted = [...sectors].sort((a, b) => b.change_pct - a.change_pct);
        const sectorLine = sorted.map(s =>
          `${s.symbol} ${fmtPct(s.change_pct)}`
        ).join("  ·  ");
        lines.push(`Sectors: ${sectorLine}`);
      }

      if (lines.length === 0) return null;
      return lines.map((line, i) => <div key={i}>{line}</div>);
    },
  },

  // ── Phase 2: Theme Detection ──────────────────────────────────────────
  detect_market_themes: {
    icon: Newspaper,
    sources: ["finnhub.io", "reddit.com"],
    loadingLabel: () =>
      "Detecting market themes — analyzing headlines and Reddit trends",
    completeLabel: (_ticker, result) => {
      const themes = (result.themes ?? []) as { label: string; direction: string }[];
      const meta = result.meta as { headlines_analyzed?: number } | undefined;
      if (themes.length === 0) return "No strong market themes detected";
      const headlineCount = meta?.headlines_analyzed ?? 0;
      return `${themes.length} theme${themes.length !== 1 ? "s" : ""} detected from ${headlineCount} headlines`;
    },
    completeDescription: (_ticker, result) => {
      const themes = (result.themes ?? []) as {
        label: string; direction: string; strength: number;
        tickers: string[]; headline_matches: number; reddit_overlap: number;
        representative_headlines?: string[];
      }[];
      const meta = result.meta as { reddit_tickers_found?: number } | undefined;

      if (themes.length === 0) return null;

      return (
        <div className="space-y-1.5">
          {themes.map((t, i) => {
            const dir = t.direction === "BULLISH" ? "bullish" : t.direction === "BEARISH" ? "bearish" : "neutral";
            const dirColor = t.direction === "BULLISH" ? "text-emerald-500" : t.direction === "BEARISH" ? "text-red-500" : "";
            const strengthPct = (t.strength * 100).toFixed(0);
            return (
              <div key={i}>
                <span className={dirColor}>{t.label}</span>
                {" — "}
                <span className={dirColor}>{dir}</span>
                {", "}
                strength {strengthPct}%
                {t.tickers.length > 0 && (
                  <span className="text-muted-foreground"> · {t.tickers.slice(0, 5).join(", ")}</span>
                )}
                {t.headline_matches > 0 && (
                  <span className="text-muted-foreground"> · {t.headline_matches} headlines</span>
                )}
                {t.reddit_overlap > 0 && (
                  <span className="text-muted-foreground"> · {t.reddit_overlap} Reddit mentions</span>
                )}
              </div>
            );
          })}
          {meta?.reddit_tickers_found != null && meta.reddit_tickers_found > 0 && (
            <div className="text-muted-foreground">{meta.reddit_tickers_found} tickers trending on Reddit</div>
          )}
        </div>
      );
    },
  },

  // ── Phase 3: Catalyst Scan ────────────────────────────────────────────
  scan_catalysts: {
    icon: Calendar,
    sources: ["finnhub.io", "financialmodelingprep.com"],
    loadingLabel: () =>
      "Scanning for catalysts — earnings, economic events, insider buying, analyst actions",
    completeLabel: (_ticker, result) => {
      const summary = result.summary as { total?: number; by_type?: Record<string, number>; next_high_impact?: string | null } | undefined;
      if (!summary?.total) return "No upcoming catalysts found";
      const parts: string[] = [];
      const byType = summary.by_type ?? {};
      if (byType.EARNINGS) parts.push(`${byType.EARNINGS} earnings`);
      if (byType.ECONOMIC) parts.push(`${byType.ECONOMIC} economic`);
      if (byType.INSIDER) parts.push(`${byType.INSIDER} insider`);
      if (byType.ANALYST_ACTION) parts.push(`${byType.ANALYST_ACTION} analyst`);
      let label = `${summary.total} catalysts — ${parts.join(", ")}`;
      if (summary.next_high_impact) label += `. Next high-impact: ${summary.next_high_impact}`;
      return label;
    },
    completeDescription: (_ticker, result) => {
      const catalysts = (result.catalysts ?? []) as {
        ticker: string | null; catalyst_type: string; date: string;
        expected_impact: string; direction_bias: string; details: string;
      }[];

      if (catalysts.length === 0) return null;

      // Show high-impact catalysts first, then a summary of the rest
      const highImpact = catalysts.filter(c => c.expected_impact === "HIGH").slice(0, 5);
      const mediumCount = catalysts.filter(c => c.expected_impact === "MEDIUM").length;
      const lowCount = catalysts.filter(c => c.expected_impact === "LOW").length;

      return (
        <div className="space-y-1">
          {highImpact.length > 0 && (
            <>
              <div className="font-medium text-foreground">High-impact upcoming:</div>
              {highImpact.map((c, i) => {
                const biasColor = c.direction_bias === "BULLISH" ? "text-emerald-500" : c.direction_bias === "BEARISH" ? "text-red-500" : "";
                return (
                  <div key={i}>
                    {c.date} — {c.ticker ? `${c.ticker}: ` : ""}{c.details}
                    {c.direction_bias !== "UNKNOWN" && (
                      <span className={biasColor}> ({c.direction_bias.toLowerCase()})</span>
                    )}
                  </div>
                );
              })}
            </>
          )}
          {(mediumCount > 0 || lowCount > 0) && (
            <div className="text-muted-foreground">
              Also: {mediumCount > 0 ? `${mediumCount} medium-impact` : ""}
              {mediumCount > 0 && lowCount > 0 ? ", " : ""}
              {lowCount > 0 ? `${lowCount} low-impact` : ""} events
            </div>
          )}
        </div>
      );
    },
  },

  // ── Phase 4: Candidate Scan ───────────────────────────────────────────
  scan_candidates: {
    icon: Search,
    sources: ["finnhub.io", "financialmodelingprep.com", "stocktwits.com"],
    loadingLabel: () =>
      "Scanning for trade candidates — checking earnings calendar, market movers, and social trends",
    completeLabel: (_ticker, result) => {
      const candidates = (result.candidates ?? []) as unknown[];
      const total = (result.total_found as number) ?? candidates.length;
      return `Found ${total} candidates from earnings, movers, and social trends`;
    },
    completeDescription: (_ticker, result) => {
      const candidates = (result.candidates ?? []) as { ticker: string; score: number; sources: string[]; change_pct?: number; date?: string }[];
      const sourcesQueried = (result.sources_queried ?? []) as string[];

      return (
        <div className="space-y-1.5">
          {candidates.length > 0 && (
            <div>
              <span className="text-foreground">Top candidates:</span>{" "}
              {candidates.map((c, i) => {
                const changeColor = (c.change_pct ?? 0) >= 0 ? "text-emerald-500" : "text-red-500";
                return (
                  <span key={i}>
                    {i > 0 && ", "}
                    <span className="text-foreground">{c.ticker}</span>
                    {c.change_pct != null && <span className={changeColor}> {fmtPct(c.change_pct)}</span>}
                    {c.date && <span className="text-muted-foreground"> ({c.date})</span>}
                    <span className="text-muted-foreground"> [{c.sources.join(", ")}]</span>
                  </span>
                );
              })}
            </div>
          )}
          {/* Sources queried */}
          {sourcesQueried.length > 0 && (
            <div className="text-muted-foreground">
              Searched: {sourcesQueried.join(", ")}
            </div>
          )}
        </div>
      );
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
      let label = `Got ${ticker}`;
      if (company?.name) label += ` — ${company.name}`;
      if (quote?.price != null) label += `, ${fmtPrice(quote.price)} (${fmtPct(quote.change_pct)})`;
      if (news.length > 0) label += `. ${news.length} news article${news.length !== 1 ? "s" : ""}`;
      return label;
    },
    completeDescription: (_ticker, result) => {
      const company = result.company as { sector?: string; market_cap?: number; exchange?: string } | null;
      const financials = result.financials as { pe_ratio?: number; pb_ratio?: number; high_52w?: number; low_52w?: number; avg_volume_10d?: number; beta?: number } | null;
      const analyst = result.analyst_consensus as { buy?: number; hold?: number; sell?: number; strong_buy?: number; strong_sell?: number } | null;
      const news = (result.news ?? []) as { headline?: string; source?: string }[];

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

      // Analyst consensus
      if (analyst) {
        const total = (analyst.strong_buy ?? 0) + (analyst.buy ?? 0) + (analyst.hold ?? 0) + (analyst.sell ?? 0) + (analyst.strong_sell ?? 0);
        if (total > 0) {
          const buyPct = Math.round(((analyst.strong_buy ?? 0) + (analyst.buy ?? 0)) / total * 100);
          lines.push(
            <div key="analyst">
              Analyst consensus: <span className={buyPct >= 60 ? "text-emerald-500" : buyPct <= 40 ? "text-red-500" : ""}>{buyPct}% Buy</span>
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

  // ── Per-ticker: Technical Analysis ────────────────────────────────────
  get_technical_analysis: {
    icon: LineChartIcon,
    sources: ["financialmodelingprep.com"],
    loadingLabel: (ticker) =>
      `Running technical analysis on ${ticker} — RSI, moving averages, volume`,
    completeLabel: (ticker, result) => {
      if (result.error) return `No technical data available for ${ticker}`;
      const trend = result.trend as string | null;
      let label = `Technicals for ${ticker}`;
      if (trend) label += ` — ${trend}`;
      return label;
    },
    completeDescription: (ticker, result) => {
      if (result.error) return result.note ? String(result.note) : null;

      const rsi = result.rsi_14 as number | null;
      const sma20 = result.sma_20 as number | null;
      const sma50 = result.sma_50 as number | null;
      const priceSma20 = result.price_vs_sma20 as string | null;
      const priceSma50 = result.price_vs_sma50 as string | null;
      const range52w = result.position_in_52w_range as string | null;
      const volumeRatio = result.volume_ratio as string | null;
      const currentPrice = result.current_price as number | null;

      const lines: string[] = [];

      if (rsi != null) {
        const level = rsi > 70 ? "overbought — potential reversal" : rsi < 30 ? "oversold — potential bounce" : rsi > 60 ? "bullish momentum" : rsi < 40 ? "bearish momentum" : "neutral range";
        lines.push(`RSI ${rsi.toFixed(1)} — ${level}`);
      }

      if (currentPrice != null && sma20 != null) {
        lines.push(`Price ${fmtPrice(currentPrice)} vs SMA-20 ${fmtPrice(sma20)} (${priceSma20 ?? "—"}) · SMA-50 ${sma50 != null ? fmtPrice(sma50) : "—"} (${priceSma50 ?? "—"})`);
      }

      if (range52w) lines.push(`Position in 52-week range: ${range52w}`);
      if (volumeRatio) lines.push(`Volume: ${volumeRatio}`);

      if (lines.length === 0) return null;
      return lines.map((line, i) => <div key={i}>{line}</div>);
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
                    <span className={beat ? "text-emerald-500" : "text-red-500"}>
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

  // ── Per-ticker: Reddit Sentiment ──────────────────────────────────────
  get_reddit_sentiment: {
    icon: MessageSquare,
    sources: ["reddit.com"],
    loadingLabel: (ticker) =>
      `Scanning Reddit for ${ticker} mentions — WSB, r/stocks, r/options, r/investing`,
    completeLabel: (ticker, result) => {
      if (!result.available) return `No Reddit mentions found for ${ticker}`;
      const mentions = result.mention_count as number | undefined;
      const sentiment = result.sentiment as string | undefined;
      let label = `Reddit for ${ticker}`;
      if (mentions != null) label += ` — ${mentions} mention${mentions !== 1 ? "s" : ""}`;
      if (sentiment) label += `, sentiment: ${sentiment}`;
      return label;
    },
    completeDescription: (_ticker, result) => {
      if (!result.available) return null;
      const sources = (result.sources ?? []) as { provider: string; title: string; score: number; comments: number }[];
      const trending = result.trending as boolean | undefined;
      const sentimentScore = result.sentiment_score as number | undefined;

      const lines: ReactNode[] = [];

      if (sentimentScore != null) {
        lines.push(<div key="score">Sentiment score: {sentimentScore.toFixed(2)}{trending ? " · Trending" : ""}</div>);
      }

      if (sources.length > 0) {
        lines.push(
          <div key="posts" className="space-y-0.5">
            {sources.slice(0, 3).map((s, i) => (
              <div key={i} className="truncate">
                {s.provider}: {s.title} (+{s.score}, {s.comments} comments)
              </div>
            ))}
          </div>
        );
      }

      if (lines.length === 0) return null;
      return <div className="space-y-1">{lines}</div>;
    },
  },

  // ── Per-ticker: StockTwits / Twitter Sentiment ────────────────────────
  get_twitter_sentiment: {
    icon: MessageSquareText,
    sources: ["stocktwits.com", "financialmodelingprep.com"],
    loadingLabel: (ticker) =>
      `Checking StockTwits and social sentiment for ${ticker}`,
    completeLabel: (ticker, result) => {
      if (!result.available) return `No StockTwits data found for ${ticker}`;
      const mentions = result.mention_count as number | undefined;
      const sentiment = result.sentiment as string | undefined;
      const watchlist = result.watchlist_count as number | undefined;
      let label = `StockTwits for ${ticker}`;
      if (mentions != null) label += ` — ${mentions} post${mentions !== 1 ? "s" : ""}`;
      if (sentiment) label += `, sentiment: ${sentiment}`;
      if (watchlist != null) label += `. ${fmtVolume(watchlist)} watchlist`;
      return label;
    },
    completeDescription: (_ticker, result) => {
      if (!result.available) return null;
      const posts = (result.posts ?? []) as { body: string; username: string; likes?: number }[];
      const fmpSentiment = result.fmp_sentiment as { sentiment: number; mentions: number } | null;
      const sentimentScore = result.sentiment_score as number | undefined;

      const lines: ReactNode[] = [];

      if (sentimentScore != null || fmpSentiment) {
        const parts: string[] = [];
        if (sentimentScore != null) parts.push(`StockTwits score: ${sentimentScore.toFixed(2)}`);
        if (fmpSentiment) parts.push(`FMP sentiment: ${fmpSentiment.sentiment.toFixed(2)} (${fmpSentiment.mentions} mentions)`);
        lines.push(<div key="scores">{parts.join("  ·  ")}</div>);
      }

      if (posts.length > 0) {
        lines.push(
          <div key="posts" className="space-y-0.5">
            {posts.slice(0, 2).map((p, i) => (
              <div key={i} className="truncate">@{p.username}: {p.body.slice(0, 120)}{p.body.length > 120 ? "..." : ""}</div>
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

  // ── Per-ticker: Analyst Targets ───────────────────────────────────────
  get_analyst_targets: {
    icon: Target,
    sources: ["financialmodelingprep.com"],
    loadingLabel: (ticker) =>
      `Fetching Wall Street analyst consensus for ${ticker} via FMP`,
    completeLabel: (ticker, result) => {
      const hasTargets = result.consensus_target != null || result.high != null;
      if (!hasTargets) return `No analyst coverage found for ${ticker}`;
      const n = result.num_analysts ?? 0;
      const consensus = (result.consensus_target as number)?.toFixed(2) ?? "N/A";
      return `Analyst targets for ${ticker} — ${n} analysts, consensus $${consensus}`;
    },
    completeDescription: (_ticker, result) => {
      const hasTargets = result.consensus_target != null || result.high != null;
      if (!hasTargets) return null;

      const consensus = result.consensus_target as number | undefined;
      const high = result.high as number | undefined;
      const low = result.low as number | undefined;
      const median = result.median as number | undefined;

      const parts: string[] = [];
      if (low != null && high != null) parts.push(`Range: ${fmtPrice(low)} – ${fmtPrice(high)}`);
      if (median != null) parts.push(`Median: ${fmtPrice(median)}`);
      if (consensus != null) parts.push(`Consensus: ${fmtPrice(consensus)}`);

      if (parts.length === 0) return null;
      return <div>{parts.join("  ·  ")}</div>;
    },
  },

  // ── Per-ticker: Peer Comparison ───────────────────────────────────────
  get_company_peers: {
    icon: Users,
    sources: ["finnhub.io"],
    loadingLabel: (ticker) =>
      `Finding peer companies for ${ticker} via Finnhub`,
    completeLabel: (ticker, result) => {
      const peers = (result.peers ?? []) as string[];
      if (peers.length === 0) return `No peer companies found for ${ticker}`;
      const names = peers.slice(0, 5).join(", ");
      const extra = peers.length > 5 ? ` +${peers.length - 5} more` : "";
      return `Peers for ${ticker} — ${peers.length} companies: ${names}${extra}`;
    },
    completeDescription: (_ticker, result) => {
      const peers = (result.peers ?? []) as string[];
      if (peers.length === 0) return null;

      return (
        <div>
          <span className="text-foreground">{peers.join(", ")}</span>
          {result.note && <div className="text-muted-foreground">{result.note as string}</div>}
        </div>
      );
    },
  },

  // ── Per-ticker: News Deep Dive ────────────────────────────────────────
  get_news_deep_dive: {
    icon: Newspaper,
    sources: ["finnhub.io", "financialmodelingprep.com"],
    loadingLabel: (ticker) =>
      `Deep diving into news and press releases for ${ticker}`,
    completeLabel: (ticker, result) => {
      const stockNews = (result.stock_news ?? []) as unknown[];
      const pressReleases = (result.press_releases ?? []) as unknown[];
      const total = stockNews.length + pressReleases.length;
      if (total === 0) return `No recent news found for ${ticker}`;
      return `${stockNews.length} article${stockNews.length !== 1 ? "s" : ""} and ${pressReleases.length} press release${pressReleases.length !== 1 ? "s" : ""} for ${ticker}`;
    },
    completeDescription: (_ticker, result) => {
      const stockNews = (result.stock_news ?? []) as { headline?: string; source?: string; date?: string }[];
      const pressReleases = (result.press_releases ?? []) as { headline?: string; date?: string }[];

      if (stockNews.length === 0 && pressReleases.length === 0) return null;

      return (
        <div className="space-y-0.5">
          {stockNews.slice(0, 3).map((n, i) => (
            <div key={`news-${i}`} className="truncate">
              {n.source && <span className="text-foreground">{n.source}:</span>} {n.headline}
            </div>
          ))}
          {pressReleases.slice(0, 2).map((p, i) => (
            <div key={`pr-${i}`} className="truncate">
              <span className="text-foreground">PR:</span> {p.headline}
            </div>
          ))}
        </div>
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
    (s) => s.toolName === "get_market_overview" || s.toolName === "scan_candidates",
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
