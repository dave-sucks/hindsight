"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PnlArrow } from "@/components/ui/pnl-arrow";
import { StockLogo } from "@/components/StockLogo";
import { ExternalLink, Search, Flag } from "lucide-react";
import { EducationEmptyState } from "@/components/domain/education-card";
import { Favicon } from "@/components/intelligence/signal-feed";
import type { Signal } from "@/components/intelligence/types";
import {
  relativeTime,
  SENTIMENT_CONFIG,
} from "@/components/intelligence/types";
import { cn } from "@/lib/utils";

// ── AnalystFindingsTab ──────────────────────────────────────────────────────

interface AnalystFindingsTabProps {
  analystId: string;
}

export function AnalystFindingsTab({ analystId }: AnalystFindingsTabProps) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Signal | null>(null);

  useEffect(() => {
    fetch(`/api/intelligence/signals?analystId=${analystId}&limit=50`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setSignals)
      .finally(() => setLoading(false));
  }, [analystId]);

  const handleSelect = useCallback((signal: Signal) => {
    setSelected(signal);
  }, []);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }

  if (signals.length === 0) {
    return <EducationEmptyState stateKey="analyst-findings" />;
  }

  return (
    <>
      <div className="space-y-2">
        {signals.map((signal) => {
          const sentimentDir =
            signal.sentiment === "BULLISH" ? "up" as const
            : signal.sentiment === "BEARISH" ? "down" as const
            : null;
          const primaryDomain = extractDomain(signal.sourceUrls);

          return (
            <Card
              key={signal.id}
              className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => handleSelect(signal)}
            >
              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <p className="text-sm font-medium leading-tight flex-1 min-w-0">
                    {signal.headline}
                  </p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {signal.tickers.length > 0 && (
                      <span className="text-xs font-mono font-medium text-muted-foreground">
                        {signal.tickers.length === 1
                          ? signal.tickers[0]
                          : signal.tickers.slice(0, 2).join(", ")}
                        {signal.tickers.length > 2 && ` +${signal.tickers.length - 2}`}
                      </span>
                    )}
                    {sentimentDir && (
                      <PnlArrow direction={sentimentDir} className="h-4 w-4" />
                    )}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {signal.summary}
                </p>
                <div className="flex items-center gap-1.5">
                  {primaryDomain && <Favicon domain={primaryDomain} />}
                  {signal.sourceNames[0] && (
                    <span className="text-xs text-muted-foreground">{signal.sourceNames[0]}</span>
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums ml-auto shrink-0">
                    {relativeTime(signal.createdAt)}
                  </span>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Detail dialog — same pattern as signal-feed SignalDetail */}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent className="sm:max-w-4xl p-0">
          <div className="max-h-[85vh] overflow-y-auto">
            {selected && <FindingDetail signal={selected} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Finding Detail — same p-3 border-b layout as signal-feed ────────────────

function FindingDetail({ signal }: { signal: Signal }) {
  const sentiment = SENTIMENT_CONFIG[signal.sentiment] ?? SENTIMENT_CONFIG.NEUTRAL;
  const sentimentDir =
    signal.sentiment === "BULLISH" ? "up" as const
    : signal.sentiment === "BEARISH" ? "down" as const
    : null;

  return (
    <div>
      <div className="p-3 border-b">
        <h2 className="text-lg font-semibold leading-tight">{signal.headline}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mt-2">{signal.summary}</p>
      </div>

      {signal.tickers.length > 0 && (
        <div className="p-3 border-b space-y-2">
          {signal.tickers.map((t) => (
            <div key={t} className="flex items-center gap-2">
              <StockLogo ticker={t} size="sm" />
              <span className="font-mono text-[11px] text-muted-foreground">{t}</span>
              {sentimentDir && <PnlArrow direction={sentimentDir} className="h-4 w-4" />}
              {sentimentDir && (
                <span className={cn("text-xs tabular-nums ml-auto", sentiment.className)}>
                  {sentiment.label}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {signal.sourceUrls.length > 0 && (
        <div className="p-3 border-b space-y-1">
          {signal.sourceUrls.map((url, i) => {
            let domain = url;
            try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
            const name = signal.sourceNames[i];
            return (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 rounded-md px-2.5 py-2 -mx-2.5 hover:bg-accent/50 transition-colors group"
              >
                <Favicon domain={domain} size={20} />
                <span className="flex-1 min-w-0">
                  {name && <span className="text-sm text-foreground">{name}</span>}
                  <span className="text-xs text-muted-foreground font-mono ml-1.5">{domain}</span>
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </a>
            );
          })}
        </div>
      )}

      <div className="p-3">
        {signal.searchQuery && (
          <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 mb-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <p className="text-xs text-foreground truncate">{signal.searchQuery}</p>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground tabular-nums ml-auto">
            {relativeTime(signal.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

function extractDomain(urls: string[]): string | null {
  for (const url of urls) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { /* skip */ }
  }
  return null;
}
