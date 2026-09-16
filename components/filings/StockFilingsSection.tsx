"use client";

/**
 * One company's SEC filings — the stock page's Filings tab. Newest first:
 * the date, what the filing IS in plain words (the 8-K item code named), a
 * label on the ones that deserve a look, and a link to the document. Live
 * off EDGAR; nothing stored. A failed read says so — that is never the same
 * as "nothing filed". See docs/plans/SEC_FILINGS.md §8.
 */

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { describeFilingEvent } from "@/lib/market-data/sec-events";
import type { FilingEntry, FilingsResponse } from "@/lib/types/thesis-sheet";

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Serious and material filings carry a label; routine ones don't need one. */
function TierBadge({ tier }: { tier: FilingEntry["tier"] }) {
  if (tier === "CONTEXT") return null;
  return (
    <Badge variant={tier === "RED" ? "destructive" : "secondary"} className="font-normal">
      {tier === "RED" ? "Serious" : "Material"}
    </Badge>
  );
}

export function StockFilingsSection({ symbol }: { symbol: string }) {
  const [data, setData] = useState<FilingsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/stocks/${encodeURIComponent(symbol)}/filings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: FilingsResponse | null) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  // A read that failed is its own state — saying "no filings" here would be
  // a lie the reader can't tell from the truth.
  if (!data || data.error) {
    return (
      <p className="text-sm text-muted-foreground">
        SEC filings unavailable{data?.error ? ` — ${data.error}` : ""}. This isn&apos;t &ldquo;nothing filed&rdquo;; try again shortly.
      </p>
    );
  }
  if (data.filings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {symbol} filed nothing worth a look in the last {data.days} days.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        What {symbol} told the SEC in the last {data.days} days. The code is the event; read the document before acting on it.
      </p>
      <div className="rounded-lg border overflow-hidden bg-card">
        {data.filings.map((f) => (
          <a
            key={`${f.accession}-${f.filedDate}`}
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-muted/50 transition-colors"
          >
            <span className="text-xs text-muted-foreground tabular-nums w-24 shrink-0">{fmtDate(f.filedDate)}</span>
            <span className="text-sm text-foreground flex-1 min-w-0 truncate">{describeFilingEvent(f)}</span>
            <TierBadge tier={f.tier} />
          </a>
        ))}
      </div>
    </div>
  );
}
