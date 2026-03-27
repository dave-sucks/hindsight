"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { PnlArrow } from "@/components/ui/pnl-arrow";
import {
  AlertTriangle,
  Sparkles,
  Eye,
} from "lucide-react";
import type { MorningBrief } from "./types";
import { relativeTime } from "./types";

// ── Brief Cards (grid) ───────────────────────────────────────────────────────

interface BriefCardsProps {
  briefs: MorningBrief[];
}

export function BriefCards({ briefs }: BriefCardsProps) {
  const [selected, setSelected] = useState<MorningBrief | null>(null);

  if (briefs.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-center space-y-1">
          <p className="text-sm text-muted-foreground">
            No morning briefs generated today
          </p>
          <p className="text-xs text-muted-foreground">
            Run the Morning Brief job from the pipeline trigger, or wait for the 7:45 AM cron
          </p>
        </div>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Morning Briefs
          </p>
          <span className="text-xs text-muted-foreground tabular-nums">
            {briefs.length} analyst{briefs.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Card grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {briefs.map((brief) => (
            <BriefCard
              key={brief.id}
              brief={brief}
              onClick={() => setSelected(brief)}
            />
          ))}
        </div>

        {/* Detail dialog */}
        <Dialog
          open={!!selected}
          onOpenChange={(open) => !open && setSelected(null)}
        >
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            {selected && <BriefDetail brief={selected} />}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

// ── Brief Card (compact grid item) ──────────────────────────────────────────

function BriefCard({
  brief,
  onClick,
}: {
  brief: MorningBrief;
  onClick: () => void;
}) {
  const alerts = brief.portfolioAlerts ?? [];
  const updates = brief.watchlistUpdates ?? [];
  const opportunities = brief.newOpportunities ?? [];
  const risks = brief.riskFlags ?? [];
  const priorities = brief.attentionPriority ?? [];

  return (
    <Card
      className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={onClick}
    >
      <div className="space-y-3">
        {/* Analyst + date */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{brief.analyst.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {new Date(brief.date).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>

        {/* Market context — 2 line clamp */}
        <p className="text-sm text-muted-foreground line-clamp-2">
          {brief.marketContext}
        </p>

        {/* Count badges */}
        <div className="flex items-center gap-1.5">
          {alerts.length > 0 && (
            <Badge variant="destructive">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {alerts.length} alert{alerts.length !== 1 ? "s" : ""}
            </Badge>
          )}
          {opportunities.length > 0 && (
            <Badge variant="secondary">
              <Sparkles className="h-3 w-3 mr-1" />
              {opportunities.length}
            </Badge>
          )}
          {updates.length > 0 && (
            <Badge variant="outline">
              <Eye className="h-3 w-3 mr-1" />
              {updates.length}
            </Badge>
          )}
        </div>

        {/* Focus tickers */}
        {priorities.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
              Focus today
            </p>
            <p className="text-xs font-mono font-medium text-muted-foreground">
              {priorities.join("  ·  ")}
            </p>
          </div>
        )}

        {/* Risks */}
        {risks.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
              Risks
            </p>
            <p className="text-xs text-muted-foreground">
              {risks.join("  ·  ")}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="tabular-nums">{brief.signalCount} signals</span>
          <span>{relativeTime(brief.generatedAt)}</span>
        </div>
      </div>
    </Card>
  );
}

// ── Brief Detail (dialog content) ────────────────────────────────────────────

function BriefDetail({ brief }: { brief: MorningBrief }) {
  const alerts = brief.portfolioAlerts ?? [];
  const updates = brief.watchlistUpdates ?? [];
  const opportunities = brief.newOpportunities ?? [];
  const risks = brief.riskFlags ?? [];
  const priorities = brief.attentionPriority ?? [];

  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-between pr-8">
          <DialogTitle>{brief.analyst.name}</DialogTitle>
          <span className="text-xs text-muted-foreground tabular-nums">
            {new Date(brief.date).toLocaleDateString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
      </DialogHeader>

      <div className="space-y-5 pt-2">
        {/* ── Market Context ─────────────────────────────────────── */}
        <p className="text-sm text-muted-foreground leading-relaxed">
          {brief.marketContext}
        </p>

        {/* ── Portfolio Alerts ────────────────────────────────────── */}
        {alerts.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Portfolio Alerts
              </p>
              <div className="space-y-2">
                {alerts.map((a, i) => {
                  const isCritical = a.urgency === "HIGH" || a.urgency === "CRITICAL";
                  const isBearish = /down|drop|fall|cut|freeze|miss|decline|loss|warning/i.test(a.alert);
                  return (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="text-sm font-mono font-medium shrink-0 mt-0.5">
                        {a.ticker}
                      </span>
                      {isBearish ? (
                        <PnlArrow direction="down" className="h-4 w-4 shrink-0 mt-0.5" />
                      ) : (
                        <PnlArrow direction="up" className="h-4 w-4 shrink-0 mt-0.5" />
                      )}
                      <span className="text-sm text-muted-foreground flex-1">
                        {a.alert}
                      </span>
                      <Badge
                        variant={isCritical ? "destructive" : "secondary"}
                        className="shrink-0"
                      >
                        {a.urgency}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ── New Opportunities ───────────────────────────────────── */}
        {opportunities.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                New Opportunities
              </p>
              <div className="space-y-2.5">
                {opportunities.map((o, i) => (
                  <Card key={i} className="p-3">
                    <div className="space-y-1.5">
                      <p className="text-sm font-medium">{o.headline}</p>
                      {o.tickers.length > 0 && (
                        <p className="text-xs font-mono font-medium text-muted-foreground">
                          {o.tickers.join(", ")}
                        </p>
                      )}
                      {o.thesisSeed && (
                        <p className="text-sm text-muted-foreground">
                          {o.thesisSeed}
                        </p>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Watchlist Updates ───────────────────────────────────── */}
        {updates.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Watchlist Updates
              </p>
              <div className="space-y-2">
                {updates.map((u, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span className="text-sm font-mono font-medium shrink-0 mt-0.5">
                      {u.ticker}
                    </span>
                    <span className="text-sm text-muted-foreground flex-1">
                      {u.update}
                    </span>
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-flex" />}>
                        <Badge variant="outline" className="shrink-0">
                          {formatRecommendation(u.recommendation)}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>{u.recommendation}</TooltipContent>
                    </Tooltip>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Risk Flags ─────────────────────────────────────────── */}
        {risks.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Risk Flags
              </p>
              <div className="flex flex-wrap gap-1.5">
                {risks.map((r, i) => (
                  <Badge key={i} variant="destructive">
                    {r}
                  </Badge>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Focus Today ────────────────────────────────────────── */}
        {priorities.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Focus Today
              </p>
              <p className="text-sm font-mono font-medium">
                {priorities.join("  ·  ")}
              </p>
            </div>
          </>
        )}

        {/* ── Footer ─────────────────────────────────────────────── */}
        <Separator />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="tabular-nums">
            Based on {brief.signalCount} signals
          </span>
          <span>
            Generated {relativeTime(brief.generatedAt)}
          </span>
        </div>
      </div>
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
