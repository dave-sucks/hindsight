"use client";

/**
 * Hindsight on this stock, in the homepage activity feed's rows: grouped by
 * day, a status pill, one sentence, the result on the right. A thesis row
 * opens its sheet; a trade row opens the trade. With a `limit` it shows the
 * newest few and a "View all" that the parent turns into the Activity tab.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PriceChange } from "@/components/ui/price-change";
import { StatusPill } from "@/components/domain/thesis-header";
import { ThesisSheet } from "@/components/agent/sheets/ThesisSheet";
import type { StockHistoryItem } from "@/lib/stocks/stock-history";

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  if (d.toDateString() === today) return "Today";
  if (d.toDateString() === yesterday) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

function groupByDay(items: StockHistoryItem[]) {
  const groups: { label: string; items: StockHistoryItem[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

const ROW =
  "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md p-2 text-left hover:bg-muted/70 transition-colors";

export function StockHistory({
  ticker,
  items,
  limit,
  onViewAll,
}: {
  ticker: string;
  items: StockHistoryItem[];
  /** Show only the newest few, with "View all" when there are more. */
  limit?: number;
  onViewAll?: () => void;
}) {
  const [openThesisId, setOpenThesisId] = useState<string | null>(null);
  const shown = useMemo(() => (limit ? items.slice(0, limit) : items), [items, limit]);
  const groups = useMemo(() => groupByDay(shown), [shown]);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No research or trades on this stock yet.</p>;
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground/60 px-1 pb-1.5">
            {group.label}
          </p>
          <Card className="p-1 gap-1">
            {group.items.map((item) =>
              item.kind === "thesis" ? (
                <button key={item.id} type="button" className={ROW} onClick={() => setOpenThesisId(item.thesisId)}>
                  <span className="min-w-0 overflow-hidden">
                    <StatusPill status={item.status} />
                  </span>
                  <span className="min-w-0 text-xs text-muted-foreground truncate">{item.sentence}</span>
                  <span />
                </button>
              ) : (
                <Link key={item.id} prefetch={false} href={item.href} className={ROW}>
                  <span className="min-w-0 overflow-hidden">
                    <Badge variant="secondary" className="gap-1.5 font-normal shrink-0">
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", item.dotClass)} />
                      {item.label}
                    </Badge>
                  </span>
                  <span className="min-w-0 text-xs text-muted-foreground tabular-nums truncate">{item.sentence}</span>
                  <span className="justify-self-end">
                    {item.gain ? (
                      <PriceChange dollarChange={item.gain.dollar} percentChange={item.gain.pct} size="sm" />
                    ) : null}
                  </span>
                </Link>
              ),
            )}
          </Card>
        </div>
      ))}

      {limit && items.length > limit && onViewAll ? (
        <button
          type="button"
          onClick={onViewAll}
          className="px-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View all {items.length} →
        </button>
      ) : null}

      {openThesisId ? (
        <ThesisSheet
          open
          onOpenChange={(open) => {
            if (!open) setOpenThesisId(null);
          }}
          thesis_id={openThesisId}
          ticker={ticker}
          // The sheet loads everything by id; these two are only required by
          // the card type it also accepts.
          direction={null}
          confidence_score={0}
        />
      ) : null}
    </div>
  );
}
