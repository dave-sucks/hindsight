"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ExternalLink, Newspaper } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NewsItem = {
  headline: string;
  summary?: string;
  source: string;
  url?: string;
  date?: string;
};

// ─── NewsCard ─────────────────────────────────────────────────────────────────

export function NewsCard({
  articles,
  ticker,
  className,
}: {
  articles: NewsItem[];
  ticker?: string;
  className?: string;
}) {
  if (articles.length === 0) return null;

  return (
    <Card className={cn("overflow-hidden p-0", className)}>
      <div className="px-4 py-3 flex items-center justify-between border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">
            Recent News
            {ticker && (
              <span className="ml-1.5 font-mono text-muted-foreground">
                {ticker}
              </span>
            )}
          </span>
        </div>
        <Badge variant="secondary" className="text-[10px] tabular-nums">
          {articles.length} articles
        </Badge>
      </div>

      <div className="divide-y">
        {articles.map((article, i) => (
          <div key={i} className="px-4 py-3 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-snug line-clamp-2">
                {article.headline}
              </p>
              {article.url && (
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            {article.summary && (
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                {article.summary}
              </p>
            )}
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{article.source}</span>
              {article.date && (
                <>
                  <span>·</span>
                  <span>{article.date}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
