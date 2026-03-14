"use client";

import type { ComponentProps } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Users } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PeerData = {
  ticker: string;
  name?: string;
  price?: number | null;
  change_pct?: number | null;
  pe_ratio?: number | null;
  market_cap?: number | null;
};

export type PeersCardData = {
  ticker?: string;
  peers: PeerData[];
  sector?: string;
};

export type PeersCardProps = ComponentProps<typeof Card> & PeersCardData;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCap(val: number): string {
  if (val >= 1e12) return `$${(val / 1e12).toFixed(1)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
  return `$${val.toLocaleString()}`;
}

// ─── PeersCard ────────────────────────────────────────────────────────────────

export function PeersCard({
  ticker,
  peers,
  sector,
  className,
  ...cardProps
}: PeersCardProps) {
  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
        <Users className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Peers</span>
        {ticker && <span className="text-xs font-mono font-medium">{ticker}</span>}
        {sector && (
          <span className="ml-auto text-[10px] text-muted-foreground">{sector}</span>
        )}
      </div>

      {peers.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          No peer data available.
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {peers.slice(0, 6).map((p, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-1.5 text-xs">
              <span className="font-mono font-medium w-14 shrink-0">{p.ticker}</span>
              {p.name && (
                <span className="text-muted-foreground truncate flex-1 min-w-0">{p.name}</span>
              )}
              {p.price != null && (
                <span className="tabular-nums shrink-0">${p.price.toFixed(2)}</span>
              )}
              {p.change_pct != null && (
                <span className={cn("tabular-nums shrink-0", p.change_pct >= 0 ? "text-positive" : "text-negative")}>
                  {p.change_pct >= 0 ? "+" : ""}{p.change_pct.toFixed(1)}%
                </span>
              )}
              {p.pe_ratio != null && (
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {p.pe_ratio.toFixed(1)}x
                </span>
              )}
              {p.market_cap != null && (
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {fmtCap(p.market_cap)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
