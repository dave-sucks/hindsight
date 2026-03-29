"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { PnlArrow } from "@/components/ui/pnl-arrow";
import { StockLogo } from "@/components/StockLogo";
import { Flag } from "lucide-react";
import type { MorningBriefItem } from "@/lib/actions/analyst.actions";

type PortfolioAlert = { ticker: string; alert: string; urgency: string };
type WatchlistUpdate = { ticker: string; update: string; recommendation: string };
type NewOpportunity = { headline: string; tickers: string[]; thesisSeed: string };

function safeArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return [];
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatRecommendation(rec: string): string {
  switch (rec) {
    case "INITIATE": return "Initiate";
    case "ADD_TO_WATCHLIST": return "Watch";
    case "REMOVE": return "Remove";
    case "HOLD": return "Hold";
    case "RESEARCH_MORE": return "Research";
    default: return rec.toLowerCase().replace(/_/g, " ");
  }
}

// ── Morning Brief Card ──────────────────────────────────────────────────────
// Matches BriefCard pattern from brief-cards.tsx

function MorningBriefCard({
  brief,
  onClick,
}: {
  brief: MorningBriefItem;
  onClick: () => void;
}) {
  const alerts = safeArray<PortfolioAlert>(brief.portfolioAlerts);
  const opportunities = safeArray<NewOpportunity>(brief.newOpportunities);
  const risks = brief.riskFlags ?? [];

  const counts: string[] = [];
  if (alerts.length > 0) counts.push(`${alerts.length} alert${alerts.length !== 1 ? "s" : ""}`);
  if (opportunities.length > 0) counts.push(`${opportunities.length} opp.`);
  if (risks.length > 0) counts.push(`${risks.length} risk${risks.length !== 1 ? "s" : ""}`);

  return (
    <div
      className="rounded-lg border bg-background hover:border-foreground/25 transition-colors cursor-pointer"
      onClick={onClick}
    >
      {/* Top: date + signal count */}
      <div className="p-3 border-b">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{formatDate(brief.date)}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {brief.signalCount} signal{brief.signalCount !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Market context */}
      {brief.marketContext && (
        <div className="p-3 border-b">
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
            {brief.marketContext}
          </p>
        </div>
      )}

      {/* Focus tickers + counts footer */}
      <div className="p-3 flex items-center gap-2">
        {brief.attentionPriority.length > 0 && (
          <span className="text-xs font-mono font-medium text-muted-foreground">
            {brief.attentionPriority.slice(0, 3).join(" · ")}
          </span>
        )}
        {counts.length > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">
            {counts.join(" · ")}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Morning Brief Detail (dialog) ───────────────────────────────────────────
// Same p-3 border-b section layout as BriefDetail in brief-cards.tsx

function MorningBriefDetail({ brief }: { brief: MorningBriefItem }) {
  const alerts = safeArray<PortfolioAlert>(brief.portfolioAlerts);
  const updates = safeArray<WatchlistUpdate>(brief.watchlistUpdates);
  const opportunities = safeArray<NewOpportunity>(brief.newOpportunities);
  const risks = brief.riskFlags ?? [];
  const priorities = brief.attentionPriority ?? [];

  return (
    <div>
      {/* Header */}
      <div className="p-3 border-b">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{formatDate(brief.date)}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {brief.signalCount} signals
          </span>
        </div>
      </div>

      {/* Market context — readable prose */}
      {brief.marketContext && (
        <div className="p-3 border-b">
          <p className="text-sm leading-relaxed">{brief.marketContext}</p>
        </div>
      )}

      {/* Portfolio alerts */}
      {alerts.length > 0 && (
        <div className="p-3 border-b space-y-3">
          <p className="text-sm font-medium">Portfolio</p>
          {alerts.map((a, i) => {
            const isBearish = /down|drop|fall|cut|freeze|miss|decline|loss|warning|lower|weak/i.test(a.alert);
            return (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-2">
                  <StockLogo ticker={a.ticker} size="sm" />
                  <span className="font-mono text-[11px] text-muted-foreground">{a.ticker}</span>
                  <PnlArrow direction={isBearish ? "down" : "up"} className="h-4 w-4" />
                  {(a.urgency === "HIGH" || a.urgency === "CRITICAL" || a.urgency === "BREAKING") && (
                    <span className="text-xs text-red-500 ml-auto">{a.urgency.toLowerCase()}</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed pl-8">{a.alert}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Watchlist */}
      {updates.length > 0 && (
        <div className="p-3 border-b space-y-3">
          <p className="text-sm font-medium">Watchlist</p>
          {updates.map((u, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2">
                <StockLogo ticker={u.ticker} size="sm" />
                <span className="font-mono text-[11px] text-muted-foreground">{u.ticker}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {formatRecommendation(u.recommendation)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed pl-8">{u.update}</p>
            </div>
          ))}
        </div>
      )}

      {/* Opportunities */}
      {opportunities.length > 0 && (
        <div className="p-3 border-b space-y-3">
          <p className="text-sm font-medium">Opportunities</p>
          {opportunities.map((o, i) => (
            <div key={i} className="space-y-1">
              <p className="text-sm leading-relaxed">
                <span className="font-medium">{o.headline}</span>
                {o.tickers.length > 0 && (
                  <span className="font-mono text-[11px] text-muted-foreground ml-1.5">
                    {o.tickers.join(", ")}
                  </span>
                )}
              </p>
              {o.thesisSeed && (
                <p className="text-sm text-muted-foreground leading-relaxed">{o.thesisSeed}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Risk flags */}
      {risks.length > 0 && (
        <div className="p-3 border-b space-y-2">
          <p className="text-sm font-medium">Risks</p>
          {risks.map((r, i) => (
            <div key={i} className="flex items-start gap-2">
              <Flag className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <p className="text-sm text-muted-foreground leading-relaxed">{r}</p>
            </div>
          ))}
        </div>
      )}

      {/* Focus tickers */}
      {priorities.length > 0 && (
        <div className="p-3">
          <div className="flex flex-wrap gap-3">
            {priorities.map((t) => (
              <div key={t} className="flex items-center gap-1.5">
                <StockLogo ticker={t} size="sm" />
                <span className="font-mono text-[11px] font-medium">{t}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Feed ─────────────────────────────────────────────────────────────────────

export function MorningBriefFeed({
  briefs,
}: {
  briefs: MorningBriefItem[];
}) {
  const [selected, setSelected] = useState<MorningBriefItem | null>(null);

  if (briefs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-3">
        <p className="text-sm text-muted-foreground">No morning briefs yet</p>
        <p className="text-xs text-muted-foreground/70 max-w-sm text-center">
          Morning briefs are generated by the intelligence pipeline before each
          trading session. They surface overnight signals, portfolio alerts, and
          new opportunities.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {briefs.map((brief) => (
          <MorningBriefCard
            key={brief.id}
            brief={brief}
            onClick={() => setSelected(brief)}
          />
        ))}
      </div>

      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent className="sm:max-w-4xl p-0">
          <div className="max-h-[85vh] overflow-y-auto">
            {selected && <MorningBriefDetail brief={selected} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
