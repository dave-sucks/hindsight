"use client";

import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NewsItem = {
  headline: string;
  summary?: string;
  source: string;
  url?: string;
  date?: string;
};

// ─── NewsCard — tight post-list style ─────────────────────────────────────────

export function NewsCard({
  articles,
  className,
}: {
  articles: NewsItem[];
  ticker?: string;
  className?: string;
}) {
  if (articles.length === 0) return null;

  return (
    <div className={cn("space-y-1", className)}>
      {articles.slice(0, 5).map((article, i) => (
        <div
          key={i}
          className="group flex items-start gap-2 rounded-md px-2.5 py-1.5 transition-colors hover:bg-accent/30"
        >
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium leading-snug line-clamp-1">
              {article.url ? (
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {article.headline}
                </a>
              ) : (
                article.headline
              )}
            </p>
            <span className="text-[10px] text-muted-foreground">
              {article.source}
              {article.date && <> · {article.date}</>}
            </span>
          </div>
          {article.url && (
            <ExternalLink className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 mt-0.5 transition-colors" />
          )}
        </div>
      ))}
    </div>
  );
}
