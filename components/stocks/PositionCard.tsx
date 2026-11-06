"use client";

/**
 * The stock page's position card. The chips where the status pill used to be
 * pick what the card shows: Position (only while we hold the stock — its dot
 * pulses) is the held numbers in the Trade Details style; History is every
 * trade we made in the stock, one row each, in the trade row's style.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { ChipTabs } from "@/components/ui/chip-tabs";
import { PriceChange } from "@/components/ui/price-change";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrency } from "@/lib/format";
import { getTradeStatusDisplay } from "@/lib/trade-status";
import { humanizeCloseReason } from "@/components/domain/trade-summary";

export type PositionCardTrade = {
  id: string;
  direction: string;
  status: string;
  outcome: string | null;
  avgCost: number;
  closePrice: number | null;
  realizedPnl: number | null;
  quantity: number;
  closeReason: string | null;
  /** ISO timestamps. */
  openedAt: string;
  closedAt: string | null;
};

type View = "position" | "history";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Sep 30, 2:26 PM" for the hover line. */
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function daysBetween(fromIso: string, toIso: string | null): number {
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  return Math.max(0, Math.floor((to - new Date(fromIso).getTime()) / 86_400_000));
}

function fmtQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
}

function statusOf(t: PositionCardTrade) {
  if (t.status === "OPEN") return getTradeStatusDisplay("OPEN");
  if (t.status === "PENDING_APPROVAL" || t.status === "PENDING") return getTradeStatusDisplay("PENDING");
  return getTradeStatusDisplay(
    t.outcome === "WIN" ? "CLOSED_WIN" : t.outcome === "LOSS" ? "CLOSED_LOSS" : "CLOSED_EXPIRED",
  );
}

/** The gain on a trade: realized once sold, else marked at the price given. */
function gainOf(t: PositionCardTrade, price: number | null): { dollar: number; pct: number | null } | null {
  const cost = t.avgCost * t.quantity;
  if (t.status === "CLOSED") {
    if (t.realizedPnl == null) return null;
    return { dollar: t.realizedPnl, pct: cost > 0 ? (t.realizedPnl / cost) * 100 : null };
  }
  if (t.status !== "OPEN" || price == null) return null;
  const sign = t.direction === "SHORT" ? -1 : 1;
  const dollar = (price - t.avgCost) * t.quantity * sign;
  return { dollar, pct: cost > 0 ? (dollar / cost) * 100 : null };
}

/** One "Bought @ $x …… $total" row, the Trade Details style. */
function DetailRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between text-sm pb-1", !last && "border-b border-border")}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

/** The held position: its gain, then Bought / Now in the Trade Details style. */
function Held({ trade, price }: { trade: PositionCardTrade; price: number | null }) {
  const cost = trade.avgCost * trade.quantity;
  const gain = gainOf(trade, price);
  return (
    <>
      <div className="pb-2">
        {gain ? (
          <PriceChange dollarChange={gain.dollar} percentChange={gain.pct} size="xl" />
        ) : (
          <span className="text-xl text-muted-foreground">—</span>
        )}
      </div>
      <DetailRow
        label={`${trade.direction === "SHORT" ? "Shorted" : "Bought"} @ ${formatCurrency(trade.avgCost)}`}
        value={formatCurrency(cost)}
      />
      <DetailRow
        label={price != null ? `Now @ ${formatCurrency(price)}` : "Now"}
        value={price != null ? formatCurrency(price * trade.quantity) : "No live price"}
        last
      />
    </>
  );
}

/**
 * One trade, in the trade row's layout: the verb and its price on top with
 * the gain on the right, the shares and cost under it with the date on the
 * right (the count sits on the lower line only: with it on both, the top
 * line was cut off at the card's width).
 * The date's hover line gives the exact times. No link: the rows are on the
 * stock's own page, which is where a trade opens since 2026-11-06.
 */
function HistoryRow({ trade, price }: { trade: PositionCardTrade; price: number | null }) {
  const s = statusOf(trade);
  const gain = gainOf(trade, price);
  const open = trade.status === "OPEN";
  const closed = trade.status === "CLOSED";
  const short = trade.direction === "SHORT";
  const shares = `${fmtQty(trade.quantity)} share${trade.quantity === 1 ? "" : "s"}`;

  // Sold at its close price; a holding at the price now; a proposal at its entry.
  const verb = closed ? (short ? "Covered" : "Sold") : open ? "Holding" : short ? "Short proposed" : "Buy proposed";
  const at = closed ? trade.closePrice : open ? price : trade.avgCost;
  const value = at != null ? at * trade.quantity : null;
  const when = closed && trade.closedAt ? trade.closedAt : trade.openedAt;
  const exit = closed ? humanizeCloseReason(trade.closeReason) : null;

  return (
    <div className="block px-3 py-2.5 border-b border-border/40 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0 text-sm">
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", s.dotClass)} />
          <span className="font-medium shrink-0">{verb}</span>
          <span className="text-muted-foreground tabular-nums truncate">
            {at != null ? `at ${formatCurrency(at)}` : shares}
          </span>
        </div>
        {gain ? (
          <PriceChange dollarChange={gain.dollar} percentChange={gain.pct} size="sm" className="shrink-0" />
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 mt-0.5 text-xs text-muted-foreground tabular-nums">
        <span className="truncate">
          {value != null ? `${formatCurrency(value)} — ` : ""}
          {shares} at {formatCurrency(trade.avgCost)} entry
        </span>
        <Tooltip>
          <TooltipTrigger render={<span className="shrink-0 cursor-default" />}>{fmtDate(when)}</TooltipTrigger>
          <TooltipContent side="top" className="tabular-nums">
            <div>
              <div>
                {short ? "Shorted" : "Bought"} {fmtDateTime(trade.openedAt)}
              </div>
              {closed && trade.closedAt ? (
                <div>
                  {short ? "Covered" : "Sold"} {fmtDateTime(trade.closedAt)}
                  {exit ? ` · ${exit}` : ""}
                </div>
              ) : null}
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function PositionChip({ dotClass, label }: { dotClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotClass)} />
      {label}
    </span>
  );
}

export function PositionCard({ trades, price }: { trades: PositionCardTrade[]; price: number | null }) {
  const open = trades.find((t) => t.status === "OPEN") ?? null;
  const [view, setView] = useState<View>(open ? "position" : "history");
  const showing: View = open ? view : "history";

  // The Position chip exists only while we hold the stock; its dot is the
  // holding row's pulse, standing where the status pill used to be.
  const options = [
    ...(open
      ? [
          {
            value: "position" as const,
            label: <PositionChip dotClass={getTradeStatusDisplay("OPEN").dotClass} label="Position" />,
          },
        ]
      : []),
    { value: "history" as const, label: "History" },
  ];

  return (
    <Card className="bg-muted/40 p-2 gap-1">
      <div className="flex items-center justify-between pb-1">
        <ChipTabs
          size="sm"
          clearable={false}
          options={options}
          value={showing}
          onChange={(v) => v && setView(v)}
        />
        {showing === "position" && open ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {daysBetween(open.openedAt, null)} day{daysBetween(open.openedAt, null) !== 1 ? "s" : ""} held
          </span>
        ) : null}
      </div>

      {showing === "position" && open ? (
        <Held trade={open} price={price} />
      ) : trades.length > 0 ? (
        <div className="-mx-2 -mb-2 border-t border-border">
          {trades.map((t) => (
            <HistoryRow key={t.id} trade={t} price={price} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground px-1 pb-1">No trades yet.</p>
      )}
    </Card>
  );
}
