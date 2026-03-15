"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ExternalLink, FileText } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SecFiling = {
  type: string;
  date: string;
  description: string;
  url?: string | null;
};

export type SecFilingsCardData = {
  ticker?: string;
  filings: SecFiling[];
};

export type SecFilingsCardProps = ComponentProps<typeof Card> & SecFilingsCardData;

// ─── SecFilingsCard ───────────────────────────────────────────────────────────

export function SecFilingsCard({
  ticker,
  filings,
  className,
  ...cardProps
}: SecFilingsCardProps) {
  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
        <FileText className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">SEC Filings</span>
        {ticker && <span className="text-xs font-mono font-medium">{ticker}</span>}
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {filings.length} filing{filings.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filings.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          No recent SEC filings found.
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {filings.slice(0, 5).map((f, i) => (
            <div key={i} className="group flex items-center gap-2 px-4 py-2 hover:bg-accent/30 transition-colors">
              <Badge variant="outline">
                {f.type}
              </Badge>
              <span className="text-xs truncate flex-1 min-w-0">
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {f.description || f.type}
                  </a>
                ) : (
                  f.description || f.type
                )}
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">{f.date}</span>
              {f.url && (
                <ExternalLink className="h-2.5 w-2.5 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 transition-colors" />
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
