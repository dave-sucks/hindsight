"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { createTrade } from "@/lib/actions/trade.actions";
import { cn } from "@/lib/utils";
import { Loader2, TrendingUp, TrendingDown } from "lucide-react";

// Works with both real Thesis (from Prisma) and mock data
export interface TradeSheetThesis {
  id: string;
  ticker: string;
  direction: string;          // "LONG" | "SHORT"
  entryPrice?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  confidenceScore: number;
  holdDuration: string;
}

interface TradeReviewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  thesis: TradeSheetThesis;
}

const EXIT_STRATEGIES = [
  { value: "PRICE_TARGET", label: "Price Target" },
  { value: "TIME_BASED", label: "Time Based" },
  { value: "TRAILING", label: "Trailing Stop" },
  { value: "MANUAL", label: "Manual" },
] as const;

type ExitStrategy = (typeof EXIT_STRATEGIES)[number]["value"];

export function TradeReviewSheet({
  open,
  onOpenChange,
  thesis,
}: TradeReviewSheetProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entryPrice = thesis.entryPrice ?? 100;
  const targetPrice = thesis.targetPrice ?? entryPrice * 1.08;
  const stopPrice = thesis.stopLoss ?? entryPrice * 0.96;

  // Default shares: $500 position size / entry price
  const defaultShares = Math.max(1, Math.floor(500 / entryPrice));

  const [shares, setShares] = useState(defaultShares);
  const [exitStrategy, setExitStrategy] = useState<ExitStrategy>("PRICE_TARGET");
  const [notes, setNotes] = useState("");

  const isLong = thesis.direction === "LONG";
  const positionValue = shares * entryPrice;
  const potentialPnl = isLong
    ? (targetPrice - entryPrice) * shares
    : (entryPrice - targetPrice) * shares;
  const maxLoss = isLong
    ? (entryPrice - stopPrice) * shares
    : (stopPrice - entryPrice) * shares;

  const targetPct = ((targetPrice - entryPrice) / entryPrice) * 100;
  const stopPct = ((stopPrice - entryPrice) / entryPrice) * 100;
  const rrRatio = Math.abs(potentialPnl) / Math.abs(maxLoss || 1);

  async function handleConfirm() {
    setError(null);
    setLoading(true);
    try {
      const result = await createTrade({
        thesisId: thesis.id,
        ticker: thesis.ticker,
        direction: thesis.direction as "LONG" | "SHORT",
        entryPrice,
        shares,
        targetPrice,
        stopLoss: stopPrice,
        exitStrategy,
        notes: notes || undefined,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      onOpenChange(false);
      router.push(`/trades/${result.tradeId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[480px] overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full",
                isLong
                  ? "bg-positive/10 text-positive"
                  : "bg-negative/10 text-negative"
              )}
            >
              {isLong ? (
                <TrendingUp className="h-5 w-5" />
              ) : (
                <TrendingDown className="h-5 w-5" />
              )}
            </div>
            <div>
              <SheetTitle className="text-lg font-semibold">
                Review Paper Trade
              </SheetTitle>
              <SheetDescription className="text-sm text-muted-foreground">
                {thesis.ticker} · {thesis.direction} · {thesis.holdDuration}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-5">
          {/* Price levels */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "ENTRY", value: entryPrice, pct: null, className: "" },
              {
                label: "TARGET",
                value: targetPrice,
                pct: targetPct,
                className: "text-positive",
              },
              {
                label: "STOP",
                value: stopPrice,
                pct: stopPct,
                className: "text-negative",
              },
            ].map(({ label, value, pct, className }) => (
              <div
                key={label}
                className="rounded-lg border bg-card p-3 space-y-1"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                </p>
                <p className={cn("text-sm font-semibold tabular-nums", className)}>
                  ${value.toFixed(2)}
                </p>
                {pct !== null && (
                  <p className={cn("text-xs tabular-nums", className)}>
                    {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                  </p>
                )}
              </div>
            ))}
          </div>

          <Separator />

          {/* Shares input */}
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Shares
            </label>
            <input
              type="number"
              min={1}
              value={shares}
              onChange={(e) =>
                setShares(Math.max(1, parseInt(e.target.value) || 1))
              }
              className="w-full rounded-md border bg-background px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Position value:{" "}
              <span className="tabular-nums font-medium text-foreground">
                ${positionValue.toFixed(2)}
              </span>
            </p>
          </div>

          {/* Exit strategy */}
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Exit Strategy
            </label>
            <div className="flex flex-wrap gap-2">
              {EXIT_STRATEGIES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setExitStrategy(s.value)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    exitStrategy === s.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {exitStrategy === "TRAILING" && (
              <p className="text-xs text-muted-foreground">
                Trail 5% from peak — auto-closes if price drops 5% from highest point
              </p>
            )}
            {exitStrategy === "TIME_BASED" && (
              <p className="text-xs text-muted-foreground">
                Closes automatically at end of hold duration
              </p>
            )}
          </div>

          {/* P&L preview */}
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              P&L Preview
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">
                  Potential gain
                </p>
                <p className="text-sm font-semibold tabular-nums text-positive">
                  +${Math.abs(potentialPnl).toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Max loss</p>
                <p className="text-sm font-semibold tabular-nums text-negative">
                  -${Math.abs(maxLoss).toFixed(2)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">R:R ratio</p>
              <Badge variant="secondary" className="text-xs tabular-nums">
                {rrRatio.toFixed(2)}x
              </Badge>
              <Badge variant="secondary" className="text-xs tabular-nums">
                Confidence: {thesis.confidenceScore}%
              </Badge>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Why are you taking this trade?"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
        </div>

        <SheetFooter className="mt-6 flex-col gap-2 sm:flex-col">
          <Button
            onClick={handleConfirm}
            disabled={loading}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Placing order…
              </>
            ) : (
              `Confirm Paper Trade · ${thesis.ticker} ${thesis.direction}`
            )}
          </Button>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="w-full"
          >
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
