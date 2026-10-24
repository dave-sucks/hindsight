import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InfoRow } from "@/components/ui/info-row";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrency } from "@/lib/format";
import { tradeStatusKey } from "@/lib/stock-history";
import { getTradeStatusDisplay, humanizeCloseReason } from "@/lib/trade-status";
import { cn, pnlColor } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

/**
 * TradeDetailsCard — the nitty-gritty of one trade that has no place in the
 * thesis sheet: shares, cost basis, the fill times, the exit, the analyst,
 * and the result once it closed. Sits beside the full-page thesis.
 */
export interface TradeOrderView {
  status: string;
  createdAt: string;
  filledAt: string | null;
  alpacaOrderId: string | null;
}

export interface TradeDetails {
  id: string;
  /** Position.status: PENDING_APPROVAL | OPEN | CLOSED | CANCELLED */
  status: string;
  direction: string;
  quantity: number;
  avgCost: number;
  closePrice: number | null;
  realizedPnl: number | null;
  outcome: string | null;
  closeReason: string | null;
  openedAt: string;
  closedAt: string | null;
  agentEvaluation: string | null;
  buyFilled: boolean;
  openingBuy: TradeOrderView | null;
  closingSell: TradeOrderView | null;
  /** When the buy proposal lapses, while it still waits on you. */
  proposalExpiresAt: string | null;
  analyst: { id: string; name: string } | null;
  target: number | null;
  stop: number | null;
  holdLabel: string | null;
  composite: number | null;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const usd = (n: number | null | undefined) => (n != null ? formatCurrency(n) : "—");

/** A fill time with its order state behind a hover. */
function FillValue({ order, kind }: { order: TradeOrderView; kind: "buy" | "sell" }) {
  const waiting = order.status === "PENDING" || order.status === "AWAITING_APPROVAL";
  const text = order.filledAt
    ? fmtDateTime(order.filledAt)
    : order.status === "AWAITING_APPROVAL"
      ? "Not ordered"
      : order.status === "PENDING"
        ? "Awaiting fill"
        : order.status === "CANCELLED" || order.status === "EXPIRED"
          ? "Never filled"
          : order.status === "REJECTED"
            ? "Rejected"
            : "—";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "cursor-default font-medium tabular-nums underline decoration-dotted decoration-muted-foreground/40 underline-offset-2",
              waiting && "text-amber-500",
            )}
          />
        }
      >
        {text}
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs text-xs">
        <div>
          {order.filledAt
            ? `Filled ${fmtDateTime(order.filledAt)}`
            : `${order.status === "AWAITING_APPROVAL" ? "Proposed" : "Ordered"} ${fmtDateTime(order.createdAt)}`}
        </div>
        {order.status === "AWAITING_APPROVAL" ? (
          <div className="text-amber-500">Awaiting your approval · nothing sent to the broker</div>
        ) : null}
        {order.status === "PENDING" ? (
          <div className="text-amber-500">Awaiting fill · checked every 5 minutes</div>
        ) : null}
        {order.alpacaOrderId ? (
          <div className="text-xs tabular-nums opacity-60">
            Alpaca {order.alpacaOrderId} · {kind}
          </div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function TradeDetailsCard({
  trade,
  livePrice,
  actions,
}: {
  trade: TradeDetails;
  livePrice: number | null;
  /** The kebab (close trade, cancel order, view run). */
  actions?: ReactNode;
}) {
  const key = tradeStatusKey(trade);
  const display = getTradeStatusDisplay(key);
  const isOpen = key === "OPEN";
  const isClosed = key === "CLOSED_WIN" || key === "CLOSED_LOSS" || key === "CLOSED_EXPIRED";
  const isProposal = key === "PENDING" && trade.status === "PENDING_APPROVAL";
  const never = key === "CANCELLED";

  const cost = trade.avgCost * trade.quantity;
  const current = livePrice ?? trade.closePrice ?? trade.avgCost;
  const unrealized = isOpen
    ? trade.direction === "SHORT"
      ? (trade.avgCost - current) * trade.quantity
      : (current - trade.avgCost) * trade.quantity
    : null;
  const unrealizedPct = unrealized != null && cost > 0 ? (unrealized / cost) * 100 : null;
  const realized = trade.realizedPnl ?? 0;
  const realizedPct = cost > 0 ? (realized / cost) * 100 : 0;
  const proceeds = trade.closePrice != null ? trade.closePrice * trade.quantity : null;
  const daysHeld = trade.closedAt
    ? Math.max(1, Math.round((new Date(trade.closedAt).getTime() - new Date(trade.openedAt).getTime()) / 86_400_000))
    : null;

  const reward = trade.target != null ? Math.abs(trade.direction === "SHORT" ? trade.avgCost - trade.target : trade.target - trade.avgCost) : null;
  const risk = trade.stop != null ? Math.abs(trade.direction === "SHORT" ? trade.stop - trade.avgCost : trade.avgCost - trade.stop) : null;
  const riskReward = reward != null && risk != null && risk > 0 ? reward / risk : null;

  const exit = humanizeCloseReason(trade.closeReason);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Trade
          <Badge variant="secondary">
            <span className={cn("size-1.5 shrink-0 rounded-full", display.dotClass)} />
            {display.label}
          </Badge>
        </CardTitle>
        {actions ? <CardAction>{actions}</CardAction> : null}
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-1">
          {isClosed ? (
            <div className="mb-2 flex flex-col gap-0.5">
              <div className="flex items-baseline gap-2">
                <span className={cn("text-2xl font-semibold tabular-nums", pnlColor(realized))}>
                  {realized >= 0 ? "+" : ""}
                  {usd(realized)}
                </span>
                <PnlBadge value={realizedPct} />
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {daysHeld != null ? `${daysHeld} day${daysHeld === 1 ? "" : "s"} held` : null}
                {daysHeld != null && exit ? " · " : null}
                {exit}
              </p>
            </div>
          ) : null}
          {never ? (
            <p className="mb-2 text-xs text-muted-foreground">
              The buy was never filled, so nothing was bought or sold.
            </p>
          ) : null}

          <InfoRow label="Shares" value={String(trade.quantity)} mono />
          <InfoRow label={isProposal || never ? "Proposed price" : "Avg entry"} value={usd(trade.avgCost)} mono />
          <InfoRow label="Cost basis" value={usd(cost)} mono />
          {isClosed && trade.closePrice != null ? <InfoRow label="Sold at" value={usd(trade.closePrice)} mono /> : null}
          {isClosed && proceeds != null ? <InfoRow label="Proceeds" value={usd(proceeds)} mono /> : null}
          {trade.composite != null ? <InfoRow label="Composite" value={`${trade.composite}/10`} mono /> : null}
          <InfoRow label="Reward to risk" value={riskReward != null ? `${riskReward.toFixed(2)}:1` : "—"} mono />
          {trade.analyst ? (
            <InfoRow label="Analyst">
              <Link href={`/analysts/${trade.analyst.id}`} className="max-w-[60%] truncate text-sm font-medium text-primary hover:underline">
                {trade.analyst.name}
              </Link>
            </InfoRow>
          ) : null}
          <InfoRow label={isProposal || never ? "Proposed" : "Opened"} value={fmtDateTime(trade.openedAt)} mono />
          {isProposal && trade.proposalExpiresAt ? (
            <InfoRow label="Expires" value={fmtDateTime(trade.proposalExpiresAt)} mono valueClassName="text-amber-500" />
          ) : null}
          {trade.openingBuy ? (
            <InfoRow label="Buy filled">
              <FillValue order={trade.openingBuy} kind="buy" />
            </InfoRow>
          ) : null}
          {trade.closingSell ? (
            <InfoRow label="Sell filled">
              <FillValue order={trade.closingSell} kind="sell" />
            </InfoRow>
          ) : isOpen ? (
            <InfoRow label="Sell filled" value="—" mono valueClassName="text-muted-foreground/40" />
          ) : null}
          <InfoRow label="Direction" value={trade.direction} mono />
          {trade.holdLabel ? <InfoRow label="Hold duration" value={trade.holdLabel} mono border={isOpen} /> : null}
          {isOpen && unrealized != null ? (
            <>
              <InfoRow
                label="Unrealized P&L"
                value={`${unrealized >= 0 ? "+" : ""}${usd(unrealized)}`}
                mono
                valueClassName={pnlColor(unrealized)}
              />
              <InfoRow label="Return" border={false}>
                <PnlBadge value={unrealizedPct ?? 0} />
              </InfoRow>
            </>
          ) : null}

          {trade.agentEvaluation ? (
            <Collapsible className="mt-2">
              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 py-1 text-left text-sm font-medium hover:text-foreground">
                Post-mortem
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform data-[panel-open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="whitespace-pre-line pt-1 text-sm leading-relaxed text-muted-foreground">
                {trade.agentEvaluation}
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
