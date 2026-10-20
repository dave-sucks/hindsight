"use client";

/**
 * TradeButton — buy or sell a stock by hand.
 *
 * Sits in the icon strip beside the pin on the thesis sheet, the trade page
 * and the stock page. One click opens a dialog with two steps, the way a
 * broker does it: the order (Buy or Sell, the analyst, shares, and for a new
 * holding its stop and target), then a review that says in one sentence what
 * will be sent, to which account, at about what cost. Nothing is sent until
 * "Place order" on the review. Any analyst can buy any stock: one that isn't
 * on its watchlist goes on it, and one with no research gets the writer.
 *
 * The dialog checks the order with the same rules the server checks
 * (`planManualOrder`), so the review never shows an order the server would
 * refuse. The server reads everything again before sending — see
 * lib/trading/manual-order.ts.
 */

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HugeiconsIcon } from "@hugeicons/react";
import { MoneySendFlow02Icon } from "@hugeicons/core-free-icons";
import { EnvDot } from "@/components/settings/EnvironmentSwitcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoRow } from "@/components/ui/info-row";
import { PriceChange } from "@/components/ui/price-change";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { planManualOrder, type TradeLane } from "@/lib/trading/manual-order-rules";
import type { ManualOrderResult, TradeTicket } from "@/lib/trading/manual-order";

type Side = "BUY" | "SELL";
type Step = "form" | "review";

const shareWord = (n: number) => `share${n === 1 ? "" : "s"}`;

/** A level on the review: the one typed, else the thesis's own, else the analyst's to set. */
function levelLine(typed: string, thesis: number | null): string {
  if (typed.trim()) return `$${Number(typed).toFixed(2)}`;
  return thesis != null ? `$${thesis.toFixed(2)} (the thesis's)` : "Set by the analyst";
}

/** Said only when the price isn't from the open market right now. */
function priceAsOf(ticket: TradeTicket): string | null {
  if (ticket.priceLive || !ticket.priceAt) return null;
  const d = new Date(ticket.priceAt);
  return `last price ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
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
  // Only the newest load may land, or a slow older one would swap the price
  // under you.
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
  // Stop and target sit behind "Price targets", closed until asked for.
  const [levelsOpen, setLevelsOpen] = useState(false);

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

  // This surface's analyst, else one that holds it, else one that can buy it.
  function pickLane(t: TradeTicket | null, s: Side): TradeLane | null {
    const lanes = lanesFor(t, s);
    return (
      lanes.find((l) => l.analystId === analystId) ??
      lanes.find((l) => l.position) ??
      lanes.find((l) => l.buy.kind !== "NONE") ??
      lanes[0] ??
      null
    );
  }

  function resetFor(lane: TradeLane | null) {
    setLaneId(lane?.analystId ?? null);
    setShares("");
    setStop(lane?.buy.kind === "OPEN" && lane.buy.stopLoss != null ? lane.buy.stopLoss.toFixed(2) : "");
    setTarget(lane?.buy.kind === "OPEN" && lane.buy.targetPrice != null ? lane.buy.targetPrice.toFixed(2) : "");
    setSendError(null);
    setLevelsOpen(false);
    setStep("form");
  }

  async function start(s: Side) {
    setSide(s);
    setTicket(null);
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
  // What a buy for this analyst does besides buying — said before and on review.
  const openNote =
    isOpenBuy && lane?.buy.kind === "OPEN"
      ? lane.buy.thesisId == null
        ? `${ticker} isn't on ${lane.analystName}'s watchlist. Buying adds it, and the writer researches it right after the buy.`
        : lane.buy.needsResearch
          ? `${lane.analystName} hasn't researched ${ticker} yet. The writer researches it right after the buy.`
          : null
      : null;

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
      { price, stale: ticket?.priceStale ?? false, cash: ticket?.cash ?? null },
    );
  }, [lane, price, side, qty, shares, stop, target, ticket?.priceStale, ticket?.cash]);

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
  // A new holding with no stop typed and none on its thesis: unprotected until the writer lands.
  const noFloorYet = isOpenBuy && lane?.buy.kind === "OPEN" && !stop.trim() && lane.buy.stopLoss == null;
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
          ...(isOpenBuy
            ? {
                stopLoss: stop.trim() ? Number(stop) : null,
                targetPrice: target.trim() ? Number(target) : null,
              }
            : {}),
        }),
      });
      const result = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as ManualOrderResult;
      if (!result.ok) {
        setSendError(result.error);
        return;
      }
      const done = `${side === "BUY" ? "Buy" : "Sell"} ${result.shares} ${shareWord(result.shares)} of ${ticker} sent to Alpaca`;
      const research = result.researchStarted ? ` ${lane.analystName} is writing its plan now.` : "";
      if (result.unconfirmed) {
        toast.warning(`${done}, but Alpaca hasn't confirmed it yet — it'll show up within about 5 minutes.${research}`);
      } else {
        toast.success(`${done}.${ticket.marketOpen ? "" : " It fills when the market opens."}${research}`);
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
      <Button
        variant="ghost"
        size={size}
        aria-label={`Trade ${ticker}`}
        title={`Trade ${ticker}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void start("BUY");
        }}
      >
        <HugeiconsIcon icon={MoneySendFlow02Icon} />
      </Button>

      <Dialog open={open} onOpenChange={sending ? undefined : setOpen}>
        <DialogContent aria-label={step === "review" ? `Review the ${ticker} order` : `Trade ${ticker}`}>

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
              <Tabs value={side} onValueChange={(v) => switchSide(v as Side)}>
                <TabsList>
                  <TabsTrigger value="BUY">Buy</TabsTrigger>
                  <TabsTrigger value="SELL" disabled={!canSell}>
                    Sell
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {lanes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {side === "SELL"
                    ? `You hold no ${ticker} on this account.`
                    : "There are no analysts on this account yet."}
                </p>
              ) : (
                <>
                  <div className="grid gap-1.5">
                    <Select value={laneId} onValueChange={(v) => v && resetFor(lanes.find((l) => l.analystId === v) ?? null)}>
                      <SelectTrigger width="full" aria-label="Analyst">
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
                    {openNote ? <p className="text-xs text-muted-foreground">{openNote}</p> : null}
                  </div>

                  {side === "BUY" && lane?.buy.kind === "NONE" ? (
                    <p className="text-sm text-muted-foreground">{lane.buy.reason}</p>
                  ) : (
                    <div className="grid gap-1.5">
                      <div>
                        {lane?.position ? (
                          <InfoRow
                            label="You own"
                            mono
                            value={`${lane.position.shares} ${shareWord(lane.position.shares)} · avg $${lane.position.avgCost.toFixed(2)}`}
                          />
                        ) : null}
                        <InfoRow label={<label htmlFor="trade-shares" className="font-medium">Shares</label>}>
                          <div className="flex items-center gap-2 py-1">
                            {side === "SELL" && lane?.position ? (
                              <Button variant="outline" size="sm" onClick={() => setShares(String(lane.position!.shares))}>
                                All
                              </Button>
                            ) : null}
                            <div className="w-28">
                              <Input
                                id="trade-shares"
                                type="number"
                                inputMode="numeric"
                                min={1}
                                step={1}
                                placeholder="0"
                                value={shares}
                                onChange={(e) => setShares(e.target.value)}
                                autoFocus
                              />
                            </div>
                          </div>
                        </InfoRow>
                        <InfoRow
                          label={
                            <span className="font-medium">
                              {side === "BUY" ? "Cost" : "Proceeds"}
                              {price != null ? ` (${formatCurrency(price)} per share)` : ""}
                            </span>
                          }
                          mono
                          value={price != null && qty > 0 && Number.isFinite(qty) ? formatCurrency(qty * price) : "—"}
                          border={pnl != null}
                        />
                        {pnl ? (
                          <InfoRow label="Gain on these shares" border={false}>
                            <PriceChange dollarChange={pnl.dollar} percentChange={pnl.pct} size="sm" />
                          </InfoRow>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {isLive ? "Live account" : "Paper account"}
                        {ticket.cash != null ? ` · ${formatCurrency(ticket.cash)} cash` : ""}
                      </p>
                      {side === "BUY" && lane?.buy.kind === "ADD" ? (
                        <p className="text-xs text-muted-foreground">
                          Up to {lane.buy.maxShares} more {shareWord(lane.buy.maxShares)} fit {lane.analystName}&apos;s
                          most in one stock ({formatCurrency(lane.buy.cap)}).
                        </p>
                      ) : null}
                    </div>
                  )}

                  {isOpenBuy ? (
                    <Collapsible open={levelsOpen} onOpenChange={setLevelsOpen} className="border-y">
                      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm font-medium outline-none focus-visible:underline">
                        <span>
                          Price targets
                          {!levelsOpen && (stop.trim() || target.trim()) ? (
                            <span className="font-normal text-muted-foreground tabular-nums">
                              {" · "}
                              {[stop.trim() && `stop $${stop.trim()}`, target.trim() && `target $${target.trim()}`].filter(Boolean).join(", ")}
                            </span>
                          ) : null}
                        </span>
                        <ChevronDown
                          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", levelsOpen && "rotate-180")}
                        />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pb-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="grid gap-1.5">
                            <Label htmlFor="trade-stop">Stop (optional)</Label>
                            <Input
                              id="trade-stop"
                              type="number"
                              inputMode="decimal"
                              value={stop}
                              onChange={(e) => setStop(e.target.value)}
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <Label htmlFor="trade-target">Target (optional)</Label>
                            <Input
                              id="trade-target"
                              type="number"
                              inputMode="decimal"
                              value={target}
                              onChange={(e) => setTarget(e.target.value)}
                            />
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ) : null}

                  {plan && !plan.ok ? <p className="text-xs text-destructive">{plan.error}</p> : null}
                  {!ticket.marketOpen ? (
                    <p className="text-xs text-muted-foreground">
                      The market is closed{priceAsOf(ticket) ? ` (${priceAsOf(ticket)})` : ""}. The order waits at
                      Alpaca and fills at the next open, at that price.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <div className="grid gap-4">
              <p className="text-lg font-medium">{sentence}</p>
              {openNote ? <p className="text-xs text-muted-foreground">{openNote}</p> : null}
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
                    <InfoRow label="Stop" mono value={levelLine(stop, lane?.buy.kind === "OPEN" ? lane.buy.stopLoss : null)} />
                    <InfoRow label="Target" mono value={levelLine(target, lane?.buy.kind === "OPEN" ? lane.buy.targetPrice : null)} />
                  </>
                ) : null}
                {pnl ? (
                  <InfoRow label="Gain on these shares">
                    <PriceChange dollarChange={pnl.dollar} percentChange={pnl.pct} size="sm" />
                  </InfoRow>
                ) : null}
              </div>
              {noFloorYet ? (
                <p className="text-sm text-muted-foreground">No floor yet — the analyst sets it right after the buy.</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                A market order fills at the next available price, which can differ from this estimate.
                {!ticket.marketOpen ? " The market is closed, so it fills when it opens." : ""}
                {" "}If the price moves more than 2% before you place it, you&apos;ll be asked to review again.
              </p>
              {sendError ? <p className="text-xs text-destructive">{sendError}</p> : null}
            </div>
          )}

          <DialogFooter>
            {/* Which account this order goes to, the switcher's dot and word. */}
            {ticket ? (
              <span className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
                <EnvDot env={ticket.environment} />
                {isLive ? "Live" : "Paper"}
              </span>
            ) : null}
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
