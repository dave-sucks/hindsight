"use client";

import { useState } from "react";
import { StockLogo } from "@/components/StockLogo";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { PnlArrow } from "@/components/ui/pnl-arrow";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Favicon } from "@/components/intelligence/signal-feed";
import { getTradeStatusDisplay } from "@/lib/trade-status";
import type { TradeStatus } from "@/lib/mock-data/trades";
import { ThesisSheet } from "@/components/agent/sheets/ThesisSheet";
import type { TriggersResponse } from "@/components/agent/sheets/ThesisTriggersSection";
import { holdDurationFromHorizon } from "@/lib/agent/horizon-policy";

// 2026-04-29: removed inline expand-on-click and analyst-link button.
// The Details button opens the full ThesisSheet which has more
// detailed thesis info than the inline expansion ever did, and the
// analyst link clutters the row footer for a single-user app where
// the user already knows their analysts.

// ── Types ────────────────────────────────────────────────────────────────────

type SourceItem = { type: string; provider: string; title: string; url?: string | null };

export interface ThesisRowData {
  id: string;
  ticker: string;
  direction: string;
  confidenceScore: number;
  reasoningSummary: string;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  /**
   * Trade horizon (CATALYST / TRADE / TARGET / COMPOUNDER). Drives the
   * derived hold-duration label rendered on the card. Optional only because
   * legacy rows from before the Durable State migration may not have it.
   */
  horizon?: string | null;
  /**
   * Legacy hold-duration column. Deprecated in favor of `horizon` →
   * `holdDurationFromHorizon()`. Kept on the type only to support rows
   * pulled before PR-4. Drops with the column in PR-5.
   */
  holdDuration?: string;
  createdAt?: string | null;
  analystName?: string | null;
  analystId?: string | null;
  runId?: string | null;
  currentPrice?: number | null;
  priceChange?: { amount: number; percent: number } | null;
  companyName?: string | null;
  decision?: string | null;
  sourcesUsed?: unknown;
  /**
   * Legacy bullet/risk strings rendered as Bullish/Bearish View in the
   * sheet. Renamed + retyped to bullCase/bearCase in PR-9; passed through
   * here so the sheet can render them on open without a /triggers fetch.
   */
  thesisBullets?: string[];
  riskFlags?: string[];
  /**
   * Pre-fetched durable-state snapshot to seed ThesisSheet on open (P2-19).
   * Shape matches the `/api/theses/[id]/triggers` response so the sheet
   * can render status / belief / scoring / sources / research synthesis
   * synchronously instead of skeletons-then-fetch. The sheet still fires
   * /triggers in the background to pick up live trigger fires + position
   * changes. Omit on rows that don't have the data forwarded yet — the
   * sheet falls back to its async fetch path.
   */
  sheetState?: TriggersResponse;
  position?: {
    id: string;
    status: string;
    tradeStatus?: TradeStatus; // derived from order fill state; undefined = legacy/unknown
    avgCost: number;
    quantity?: number | null;
    closePrice?: number | null;
    realizedPnl?: number | null;
    openedAt?: string | null;
    filledAt?: string | null;
    placedAt?: string | null;
  } | null;
}

interface ThesisRowProps {
  thesis: ThesisRowData;
  showTicker?: boolean;
}

// ── Formatting helpers ──────────────────────────────────────────────────────

const $ = (n: number) => `$${n.toFixed(2)}`;
const $k = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${Math.abs(n).toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)}%`;
const pnlCls = (v: number) => v >= 0 ? "text-positive" : "text-negative";
const PctArrow = ({ value }: { value: number }) => (
  <span className={cn("inline-flex items-center gap-0.5 tabular-nums", pnlCls(value))}>
    {value >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
    {pct(value)}
  </span>
);


function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function parseSources(raw: unknown): SourceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is SourceItem => s != null && typeof s === "object" && "title" in s);
}

function domain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// ── Consensus / Position helpers ────────────────────────────────────────────

function consensus(dir: string, conf: number): { label: string; isStrong: boolean } {
  if (dir === "PASS") return { label: "Pass", isStrong: false };
  const isBuy = dir === "LONG";
  if (conf >= 80) return { label: isBuy ? "Strong Buy" : "Strong Sell", isStrong: true };
  if (conf >= 60) return { label: isBuy ? "Buy" : "Sell", isStrong: false };
  return { label: isBuy ? "Lean Buy" : "Lean Sell", isStrong: false };
}


function posBg(ts: TradeStatus): string {
  if (ts === "OPEN" || ts === "CLOSED_WIN") return "bg-positive/10";
  if (ts === "CLOSED_LOSS") return "bg-negative/10";
  return "bg-muted/30";
}

// ── Component ────────────────────────────────────────────────────────────────

export function ThesisRow({ thesis: t, showTicker = true }: ThesisRowProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const pos = t.position;
  const isPass = t.direction === "PASS";
  const isBull = t.direction === "LONG";
  const con = consensus(t.direction, t.confidenceScore);
  const sources = parseSources(t.sourcesUsed);

  const deltaPct = t.priceChange?.percent
    ?? (t.currentPrice && t.entryPrice && t.entryPrice > 0 ? ((t.currentPrice - t.entryPrice) / t.entryPrice) * 100 : null);

  const pnlPct = pos
    ? pos.realizedPnl != null && pos.avgCost > 0 && pos.quantity
      ? (pos.realizedPnl / (pos.avgCost * pos.quantity)) * 100
      : t.currentPrice != null && pos.avgCost > 0
        ? ((t.currentPrice - pos.avgCost) / pos.avgCost) * 100
        : null
    : null;

  const mktVal = pos && t.currentPrice && pos.quantity ? t.currentPrice * pos.quantity : null;

  const upsidePct = !isPass && t.targetPrice && t.targetPrice > 0 && t.entryPrice && t.entryPrice > 0
    ? ((t.targetPrice - t.entryPrice) / t.entryPrice) * 100
    : null;

  return (
    <div className="rounded-xl border bg-background overflow-hidden">

      {/* ── 1. Position row ── */}
      {pos && (() => {
        // Use tradeStatus when available (wired from order fill state).
        // Fall back to deriving from avgCost for legacy/incomplete data.
        const ts: TradeStatus = pos.tradeStatus ?? (pos.avgCost === 0 ? "PENDING" : "OPEN");
        const cfg = getTradeStatusDisplay(ts);
        const isPending = ts === "PENDING";
        return (
          <div className={cn("px-4 py-2.5 border-b", posBg(ts))}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border border-border text-muted-foreground cursor-default shrink-0">
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dotClass)} />
                {cfg.label}
              </span>
              <span className="text-sm">
                {pos.quantity && <>{pos.quantity} shares{!isPending && <> @ </>}</>}
                {!isPending && pos.avgCost > 0 && (
                  <span className="tabular-nums font-medium">{$(pos.avgCost)}</span>
                )}
                {t.targetPrice && t.targetPrice > 0 && <>, targeting <span className="tabular-nums font-medium">{$(t.targetPrice)}</span></>}
              </span>
              <div className="flex items-center gap-2 ml-auto">
                {!isPending && mktVal != null && (
                  <Tooltip>
                    <TooltipTrigger render={<span className="text-sm tabular-nums font-medium cursor-default">{$k(mktVal)}</span>} />
                    <TooltipContent side="bottom">Current market value of {pos.quantity ?? 0} shares at {$(t.currentPrice ?? 0)}</TooltipContent>
                  </Tooltip>
                )}
                {!isPending && pnlPct != null && <PnlBadge value={pnlPct} />}
              </div>
            </div>
            {!isPending && t.stopLoss && t.stopLoss > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">Stop at <span className="tabular-nums">{$(t.stopLoss)}</span></p>
            )}
          </div>
        );
      })()}

      {/* ── 2. Stock row ── */}
      {showTicker && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b">
          <StockLogo ticker={t.ticker} size="md" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{t.companyName ?? t.ticker}</p>
            {t.companyName && <p className="font-mono text-[11px] text-muted-foreground">{t.ticker}</p>}
          </div>
          <div className="flex items-center gap-2">
            {t.currentPrice != null && <span className="text-base tabular-nums">{$(t.currentPrice)}</span>}
            {deltaPct != null && <PctArrow value={deltaPct} />}
          </div>
        </div>
      )}

      {/* ── 3. Analysis + Summary ── */}
      <div className="px-4 py-3">
        {/* Analysis line */}
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap text-sm">
          {isPass
            ? <span className="size-2 rounded-full bg-muted-foreground/40 shrink-0" />
            : con.isStrong
              ? <PnlArrow direction={isBull ? "up" : "down"} className="h-4 w-4 shrink-0" />
              : <span className={cn("size-2 rounded-full shrink-0", isBull ? "bg-positive" : "bg-negative")} />
          }
          <Tooltip>
            <TooltipTrigger render={<span className="font-medium cursor-default">{con.label}</span>} />
            <TooltipContent side="bottom" className="max-w-xs text-xs">
              {con.label} — {t.confidenceScore}% confidence based on signal quality, data consistency, and directional conviction.
            </TooltipContent>
          </Tooltip>
          {!isPass && t.targetPrice && t.targetPrice > 0 && (
            <>
              <span>Price target: <span className="tabular-nums font-medium">{$(t.targetPrice)}</span></span>
              {upsidePct != null && <PctArrow value={upsidePct} />}
              {t.entryPrice && t.entryPrice > 0 && <span>from <span className="tabular-nums">{$(t.entryPrice)}</span></span>}
            </>
          )}
          {isPass && t.entryPrice && t.entryPrice > 0 && (
            <span className="text-muted-foreground tabular-nums">at {$(t.entryPrice)}</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
          {t.reasoningSummary}
        </p>
      </div>

      {/* ── 4. Footer ── */}
      <div className="px-4 py-2 flex items-center gap-2">
        {sources.length > 0 && (
          <div className="flex items-center gap-1">
            <div className="flex -space-x-1">
              {sources.slice(0, 4).map((s, i) => {
                const d = s.url ? domain(s.url) : null;
                return d ? <span key={i} className="rounded-full border border-background" style={{ zIndex: 4 - i }}><Favicon domain={d} size={14} /></span> : null;
              })}
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums">{sources.length} sources</span>
          </div>
        )}
        {t.createdAt && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {sources.length > 0 && <span className="opacity-30 mx-0.5">·</span>}
            {formatDate(t.createdAt)}
          </span>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setSheetOpen(true); }}
            className="inline-flex items-center h-7 px-2.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Details
          </button>
          {t.runId && (
            <a href={`/runs/${t.runId}`} className="inline-flex items-center h-7 px-2.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              View run
            </a>
          )}
        </div>
      </div>

      <ThesisSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        thesis_id={t.id}
        ticker={t.ticker}
        direction={(t.direction === "LONG" || t.direction === "SHORT" || t.direction === "PASS") ? t.direction : "PASS"}
        confidence_score={t.confidenceScore}
        reasoning_summary={t.reasoningSummary}
        thesis_bullets={t.thesisBullets}
        risk_flags={t.riskFlags}
        entry_price={t.entryPrice}
        target_price={t.targetPrice}
        stop_loss={t.stopLoss}
        hold_duration={
          t.horizon ? holdDurationFromHorizon(t.horizon) : t.holdDuration
        }
        company_name={t.companyName}
        status={
          t.sheetState?.status === "ACTIVE" ||
          t.sheetState?.status === "WATCHING" ||
          t.sheetState?.status === "CLOSED" ||
          t.sheetState?.status === "INVALIDATED" ||
          t.sheetState?.status === "SUPERSEDED"
            ? t.sheetState.status
            : undefined
        }
        initialState={t.sheetState}
      />
    </div>
  );
}
