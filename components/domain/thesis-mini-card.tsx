"use client";

/**
 * ThesisMiniCard — compact thesis card for the agent chat carousel.
 *
 * Mirrors the data hierarchy of the open ThesisSheet so the carousel and
 * the sheet read as one design system:
 *
 *   • header  — logo + name + ticker + status pill
 *   • prices  — Entry · Target · Stop on one compact line (just the
 *               values; no derived %-from-entry deltas — the sheet's
 *               Price Targets gauge owns the visual that already)
 *   • body    — core_belief (the standing claim). Falls back to
 *               reasoning_summary on legacy theses without coreBelief.
 *   • badge   — composite score with the same tier palette as the
 *               sheet (green ≥7, gray 4-7, red <4)
 *
 * Click opens the same <ThesisSheet> as every other entry point.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { StockLogo } from "@/components/StockLogo";
import { ThesisSheet, type ThesisCardData } from "@/components/agent/sheets/ThesisSheet";
import { getThesisStatusDisplay } from "@/lib/thesis-status";

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Composite badge variant — matches the Composite Score header on the
 * sheet (Strong Buy / Hold / Sell palette) so the conviction read is
 * identical across surfaces. confidence_score on ThesisCardData is the
 * 0-100 legacy scale = composite × 10, so we divide back out for display.
 */
function compositeVariant(
  scoreOutOf10: number,
): "positive" | "secondary" | "negative" {
  if (scoreOutOf10 >= 7) return "positive";
  if (scoreOutOf10 >= 4) return "secondary";
  return "negative";
}

// ── Card ────────────────────────────────────────────────────────────────────

export function ThesisMiniCard({ thesis }: { thesis: ThesisCardData }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const statusDisplay = getThesisStatusDisplay(thesis.status);

  const isPass = thesis.direction === "PASS";
  const hasEntry = thesis.entry_price != null;
  const hasTarget = thesis.target_price != null;
  const hasStop = thesis.stop_loss != null;
  const hasAnyPrice = hasEntry || hasTarget || hasStop;

  const compositeOutOf10 =
    thesis.confidence_score > 0
      ? Math.round((thesis.confidence_score / 10) * 10) / 10
      : null;

  // Body text — prefer the durable core_belief over the current-state
  // reasoning_summary. PASS theses use pass_reason as a fallback because
  // they don't carry a coreBelief.
  const body =
    thesis.core_belief?.trim()
      ? thesis.core_belief
      : isPass && thesis.pass_reason
        ? thesis.pass_reason
        : thesis.reasoning_summary;

  return (
    <>
      <Card
        onClick={() => setSheetOpen(true)}
        className="p-3 gap-2.5 cursor-pointer hover:bg-accent/40 transition-colors h-full text-left"
      >
        {/* ── Header: logo + name + status pill ───────────────────── */}
        <div className="flex items-center gap-2">
          <StockLogo ticker={thesis.ticker} size="sm" />
          <span className="text-sm font-semibold truncate">
            {thesis.company_name ?? thesis.ticker}
          </span>
          <Badge
            variant="secondary"
            className="ml-auto font-normal shrink-0 gap-1.5"
          >
            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", statusDisplay.dotClass)} />
            {statusDisplay.label}
          </Badge>
        </div>

        {/* ── Prices row ──────────────────────────────────────────── */}
        {/* One compact line with just the levels — no %-from-entry
            deltas (the sheet's Price Targets gauge owns that). PASS
            theses typically only have entry_price set; that's fine, the
            row collapses to the cells that have values. */}
        {hasAnyPrice && (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
            {hasEntry && (
              <span className="inline-flex items-baseline gap-1">
                <span className="text-muted-foreground">Entry</span>
                <span className="font-medium tabular-nums">
                  {fmtPrice(thesis.entry_price)}
                </span>
              </span>
            )}
            {hasTarget && (
              <span className="inline-flex items-baseline gap-1">
                <span className="text-muted-foreground">Target</span>
                <span className="font-medium tabular-nums text-positive">
                  {fmtPrice(thesis.target_price)}
                </span>
              </span>
            )}
            {hasStop && (
              <span className="inline-flex items-baseline gap-1">
                <span className="text-muted-foreground">Stop</span>
                <span className="font-medium tabular-nums text-negative">
                  {fmtPrice(thesis.stop_loss)}
                </span>
              </span>
            )}
          </div>
        )}

        {/* ── Body: core belief (or fallback) ─────────────────────── */}
        {body && (
          <p className="text-sm text-foreground line-clamp-3 leading-snug">
            {body}
          </p>
        )}

        {/* ── Footer: composite badge ─────────────────────────────── */}
        {compositeOutOf10 != null && (
          <div className="flex items-center justify-end pt-0.5">
            <Badge
              variant={compositeVariant(compositeOutOf10)}
              className="font-normal tabular-nums"
            >
              {compositeOutOf10}/10
            </Badge>
          </div>
        )}
      </Card>

      <ThesisSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        {...thesis}
      />
    </>
  );
}
