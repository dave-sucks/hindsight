"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  TrendingUp,
  Eye,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MorningBrief } from "./types";
import { relativeTime } from "./types";

// ── Brief Section ───────────────────────────────────────────────────────────

interface BriefCardsProps {
  briefs: MorningBrief[];
}

export function BriefCards({ briefs }: BriefCardsProps) {
  if (briefs.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-center space-y-1">
          <p className="text-sm text-muted-foreground">
            No morning briefs generated today
          </p>
          <p className="text-xs text-muted-foreground">
            Run the Morning Brief job from the Pipeline tab, or wait for the 7:45 AM cron
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Morning Briefs
        </p>
        <span className="text-xs text-muted-foreground tabular-nums">
          {briefs.length} analyst{briefs.length !== 1 ? "s" : ""}
        </span>
      </div>
      {briefs.map((brief) => (
        <BriefCard key={brief.id} brief={brief} />
      ))}
    </div>
  );
}

// ── Individual Brief Card ───────────────────────────────────────────────────

function BriefCard({ brief }: { brief: MorningBrief }) {
  const [open, setOpen] = useState(false);

  const alerts = Array.isArray(brief.portfolioAlerts) ? brief.portfolioAlerts : [];
  const updates = Array.isArray(brief.watchlistUpdates) ? brief.watchlistUpdates : [];
  const opportunities = Array.isArray(brief.newOpportunities) ? brief.newOpportunities : [];
  const risks = Array.isArray(brief.riskFlags) ? brief.riskFlags : [];
  const priorities = Array.isArray(brief.attentionPriority) ? brief.attentionPriority : [];

  return (
    <TooltipProvider>
      <Collapsible open={open} onOpenChange={setOpen}>
        <Card className="p-0 overflow-hidden">
          {/* Header — always visible */}
          <CollapsibleTrigger
            render={<Button variant="ghost" className="w-full justify-start rounded-none px-4 py-3 h-auto" />}
          >
            <div className="flex items-center gap-3 w-full">
              {open ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}

              <span className="text-sm font-medium">{brief.analyst.name}</span>

              <div className="flex items-center gap-1.5 ml-auto">
                {alerts.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Badge variant="destructive">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        {alerts.length}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>Portfolio alerts</TooltipContent>
                  </Tooltip>
                )}
                {opportunities.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Badge variant="secondary">
                        <Sparkles className="h-3 w-3 mr-1" />
                        {opportunities.length}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>New opportunities</TooltipContent>
                  </Tooltip>
                )}
                {updates.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Badge variant="outline">
                        <Eye className="h-3 w-3 mr-1" />
                        {updates.length}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>Watchlist updates</TooltipContent>
                  </Tooltip>
                )}
                <span className="text-xs text-muted-foreground tabular-nums ml-2">
                  {brief.signalCount} signals
                </span>
                <span className="text-xs text-muted-foreground">
                  {relativeTime(brief.generatedAt)}
                </span>
              </div>
            </div>
          </CollapsibleTrigger>

          {/* Expanded content */}
          <CollapsibleContent>
            <Separator />
            <div className="p-4 space-y-4">
              {/* Market context */}
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                  Market Context
                </p>
                <p className="text-sm text-muted-foreground">{brief.marketContext}</p>
              </div>

              {/* Portfolio Alerts */}
              {alerts.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                    Portfolio Alerts
                  </p>
                  <div className="space-y-1">
                    {alerts.map((a, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Badge variant="secondary">${a.ticker}</Badge>
                        <span className="text-muted-foreground">{a.alert}</span>
                        {a.urgency === "HIGH" || a.urgency === "BREAKING" ? (
                          <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* New Opportunities */}
              {opportunities.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                    New Opportunities
                  </p>
                  <div className="space-y-1.5">
                    {opportunities.map((o, i) => (
                      <div key={i} className="text-sm">
                        <div className="flex items-center gap-1.5">
                          <TrendingUp className="h-3 w-3 text-emerald-500 shrink-0" />
                          <span className="font-medium">{o.headline}</span>
                        </div>
                        {o.tickers.length > 0 && (
                          <div className="flex gap-1 mt-0.5 ml-[18px]">
                            {o.tickers.map((t) => (
                              <Badge key={t} variant="secondary">
                                ${t}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {o.thesisSeed && (
                          <p className="text-xs text-muted-foreground ml-[18px] mt-0.5">
                            {o.thesisSeed}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Watchlist Updates */}
              {updates.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                    Watchlist Updates
                  </p>
                  <div className="space-y-1">
                    {updates.map((u, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Badge variant="secondary">${u.ticker}</Badge>
                        <span className="text-muted-foreground">{u.update}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Risk flags + attention priority */}
              {(risks.length > 0 || priorities.length > 0) && (
                <div className="flex gap-6">
                  {risks.length > 0 && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                        Risk Flags
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {risks.map((r, i) => (
                          <Badge key={i} variant="destructive">
                            {r}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {priorities.length > 0 && (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                        Focus Today
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {priorities.map((t, i) => (
                          <Badge key={i} variant="outline">
                            ${t}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </TooltipProvider>
  );
}
