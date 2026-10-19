"use client";

/**
 * TradeButton — buy or sell a stock by hand.
 *
 * Sits in the icon strip beside the pin on the thesis sheet, the trade page
 * and the stock page. The icon opens Buy / Sell; either opens one dialog with
 * two steps, the way a broker does it: the order (shares, and for a new
 * holding its stop and target), then a review that says in one sentence what
 * will be sent, to which account, at about what cost. Nothing is sent until
 * "Place order" on the review.
 *
 * The dialog checks the order with the same rules the server checks
 * (`planManualOrder`), so the review never shows an order the server would
 * refuse. The server reads everything again before sending — see
 * lib/trading/manual-order.ts.
 */

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoRow } from "@/components/ui/info-row";
import { PriceChange } from "@/components/ui/price-change";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import { planManualOrder, type TradeLane } from "@/lib/trading/manual-order-rules";
import type { ManualOrderResult, TradeTicket } from "@/lib/trading/manual-order";

type Side = "BUY" | "SELL";
type Step = "form" | "review";

const shareWord = (n: number) => `share${n === 1 ? "" : "s"}`;

function priceAsOf(ticket: TradeTicket): string {
  if (ticket.priceLive) return "Live";
  if (!ticket.priceAt) return "Last price";
  const d = new Date(ticket.priceAt);
  return `Last price, ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export function TradeButton({
  ticker,
  analystId,
  size = "icon-sm",
}: {
  ticker: string;
  /** The analyst this surface belongs to — the dialog starts on its side of the stock. */
  analystId?: string | null;
  size?: "icon-sm" | "icon";
}) {
  const router = useRouter();
  const [ticket, setTicket] = useState<TradeTicket | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Opening the menu and picking Buy/Sell each load the ticket; only the
  // newest load may land, or a slow older one would swap the price under you.
  const loadSeq = useRef(0);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [side, setSide] = useState<Side>("BUY");
  const [laneId, setLaneId] = useState<string | null>(null);
  const [shares, setShares] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function loadTicket(): Promise<TradeTicket | null> {
    const seq = ++loadSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/trade?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const t = (await res.json()) as TradeTicket;
      if (seq !== loadSeq.current) return null;
      setTicket(t);
      return t;
    } catch (err) {
      if (seq === loadSeq.current) setLoadError(err instanceof Error ? err.message : "Couldn't load this stock.");
      return null;
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }

  const canSell = (ticket?.lanes ?? []).some((l) => l.position);
  const lanesFor = (t: TradeTicket | null, s: Side) =>
    (t?.lanes ?? []).filter((l) => (s === "SELL" ? l.position != null : true));

  function pickLane(t: TradeTicket | null, s: Side): TradeLane | null {
    const lanes = lanesFor(t, s);
    return lanes.find((l) => l.analystId === analystId) ?? lanes[0] ?? null;
  }

  function resetFor(lane: TradeLane | null) {
    setLaneId(lane?.analystId ?? null);
    setShares("");
    setStop(lane?.buy.kind === "OPEN" && lane.buy.stopLoss != null ? lane.buy.stopLoss.toFixed(2) : "");
    setTarget(lane?.buy.kind === "OPEN" && lane.buy.targetPrice != null ? lane.buy.targetPrice.toFixed(2) : "");
    setSendError(null);
    setStep("form");
  }

  async function start(s: Side) {
    setSide(s);
    setOpen(true);
    // Always a fresh ticket — the price and what's held can't be a minute old.
    const t = await loadTicket();
    if (t) resetFor(pickLane(t, s));
  }

  function switchSide(s: Side) {
    setSide(s);
    resetFor(pickLane(ticket, s));
  }

  const lanes = lanesFor(ticket, side);
  const lane = lanes.find((l) => l.analystId === laneId) ?? null;
  const price = ticket?.price ?? null;
  const qty = Number(shares);
  const isOpenBuy = side === "BUY" && lane?.buy.kind === "OPEN";

  const plan = useMemo(() => {
    if (!lane || price == null) return null;
    if (shares.trim() === "") return null;
    return planManualOrder(
      lane,
      {
        side,
        shares: qty,
        reviewedPrice: price,
        stopLoss: stop.trim() === "" ? null : Number(stop),
        targetPrice: target.trim() === "" ? null : Number(target),
      },
      price,
      ticket?.priceStale ?? false,
    );
  }, [lane, price, side, qty, shares, stop, target, ticket?.priceStale]);

  const planned = plan?.ok ? plan : null;
  const total = planned && price != null ? planned.shares * price : null;
  const pnl =
    side === "SELL" && planned && lane?.position && price != null
      ? {
          dollar: (price - lane.position.avgCost) * planned.shares,
          pct: ((price - lane.position.avgCost) / lane.position.avgCost) * 100,
        }
      : null;

  const isLive = ticket?.environment === "LIVE";
  const sellsAll = planned?.intent === "CLOSE";
  const sentence = planned
    ? `${side === "BUY" ? "Buy" : "Sell"} ${sellsAll ? "all " : ""}${planned.shares} ${shareWord(planned.shares)} of ${ticker}`
    : "";

  async function place() {
    if (!planned || !lane || price == null || !ticket) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          analystId: lane.analystId,
          side,
          shares: planned.shares,
          reviewedPrice: price,
          environment: ticket.environment,
          ...(isOpenBuy ? { stopLoss: Number(stop), targetPrice: Number(target) } : {}),
        }),
      });
      const result = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as ManualOrderResult;
      if (!result.ok) {
        setSendError(result.error);
        return;
      }
      const done = `${side === "BUY" ? "Buy" : "Sell"} ${result.shares} ${shareWord(result.shares)} of ${ticker} sent to Alpaca`;
      if (result.unconfirmed) {
        toast.warning(`${done}, but Alpaca hasn't confirmed it yet — it'll show up within about 5 minutes.`);
      } else {
        toast.success(ticket.marketOpen ? `${done}.` : `${done}. It fills when the market opens.`);
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Couldn't send the order.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <DropdownMenu
        onOpenChange={(o) => {
          if (o) void loadTicket();
        }}
      >
        <DropdownMenuTrigger
          render={<Button variant="ghost" size={size} aria-label={`Trade ${ticker}`} title={`Trade ${ticker}`} />}
        >
          <ArrowRightLeft />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => void start("BUY")}>Buy {ticker}</DropdownMenuItem>
          <DropdownMenuItem disabled={!canSell} onClick={() => void start("SELL")}>
            Sell {ticker}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={sending ? undefined : setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{step === "review" ? "Review order" : `Trade ${ticker}`}</DialogTitle>
            <DialogDescription>
              {step === "review"
                ? "Check it over. Nothing is sent until you place it."
                : "A market order, sent to Alpaca when you place it."}
            </DialogDescription>
          </DialogHeader>

          {loading || !ticket ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              {loadError ? (
                <span className="text-destructive">{loadError}</span>
              ) : (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Getting the price…
                </>
              )}
            </div>
          ) : step === "form" ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between gap-2">
                <Tabs value={side} onValueChange={(v) => switchSide(v as Side)}>
                  <TabsList>
                    <TabsTrigger value="BUY">Buy</TabsTrigger>
                    <TabsTrigger value="SELL" disabled={!canSell}>
                      Sell
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <Badge variant={isLive ? "default" : "secondary"}>
                  {isLive ? "Live account — real money" : "Paper account"}
                </Badge>
              </div>

              {lanes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {side === "SELL"
                    ? `You hold no ${ticker} on this account.`
                    : `No analyst holds or watches ${ticker} with a long thesis. Add it to an analyst's watchlist, then buy it here.`}
                </p>
              ) : (
                <>
                  <div>
                    {lanes.length > 1 ? (
                      <InfoRow label="Analyst">
                        <Select value={laneId} onValueChange={(v) => v && resetFor(lanes.find((l) => l.analystId === v) ?? null)}>
                          <SelectTrigger size="sm">
                            <SelectValue>{lane?.analystName}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {lanes.map((l) => (
                              <SelectItem key={l.analystId} value={l.analystId}>
                                {l.analystName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </InfoRow>
                    ) : (
                      <InfoRow label="Analyst" value={lane?.analystName} />
                    )}
                    <InfoRow
                      label="Market price"
                      mono
                      value={price != null ? `$${price.toFixed(2)}` : "—"}
                      description={priceAsOf(ticket)}
                    />
                    {lane?.position ? (
                      <InfoRow
                        label="You own"
                        mono
                        value={`${lane.position.shares} ${shareWord(lane.position.shares)} · avg $${lane.position.avgCost.toFixed(2)}`}
                      />
                    ) : null}
                  </div>

                  {side === "BUY" && lane?.buy.kind === "NONE" ? (
                    <p className="text-sm text-muted-foreground">{lane.buy.reason}</p>
                  ) : (
                    <div className="grid gap-3">
                      <div className="grid gap-1.5">
                        <Label htmlFor="trade-shares">Shares</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="trade-shares"
                            type="number"
                            inputMode="numeric"
                            min={1}
                            step={1}
                            value={shares}
                            onChange={(e) => setShares(e.target.value)}
                            autoFocus
                          />
                          {side === "SELL" && lane?.position ? (
                            <Button variant="outline" onClick={() => setShares(String(lane.position!.shares))}>
                              All
                            </Button>
                          ) : null}
                        </div>
                        {side === "BUY" && lane?.buy.kind === "ADD" ? (
                          <p className="text-xs text-muted-foreground">
                            Up to {lane.buy.maxShares} more {shareWord(lane.buy.maxShares)} fit {lane.analystName}&apos;s
                            most in one stock ({formatCurrency(lane.buy.cap)}).
                          </p>
                        ) : null}
                      </div>
                      {isOpenBuy ? (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="grid gap-1.5">
                            <Label htmlFor="trade-stop">Stop</Label>
                            <Input
                              id="trade-stop"
                              type="number"
                              inputMode="decimal"
                              value={stop}
                              onChange={(e) => setStop(e.target.value)}
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="trade-target">Target</Label>
                            <Input
                              id="trade-target"
                              type="number"
                              inputMode="decimal"
                              value={target}
                              onChange={(e) => setTarget(e.target.value)}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {planned && total != null ? (
                    <div>
                      <InfoRow
                        label={side === "BUY" ? "Estimated cost" : "Estimated proceeds"}
                        mono
                        value={formatCurrency(total)}
                      />
                      {pnl ? (
                        <InfoRow label="Gain on these shares">
                          <PriceChange dollarChange={pnl.dollar} percentChange={pnl.pct} size="sm" />
                        </InfoRow>
                      ) : null}
                    </div>
                  ) : null}

                  {plan && !plan.ok ? <p className="text-xs text-destructive">{plan.error}</p> : null}
                  {!ticket.marketOpen ? (
                    <p className="text-xs text-muted-foreground">
                      The market is closed. The order waits at Alpaca and fills at the next open, at that price.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <div className="grid gap-4">
              <p className="text-lg font-medium">{sentence}</p>
              <div>
                <InfoRow label="Account" value={isLive ? "Live — real money" : "Paper"} />
                <InfoRow label="Analyst" value={lane?.analystName} />
                <InfoRow label="Order type" value="Market" />
                <InfoRow label="Shares" mono value={planned?.shares} />
                <InfoRow label="Estimated price" mono value={price != null ? `$${price.toFixed(2)}` : "—"} />
                <InfoRow
                  label={side === "BUY" ? "Estimated cost" : "Estimated proceeds"}
                  mono
                  value={total != null ? formatCurrency(total) : "—"}
                />
                {isOpenBuy ? (
                  <>
                    <InfoRow label="Stop" mono value={`$${Number(stop).toFixed(2)}`} />
                    <InfoRow label="Target" mono value={`$${Number(target).toFixed(2)}`} />
                  </>
                ) : null}
                {pnl ? (
                  <InfoRow label="Gain on these shares">
                    <PriceChange dollarChange={pnl.dollar} percentChange={pnl.pct} size="sm" />
                  </InfoRow>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                A market order fills at the next available price, which can differ from this estimate.
                {!ticket.marketOpen ? " The market is closed, so it fills when it opens." : ""}
                {" "}If the price moves more than 2% before you place it, you&apos;ll be asked to review again.
              </p>
              {sendError ? <p className="text-xs text-destructive">{sendError}</p> : null}
            </div>
          )}

          <DialogFooter>
            {step === "review" ? (
              <>
                <Button variant="outline" onClick={() => setStep("form")} disabled={sending}>
                  Back
                </Button>
                <Button onClick={() => void place()} disabled={sending || !planned}>
                  {sending ? <Loader2 className="animate-spin" /> : null}
                  {sending ? "Sending…" : side === "BUY" ? "Place buy order" : "Place sell order"}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setStep("review")} disabled={!planned}>
                  Review order
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
