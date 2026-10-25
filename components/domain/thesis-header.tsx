"use client";

/**
 * ThesisHeader — the top of a thesis, the same on the sheet and the trade
 * page: the status pill and conviction on one row, then the stock's logo,
 * name and ticker with the action buttons on the right. One component, so
 * the two surfaces cannot drift.
 */

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FlameIcon } from "@/components/ui/flame-icon";
import { StockIdentityHeader } from "@/components/domain/stock-identity-header";
import { PinButton } from "@/components/stocks/PinButton";
import { SendToAgentButton } from "@/components/stocks/SendToAgentButton";
import { TradeButton } from "@/components/trade/TradeButton";
import { agentWatchTooltip } from "@/lib/agent/triggers/agent-watch";
import { getThesisStatusDisplay, type ThesisStatus } from "@/lib/thesis-status";
import { cn } from "@/lib/utils";

export type Conviction = "STRONG" | "HIGH" | "MEDIUM" | "LOW";

// ── StatusPill ──
// Single Badge with status dot + label. A watched name the agent revisits on
// its own schedule reads as "Agent Watch", with a slow breathing dot and a
// shimmer on the word. A plain watch stays "Watching" with a still gray dot.
export function StatusPill({
  status,
  agentWatchDays: days = null,
}: {
  status: ThesisStatus | string;
  /** Days between the agent's reviews; null = it isn't reviewing this. */
  agentWatchDays?: number | null;
}) {
  const display = getThesisStatusDisplay(status);
  const agentWatched = status === "WATCHING" && days != null;

  if (!agentWatched) {
    return (
      <Badge variant="secondary" className="gap-1.5 font-normal">
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", display.dotClass)} />
        {display.label}
      </Badge>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant="secondary" className="gap-1.5 font-normal">
            <span className="agent-watch-dot h-1.5 w-1.5 rounded-full shrink-0 bg-foreground" />
            <span className="shimmer-text">Agent Watch</span>
          </Badge>
        }
      />
      <TooltipContent side="bottom">{agentWatchTooltip(days)}</TooltipContent>
    </Tooltip>
  );
}

// ── ConvictionBadge ──
// The writer's view-strength tier. One variant for every tier — the word
// carries it, and the top tiers add a flame. Null on legacy rows.
export function ConvictionBadge({
  conviction,
  rationale,
}: {
  conviction: Conviction | null;
  rationale: string | null;
}) {
  if (!conviction) return null;
  const label = `${conviction.charAt(0)}${conviction.slice(1).toLowerCase()} Conviction`;
  const hot = conviction === "STRONG" || conviction === "HIGH";
  const badge = (
    <Badge variant="secondary">
      {hot ? <FlameIcon className="size-3" /> : null}
      {label}
    </Badge>
  );
  if (!rationale) return badge;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="cursor-help inline-flex items-center" />}>{badge}</TooltipTrigger>
      <TooltipContent>{rationale}</TooltipContent>
    </Tooltip>
  );
}

export interface ThesisHeaderProps {
  ticker: string;
  displayName: string;
  exchange: string | null;
  status: ThesisStatus | string;
  agentWatchDays: number | null;
  conviction: Conviction | null;
  convictionRationale: string | null;
  /** The owning analyst; with `thesisId`, shows Send to agent. */
  analystId: string | null;
  thesisId?: string;
  onSent?: () => void;
  /** More buttons at the right edge, after pin (the trade page's ··· menu). */
  extraActions?: ReactNode;
}

export function ThesisHeader({
  ticker,
  displayName,
  exchange,
  status,
  agentWatchDays,
  conviction,
  convictionRationale,
  analystId,
  thesisId,
  onSent,
  extraActions,
}: ThesisHeaderProps) {
  return (
    <StockIdentityHeader
      ticker={ticker}
      displayName={displayName}
      exchange={exchange}
      badges={
        <>
          <StatusPill status={status} agentWatchDays={agentWatchDays} />
          <ConvictionBadge conviction={conviction} rationale={convictionRationale} />
        </>
      }
      actions={
        <>
          {analystId && thesisId ? (
            <SendToAgentButton analystId={analystId} ticker={ticker} thesisId={thesisId} onSent={onSent} />
          ) : null}
          <TradeButton ticker={ticker} analystId={analystId} />
          <PinButton ticker={ticker} />
          {extraActions}
        </>
      }
    />
  );
}
