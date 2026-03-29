"use client";

/**
 * RunSourcesPanel — Perplexity-style sources list for an entire agent run.
 *
 * Reads all thread messages, extracts news articles, social posts, SEC filings,
 * and other linkable sources from tool call results, and renders them in a
 * clean list with favicon, domain, title, snippet, and link.
 */

import { useThreadRuntime } from "@assistant-ui/react";
import { useSyncExternalStore, useMemo } from "react";
import { BookOpen, ExternalLink, FileOutput, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PnlArrow } from "@/components/ui/pnl-arrow";
import { StockLogo } from "@/components/StockLogo";

// ── Source extraction types ─────────────────────────────────────────────────

interface RunSource {
  /** Display title */
  title: string;
  /** Source URL (opens in new tab) */
  url: string;
  /** Short description / excerpt */
  snippet?: string;
  /** Domain display string */
  domain: string;
  /** Favicon URL */
  favicon: string;
  /** Category: news, social, filing, press */
  category: "news" | "social" | "filing" | "press" | "other";
  /** Ticker this source relates to */
  ticker?: string;
}

interface IntelligenceItem {
  type: "brief" | "signal";
  title: string;
  summary: string;
  tickers: string[];
  count?: number;
}

interface ThesisOutput {
  ticker: string;
  direction: string;
  confidence: number;
  reasoning: string;
  companyName?: string;
}

/** Extract domain from a URL for display */
function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return hostname;
  } catch {
    return url;
  }
}

/** Favicon from domain */
function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

/** Categorize a source by provider/URL */
function categorize(
  provider: string,
  url: string,
): RunSource["category"] {
  const p = provider.toLowerCase();
  if (p.includes("reddit") || p.includes("stocktwits") || p.includes("twitter"))
    return "social";
  if (p.includes("sec") || url.includes("sec.gov")) return "filing";
  if (p.includes("press")) return "press";
  return "news";
}

/**
 * Walk all messages in the thread and extract linkable sources.
 * Sources come from:
 * 1. _sources arrays in tool results (provider, title, url, excerpt)
 * 2. news arrays in get_stock_data results
 * 3. stock_news / press_releases in get_news_deep_dive results
 * 4. Reddit/StockTwits post URLs
 */
function extractAllSections(
  messages: Array<{ role: string; content: unknown[] }>,
): { intelligence: IntelligenceItem[]; sources: RunSource[]; theses: ThesisOutput[] } {
  const seen = new Set<string>();
  const sources: RunSource[] = [];
  const intelligence: IntelligenceItem[] = [];
  const theses: ThesisOutput[] = [];

  function addSource(s: RunSource) {
    if (seen.has(s.url)) return;
    seen.add(s.url);
    sources.push(s);
  }

  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;

    for (const part of msg.content) {
      const p = part as Record<string, unknown>;
      if (p.type !== "tool-call") continue;

      const toolName = p.toolName as string;
      const result = (p.result ?? p.output) as Record<string, unknown> | undefined;
      if (!result) continue;

      const ticker =
        ((p.args as Record<string, unknown>)?.ticker as string) ??
        ((p.args as Record<string, unknown>)?.symbol as string) ??
        undefined;

      // ── Intelligence In: morning brief ──────────────────────
      if (toolName === "read_morning_brief") {
        const brief = result as Record<string, unknown>;
        intelligence.push({
          type: "brief",
          title: "Morning Brief",
          summary: String(brief.marketContext ?? brief.market_context ?? ""),
          tickers: Array.isArray(brief.attentionPriority)
            ? (brief.attentionPriority as string[])
            : Array.isArray(brief.attention_priority)
              ? (brief.attention_priority as string[])
              : [],
          count: typeof brief.signalCount === "number" ? brief.signalCount : undefined,
        });
      }

      // ── Intelligence In: signals ────────────────────────────
      if (toolName === "read_signals") {
        const sigs = Array.isArray(result.signals)
          ? (result.signals as Array<Record<string, unknown>>)
          : Array.isArray(result) ? (result as unknown as Array<Record<string, unknown>>) : [];
        for (const s of sigs.slice(0, 5)) {
          intelligence.push({
            type: "signal",
            title: String(s.headline ?? "Signal"),
            summary: String(s.summary ?? ""),
            tickers: Array.isArray(s.tickers) ? (s.tickers as string[]) : [],
          });
        }
        if (sigs.length > 5) {
          intelligence.push({ type: "signal", title: `+${sigs.length - 5} more signals`, summary: "", tickers: [] });
        }
      }

      // ── Outputs: record_thesis ──────────────────────────────
      if (toolName === "record_thesis") {
        const args = (p.args ?? {}) as Record<string, unknown>;
        theses.push({
          ticker: String(args.ticker ?? result.ticker ?? ""),
          direction: String(args.direction ?? result.direction ?? ""),
          confidence: Number(args.confidence_score ?? result.confidence_score ?? 0),
          reasoning: String(args.reasoning_summary ?? result.reasoning_summary ?? ""),
          companyName: (args.company_name ?? result.company_name) as string | undefined,
        });
      }

      // 1. Extract from _sources array
      const rawSources = result._sources;
      if (Array.isArray(rawSources)) {
        for (const s of rawSources) {
          if (typeof s !== "object" || s === null) continue;
          const src = s as Record<string, unknown>;
          const url = src.url as string | undefined;
          if (!url) continue; // Skip sources without URLs

          const provider = String(src.provider ?? "");
          const domain = extractDomain(url);

          addSource({
            title: String(src.title ?? provider),
            url,
            snippet: (src.excerpt as string) ?? undefined,
            domain,
            favicon: faviconUrl(domain),
            category: categorize(provider, url),
            ticker,
          });
        }
      }

      // 2. News articles from get_stock_data
      if (toolName === "get_stock_data") {
        const news = result.news as
          | Array<{ headline: string; url: string; source?: string; summary?: string }>
          | undefined;
        if (Array.isArray(news)) {
          for (const article of news) {
            if (!article.url) continue;
            const domain = extractDomain(article.url);
            addSource({
              title: article.headline,
              url: article.url,
              snippet: article.summary,
              domain,
              favicon: faviconUrl(domain),
              category: "news",
              ticker,
            });
          }
        }
      }

      // 3. News + press releases from get_news_deep_dive
      if (toolName === "get_news_deep_dive") {
        const stockNews = result.stock_news as
          | Array<{ headline: string; url?: string; source?: string }>
          | undefined;
        const pressReleases = result.press_releases as
          | Array<{ headline: string; url?: string; source?: string }>
          | undefined;

        if (Array.isArray(stockNews)) {
          for (const article of stockNews) {
            if (!article.url) continue;
            const domain = extractDomain(article.url);
            addSource({
              title: article.headline,
              url: article.url,
              domain,
              favicon: faviconUrl(domain),
              category: "news",
              ticker,
            });
          }
        }
        if (Array.isArray(pressReleases)) {
          for (const pr of pressReleases) {
            if (!pr.url) continue;
            const domain = extractDomain(pr.url);
            addSource({
              title: pr.headline,
              url: pr.url,
              domain,
              favicon: faviconUrl(domain),
              category: "press",
              ticker,
            });
          }
        }
      }

      // 4. SEC filings
      if (toolName === "get_sec_filings") {
        const filings = (result.filings ?? result) as unknown;
        if (Array.isArray(filings)) {
          for (const f of filings as Array<Record<string, unknown>>) {
            const url = (f.url ?? f.link) as string | undefined;
            if (!url) continue;
            const domain = extractDomain(url);
            addSource({
              title: `${f.type ?? "Filing"} — ${f.date ?? ""}`.trim(),
              url,
              domain,
              favicon: faviconUrl(domain),
              category: "filing",
              ticker,
            });
          }
        }
      }
    }
  }

  return { intelligence, sources, theses };
}

// ── Category labels ─────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<RunSource["category"], string> = {
  news: "News & Articles",
  social: "Social",
  filing: "SEC Filings",
  press: "Press Releases",
  other: "Other",
};

const CATEGORY_ORDER: RunSource["category"][] = [
  "news",
  "press",
  "social",
  "filing",
  "other",
];

// ── Component ───────────────────────────────────────────────────────────────

export function RunSourcesPanel() {
  const runtime = useThreadRuntime();

  const messages = useSyncExternalStore(
    (cb) => runtime.subscribe(cb),
    () => runtime.getState().messages,
    () => runtime.getState().messages,
  );

  const { intelligence, sources, theses } = useMemo(
    () =>
      extractAllSections(
        (messages ?? []) as unknown as Array<{ role: string; content: unknown[] }>,
      ),
    [messages],
  );

  const grouped = useMemo(() => {
    const groups: Partial<Record<RunSource["category"], RunSource[]>> = {};
    for (const s of sources) {
      if (!groups[s.category]) groups[s.category] = [];
      groups[s.category]!.push(s);
    }
    return groups;
  }, [sources]);

  const isEmpty = intelligence.length === 0 && sources.length === 0 && theses.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-sm">No sources yet</p>
        <p className="text-xs mt-1">
          Sources will appear here as the agent researches
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 space-y-8">
      {/* ── 1. Intelligence In ────────────────────────────────── */}
      {intelligence.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Intelligence In</h3>
          </div>
          <div className="space-y-2">
            {intelligence.map((item, i) => (
              <Card key={i} className="p-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium flex-1">{item.title}</p>
                    {item.count != null && (
                      <Badge variant="secondary">
                        {item.count} signals
                      </Badge>
                    )}
                  </div>
                  {item.summary && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{item.summary}</p>
                  )}
                  {item.tickers.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {item.tickers.map((t) => (
                        <div key={t} className="flex items-center gap-1">
                          <StockLogo ticker={t} size="sm" />
                          <span className="font-mono text-[11px] font-medium">{t}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* ── 2. Research Sources ────────────────────────────────── */}
      {sources.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Research Sources</h3>
            <span className="text-xs text-muted-foreground tabular-nums ml-auto">
              {sources.length}
            </span>
          </div>

          {CATEGORY_ORDER.map((cat) => {
            const items = grouped[cat];
            if (!items || items.length === 0) return null;
            return (
              <div key={cat} className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium pl-1">
                  {CATEGORY_LABELS[cat]}
                </p>
                {items.map((source, i) => (
                  <a
                    key={`${source.url}-${i}`}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted"
                  >
                    <img
                      src={source.favicon}
                      alt=""
                      width={20}
                      height={20}
                      className="mt-0.5 size-5 shrink-0 rounded-sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {source.domain}
                        </span>
                        {source.ticker && (
                          <span className="text-[10px] font-mono font-medium text-muted-foreground/70">
                            {source.ticker}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium leading-snug text-foreground line-clamp-2 group-hover:underline">
                        {source.title}
                      </p>
                      {source.snippet && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                          {source.snippet}
                        </p>
                      )}
                    </div>
                    <ExternalLink className="mt-1 size-3.5 shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
                  </a>
                ))}
              </div>
            );
          })}
        </section>
      )}

      {/* ── 3. Outputs ─────────────────────────────────────────── */}
      {theses.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <FileOutput className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Outputs</h3>
            <span className="text-xs text-muted-foreground tabular-nums ml-auto">
              {theses.length} {theses.length === 1 ? "thesis" : "theses"}
            </span>
          </div>
          <div className="space-y-2">
            {theses.map((thesis, i) => {
              const isLong = thesis.direction === "LONG";
              const isPass = thesis.direction === "PASS";
              return (
                <Card key={i} className="p-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <StockLogo ticker={thesis.ticker} size="sm" />
                      <span className="text-sm font-medium">
                        {thesis.companyName ?? thesis.ticker}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {thesis.ticker}
                      </span>
                      {!isPass && (
                        <PnlArrow direction={isLong ? "up" : "down"} className="h-4 w-4" />
                      )}
                      <span className="text-xs tabular-nums text-muted-foreground ml-auto">
                        {thesis.confidence}%
                      </span>
                    </div>
                    {thesis.reasoning && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{thesis.reasoning}</p>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
