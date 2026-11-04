"use client";

/**
 * ThesisHeader — the top of a thesis, the same on the sheet and the trade
 * page (the owner's layout, 2026-11-04). Row one is the nav: on the sheet
 * an expand button to the full page, the status pill and the conviction
 * chip, then at the right edge the pin, a ··· menu (Send to agent, Trade,
 * Close trade with its warning) and, on the sheet, the X. Row two is the
 * stock in one line: its logo, ticker and name. One component, so the surfaces cannot
 * drift; the full page has no expand and no X.
 */

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { XIcon, MoreHorizontal } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowExpand01Icon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SheetClose } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { CloseTradeDialog } from "@/components/trades/TradeActions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FlameIcon } from "@/components/ui/flame-icon";
import { StockLogo } from "@/components/StockLogo";
import { PinButton } from "@/components/stocks/PinButton";
import { useSendToAgent } from "@/components/stocks/SendToAgentButton";
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
// The writer's conviction as one chip by the title — "🔥 High conviction"
// (the owner, 2026-11-03: the tier with the flame, nothing else). The flame
// marks the top two tiers; the reason is on the Research tab. Nothing on
// legacy rows and passes.
export function ConvictionChip({ conviction }: { conviction: Conviction | null }) {
  if (!conviction) return null;
  const label = `${conviction.charAt(0)}${conviction.slice(1).toLowerCase()} conviction`;
  const hot = conviction === "STRONG" || conviction === "HIGH";
  return (
    <Badge variant="secondary">
      {hot ? <FlameIcon className="size-3" /> : null}
      <span className="font-normal">{label}</span>
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
  /** The owning analyst; with `thesisId`, the menu offers Send to agent. */
  analystId: string | null;
  thesisId?: string;
  onSent?: () => void;
  /** More buttons at the right edge, after the menu (the stock page's watchlist menu). */
  extraActions?: ReactNode;
  /** Where the logo and name link; the stock page passes null, being there already. */
  href?: string | null;
  /** The sheet gets the expand button and the X; a page gets neither. */
  surface?: "sheet" | "page";
  /** Where the sheet's expand button goes: the trade page when there is a trade, else the stock's page. */
  expandHref?: string | null;
  /** An open trade the menu may close, with its warning. */
  closeTrade?: { tradeId: string } | null;
}

/** The ··· menu: Send to agent, Trade, Close trade. The dialogs live beside the menu, not inside it, so closing the menu doesn't unmount them. */
function ThesisActionsMenu({
  ticker,
  analystId,
  thesisId,
  onSent,
  closeTrade,
}: Pick<ThesisHeaderProps, "ticker" | "analystId" | "thesisId" | "onSent" | "closeTrade">) {
  const [tradeSignal, setTradeSignal] = useState(0);
  const [closing, setClosing] = useState(false);
  const canSend = Boolean(analystId && thesisId);
  const { pending, send } = useSendToAgent(analystId ?? "", ticker, thesisId ?? "", onSent);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${ticker}`} />}>
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {canSend ? (
            <DropdownMenuItem disabled={pending} onClick={() => send()}>
              Send to agent
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setTradeSignal((n) => n + 1)}>Trade</DropdownMenuItem>
          {closeTrade ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setClosing(true)}>
                Close trade
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <TradeButton ticker={ticker} analystId={analystId} openSignal={tradeSignal} hideTrigger />
      {closeTrade ? (
        <CloseTradeDialog tradeId={closeTrade.tradeId} ticker={ticker} open={closing} onOpenChange={setClosing} />
      ) : null}
    </>
  );
}

export function ThesisHeader({
  ticker,
  displayName,
  status,
  agentWatchDays,
  conviction,
  analystId,
  thesisId,
  onSent,
  extraActions,
  href,
  surface = "page",
  expandHref,
  closeTrade,
}: ThesisHeaderProps) {
  const sheet = surface === "sheet";
  const link = href === undefined ? `/stocks/${ticker}` : href;
  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-1 flex items-center gap-1.5">
        {sheet && expandHref ? (
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href={expandHref} />}
            aria-label={`Open ${ticker}'s page`}
          >
            <HugeiconsIcon icon={ArrowExpand01Icon} className="size-4" />
          </Button>
        ) : null}
        <StatusPill status={status} agentWatchDays={agentWatchDays} />
        <ConvictionChip conviction={conviction} />
        <div className="ml-auto flex items-center gap-0.5">
          <PinButton ticker={ticker} />
          <ThesisActionsMenu ticker={ticker} analystId={analystId} thesisId={thesisId} onSent={onSent} closeTrade={closeTrade} />
          {extraActions}
          {sheet ? (
            <SheetClose render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}>
              <XIcon className="size-4" />
            </SheetClose>
          ) : null}
        </div>
      </div>
      {/* Row two: the stock, in one line (the owner, 2026-11-04): the logo one
          size down, the ticker in mono and muted, the name in the foreground,
          both one size under the old heading. */}
      <div className="flex items-center gap-2.5 min-w-0">
        {link ? (
          <Link href={link} className="shrink-0">
            <StockLogo ticker={ticker} size="md" />
          </Link>
        ) : (
          <StockLogo ticker={ticker} size="md" />
        )}
        <span className="font-mono text-lg font-semibold uppercase tracking-wide text-foreground shrink-0">{ticker}</span>
        <p className="text-lg font-semibold text-foreground truncate min-w-0">
          {link ? (
            <Link href={link} className="hover:underline underline-offset-4">
              {displayName}
            </Link>
          ) : (
            displayName
          )}
        </p>
      </div>
    </div>
  );
}
