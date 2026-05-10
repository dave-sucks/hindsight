"use client";

/**
 * ReadThesesTable — render get_theses results in the same row table
 * shape as DecisionSummaryCard (the run summary table). Status-led
 * (Holding / Watching / Closed / Invalidated) instead of action-led
 * (Hold / Sold / Watch / Pass), because get_theses is a READ — the
 * "what's it doing right now" question, not "what did the agent do."
 *
 * Row layout matches DecisionSummaryCard exactly: logo, ticker chip,
 * status badge with dot, summary text right-aligned. The hover card
 * promotes the same data into a wider preview.
 */

import type { ComponentProps } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/StockLogo";
import type { ThesisCardData } from "@/components/domain/thesis-card";
import { getThesisStatusDisplay } from "@/lib/thesis-status";

// ─── Row ─────────────────────────────────────────────────────────────────────

function describeNeedsAction(na: NonNullable<ThesisCardData["needs_action"]>): string {
  switch (na.kind) {
    case "TRIGGER_FIRED":
      return `Trigger fired: ${na.action}`;
    case "TRIGGER_MATCHING_NOW":
      return `Trigger matching: ${na.predicateSummary}`;
    case "REVIEW_DUE":
      return na.daysOverdue > 0
        ? `Review ${na.daysOverdue}d overdue`
        : "Review due";
  }
}

function ThesisReadRow({
  thesis,
  onClick,
}: {
  thesis: ThesisCardData;
  onClick: () => void;
}) {
  const status = getThesisStatusDisplay(thesis.status);
  const summary = thesis.reasoning_summary?.trim() || "—";
  const needsAction = thesis.needs_action ?? null;
  const needsActionLabel = needsAction ? describeNeedsAction(needsAction) : null;

  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <div
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }}
            className="flex items-center gap-1.5 rounded-md p-2 hover:bg-muted/70 transition-colors cursor-pointer"
          />
        }
      >
        <StockLogo ticker={thesis.ticker} size="sm" />
        <span className="text-sm font-semibold font-brand shrink-0 mr-1">
          {thesis.ticker}
        </span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Badge variant="secondary" className="gap-1.5 font-normal">
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", status.dotClass)} />
                  {status.label}
                </Badge>
              }
            />
            <TooltipContent>{status.tooltip}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {needsActionLabel ? (
          <Badge variant="outline" className="gap-1.5 font-normal">
            <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-amber-500" />
            {needsActionLabel}
          </Badge>
        ) : null}
        <span className="flex-1 min-w-0 text-right text-xs text-muted-foreground truncate">
          {summary}
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-72">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <StockLogo ticker={thesis.ticker} size="md" />
            <div className="text-base font-semibold font-brand">{thesis.ticker}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1.5 font-normal">
              <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", status.dotClass)} />
              {status.label}
            </Badge>
            {thesis.direction && thesis.direction !== "PASS" ? (
              <span className="text-xs text-muted-foreground">{thesis.direction}</span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

// ─── ReadThesesTable ─────────────────────────────────────────────────────────

export type ReadThesesTableProps = ComponentProps<typeof Card> & {
  theses: ThesisCardData[];
  onRowClick: (thesis: ThesisCardData) => void;
};

export function ReadThesesTable({
  theses,
  onRowClick,
  className,
  ...cardProps
}: ReadThesesTableProps) {
  return (
    <div className={cn("not-prose w-full", className)}>
      <Card className="p-1 gap-1" {...cardProps}>
        {theses.map((t) => (
          <ThesisReadRow
            key={t.thesis_id ?? `${t.ticker}-${t.direction}`}
            thesis={t}
            onClick={() => onRowClick(t)}
          />
        ))}
      </Card>
    </div>
  );
}
