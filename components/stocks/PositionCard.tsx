"use client";

/**
 * The stock page's position card: what we hold in this stock now, and every
 * trade we ever made in it, behind two small tabs. The Position tab reads
 * like a receipt — Bought, then Now (or Sold), then the gain as the total.
 * The History tab is one line per trade with its result, and a total line.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PriceChange } from "@/components/ui/price-change";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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

const POSITION = 0;
const HISTORY = 1;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysBetween(fromIso: string, toIso: string | null): number {
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  return Math.max(0, Math.floor((to - new Date(fromIso).getTime()) / 86_400_000));
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

function StatusBadge({ trade }: { trade: PositionCardTrade }) {
  const s = statusOf(trade);
  return (
    <Badge variant="secondary" className="gap-1.5 font-normal">
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", s.dotClass)} />
      {s.label}
    </Badge>
  );
}

/** One receipt line: a label, the big amount, the small print under it. */
function ReceiptBlock({ label, amount, detail }: { label: string; amount: string; detail: string }) {
  return (
    <div className="rounded-md border bg-background/60 px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums leading-tight">{amount}</p>
      <p className="text-xs text-muted-foreground tabular-nums">{detail}</p>
    </div>
  );
}

function Receipt({ trade, price }: { trade: PositionCardTrade; price: number | null }) {
  const closed = trade.status === "CLOSED";
  const short = trade.direction === "SHORT";
  const qty = Number.isInteger(trade.quantity) ? trade.quantity : trade.quantity.toFixed(2);
  const cost = trade.avgCost * trade.quantity;
  const gain = gainOf(trade, price);
  const held = daysBetween(trade.openedAt, trade.closedAt);
  const exit = closed ? humanizeCloseReason(trade.closeReason) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <StatusBadge trade={trade} />
        <span className="text-xs text-muted-foreground tabular-nums">
          {held} day{held !== 1 ? "s" : ""} held
        </span>
      </div>

      <ReceiptBlock
        label={short ? "Shorted" : "Bought"}
        amount={formatCurrency(cost)}
        detail={`${qty} shares @ ${formatCurrency(trade.avgCost)} · ${fmtDate(trade.openedAt)}`}
      />
      <div className="flex justify-center -my-1">
        <ArrowDown className="h-3.5 w-3.5 text-muted-foreground/50" />
      </div>
      {closed ? (
        <ReceiptBlock
          label={short ? "Covered" : "Sold"}
          amount={trade.closePrice != null ? formatCurrency(trade.closePrice * trade.quantity) : "—"}
          detail={
            (trade.closePrice != null ? `@ ${formatCurrency(trade.closePrice)}` : "") +
            (trade.closedAt ? ` · ${fmtDate(trade.closedAt)}` : "") +
            (exit ? ` · ${exit}` : "")
          }
        />
      ) : (
        <ReceiptBlock
          label="Now"
          amount={price != null ? formatCurrency(price * trade.quantity) : "—"}
          detail={price != null ? `@ ${formatCurrency(price)} · live` : "No live price"}
        />
      )}

      <div className="flex items-center justify-between border-t border-border pt-2">
        <span className="text-sm text-muted-foreground">{closed ? "Result" : "Gain"}</span>
        {gain ? <PriceChange dollarChange={gain.dollar} percentChange={gain.pct} size="base" /> : <span>—</span>}
      </div>

      <Link
        href={`/trades/${trade.id}`}
        className="block text-xs text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
      >
        View trade →
      </Link>
    </div>
  );
}

function HistoryRows({ trades, price }: { trades: PositionCardTrade[]; price: number | null }) {
  const sold = trades.filter((t) => t.status === "CLOSED");
  const won = sold.filter((t) => t.outcome === "WIN").length;
  const realized = sold.reduce((sum, t) => sum + (t.realizedPnl ?? 0), 0);
  const cost = sold.reduce((sum, t) => sum + t.avgCost * t.quantity, 0);

  return (
    <div>
      {trades.map((t) => {
        const gain = gainOf(t, price);
        const s = statusOf(t);
        const short = t.direction === "SHORT";
        const qty = Number.isInteger(t.quantity) ? t.quantity : t.quantity.toFixed(2);
        return (
          <Link
            key={t.id}
            href={`/trades/${t.id}`}
            className="flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-0 hover:bg-muted/70 -mx-1 px-1 rounded-sm transition-colors"
          >
            <span className="min-w-0">
              <span className="block text-sm tabular-nums truncate">
                {formatCurrency(t.avgCost)}
                {t.status === "CLOSED" && t.closePrice != null ? ` → ${formatCurrency(t.closePrice)}` : ""}
                {t.status === "OPEN" ? " → now" : ""}
              </span>
              <span className="block text-xs text-muted-foreground tabular-nums truncate">
                <span className={cn("inline-block h-1.5 w-1.5 rounded-full mr-1.5 align-middle", s.dotClass)} />
                {qty} sh · {fmtDate(t.openedAt)}
                {t.status === "CLOSED" && t.closedAt ? ` → ${fmtDate(t.closedAt)}` : ""}
                {t.status === "OPEN" ? " · holding" : ""}
                {t.status === "PENDING_APPROVAL" ? ` · ${short ? "short" : "buy"} proposed` : ""}
              </span>
            </span>
            {gain ? (
              <PriceChange dollarChange={gain.dollar} percentChange={gain.pct} size="sm" className="shrink-0" />
            ) : (
              <span className="text-xs text-muted-foreground shrink-0">—</span>
            )}
          </Link>
        );
      })}

      {sold.length > 0 ? (
        <div className="flex items-center justify-between border-t border-border pt-2 mt-1">
          <span className="text-sm text-muted-foreground tabular-nums">
            {sold.length} sold · {won} won
          </span>
          <PriceChange dollarChange={realized} percentChange={cost > 0 ? (realized / cost) * 100 : null} size="base" />
        </div>
      ) : null}
    </div>
  );
}

export function PositionCard({ trades, price }: { trades: PositionCardTrade[]; price: number | null }) {
  const [tab, setTab] = useState<number>(POSITION);
  const open = trades.find((t) => t.status === "OPEN") ?? null;
  const proposed = trades.find((t) => t.status === "PENDING_APPROVAL") ?? null;
  // Nothing held: the last trade is what the Position tab shows, so a sold
  // stock still reads as a receipt rather than an empty card.
  const last = open ?? trades.find((t) => t.status === "CLOSED") ?? null;

  return (
    <Card className="bg-muted/40 p-2 gap-1">
      <Tabs value={tab} onValueChange={(v) => setTab(v as number)}>
        <div className="flex items-center justify-between pb-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Position</p>
          <TabsList size="sm">
            <TabsTrigger value={POSITION}>Position</TabsTrigger>
            <TabsTrigger value={HISTORY}>History</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value={POSITION}>
          {last ? (
            <Receipt trade={last} price={price} />
          ) : (
            <p className="text-sm text-muted-foreground">Not held.</p>
          )}
          {!open && proposed ? (
            <Link
              href={`/trades/${proposed.id}`}
              className="mt-2 flex items-center justify-between text-xs text-muted-foreground hover:text-foreground"
            >
              <span>
                <span className="inline-block h-1.5 w-1.5 rounded-full mr-1.5 align-middle bg-amber-500" />
                Buy proposed · {proposed.quantity} sh @ {formatCurrency(proposed.avgCost)}
              </span>
              <span>→</span>
            </Link>
          ) : null}
        </TabsContent>

        <TabsContent value={HISTORY}>
          {trades.length > 0 ? (
            <HistoryRows trades={trades} price={price} />
          ) : (
            <p className="text-sm text-muted-foreground">No trades yet.</p>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}
