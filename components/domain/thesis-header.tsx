"use client";

/**
 * ThesisHeader — the top of a thesis, the same on the sheet and the trade
 * page: the stock's logo, its name with the status pill and the conviction
 * chip (with the score) beside it, the ticker under them, the action buttons
 * on the right. One component, so the two surfaces cannot drift.
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

// ── ConvictionChip ──
// The writer's conviction and its score as one chip by the title — "🔥 High
// conviction · 8/10" (the owner, 2026-11-02). The flame marks the top two
// tiers; the conviction's one-line reason is on the Thesis tab, folded with
// where we differ from the street. Nothing on legacy rows and passes.
export function ConvictionChip({ conviction, score }: { conviction: Conviction | null; score: number | null }) {
  if (!conviction && score == null) return null;
  const label = conviction ? `${conviction.charAt(0)}${conviction.slice(1).toLowerCase()} conviction` : null;
  const hot = conviction === "STRONG" || conviction === "HIGH";
  return (
    <Badge variant="secondary">
      {hot ? <FlameIcon className="size-3" /> : null}
      {label ? <span className="font-normal">{label}</span> : null}
      {label && score != null ? <span className="text-muted-foreground">·</span> : null}
      {score != null ? <span className="font-normal tabular-nums">{score}/10</span> : null}
    </Badge>
  );
}

export interface ThesisHeaderProps {
  ticker: string;
  displayName: string;
  /** Kept for callers; the exchange no longer shows — the conviction does. */
  exchange?: string | null;
  status: ThesisStatus | string;
  agentWatchDays: number | null;
  conviction: Conviction | null;
  /** The thesis's score out of 10, beside the conviction. */
  score?: number | null;
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
  status,
  agentWatchDays,
  conviction,
  score = null,
  analystId,
  thesisId,
  onSent,
  extraActions,
}: ThesisHeaderProps) {
  return (
    <StockIdentityHeader
      ticker={ticker}
      displayName={displayName}
      inlineBadge={
        <span className="inline-flex items-center gap-1.5">
          <StatusPill status={status} agentWatchDays={agentWatchDays} />
          <ConvictionChip conviction={conviction} score={score} />
        </span>
      }
      subline={ticker}
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
