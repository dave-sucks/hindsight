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
import { ExternalLink } from "lucide-react";

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
function extractAllSources(
  messages: Array<{ role: string; content: unknown[] }>,
): RunSource[] {
  const seen = new Set<string>();
  const sources: RunSource[] = [];

  function addSource(s: RunSource) {
    // Dedupe by URL
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

  return sources;
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

  // Subscribe to thread message changes
  const messages = useSyncExternalStore(
    (cb) => runtime.subscribe(cb),
    () => runtime.getState().messages,
    () => runtime.getState().messages,
  );

  const sources = useMemo(
    () =>
      extractAllSources(
        (messages ?? []) as unknown as Array<{ role: string; content: unknown[] }>,
      ),
    [messages],
  );

  // Group by category
  const grouped = useMemo(() => {
    const groups: Partial<Record<RunSource["category"], RunSource[]>> = {};
    for (const s of sources) {
      if (!groups[s.category]) groups[s.category] = [];
      groups[s.category]!.push(s);
    }
    return groups;
  }, [sources]);

  if (sources.length === 0) {
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
    <div className="mx-auto w-full max-w-2xl px-4 py-6 space-y-6">
      <p className="text-xs text-muted-foreground">
        {sources.length} source{sources.length !== 1 ? "s" : ""} from this run
      </p>

      {CATEGORY_ORDER.map((cat) => {
        const items = grouped[cat];
        if (!items || items.length === 0) return null;

        return (
          <div key={cat} className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {CATEGORY_LABELS[cat]}
            </h3>
            <div className="space-y-1">
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
          </div>
        );
      })}
    </div>
  );
}
