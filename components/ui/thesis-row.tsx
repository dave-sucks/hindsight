"use client";

import { useState } from "react";
import { StockLogo } from "@/components/StockLogo";
import { TradeStatement, type TradeStatementGain } from "@/components/ui/trade-statement";
import { buildTradeSentence } from "@/lib/trade-statement";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Favicon } from "@/components/intelligence/signal-feed";
import { getTradeStatusDisplay } from "@/lib/trade-status";
import type { TradeStatus } from "@/lib/mock-data/trades";
import { ThesisSheet } from "@/components/agent/sheets/ThesisSheet";
import type { TriggersResponse } from "@/components/agent/sheets/ThesisTriggersSection";
import { holdDurationFromHorizon } from "@/lib/agent/horizon-policy";
import { getThesisStatusDisplay } from "@/lib/thesis-status";

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
   * Lifecycle status — drives the row's leading badge (Watching / Active /
   * Closed / Invalidated / Archived / Superseded / Promoted). When the
   * direction is PASS we render "Pass" instead regardless of status; PASS
   * is terminal-at-write and ARCHIVED is just the storage shape. Typed as
   * `string` so callers can pass DB-raw values without narrowing —
   * `getThesisStatusDisplay` falls back gracefully on unknown values.
   */
  status?: string;
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

// ── Status banner ────────────────────────────────────────────────────────────

interface RowBanner {
  label: string;
  dotClass: string;
  sentence: string | null;
  gain: TradeStatementGain | null;
  /**
   * True only for real trades (proposed buy / holding / closed). Drives the
   * render split: trades get the contained rounded muted banner; non-trade
   * thesis states (watching / pass / invalidated) get a light inline status
   * line so the eye can tell "this is a position" from "this is just a
   * thesis" at a glance.
   */
  isTrade: boolean;
}

/**
 * One status-aware banner replacing the old position-row + analysis-status
 * double (which showed two statuses — trade "Holding" AND thesis "Active" —
 * plus the price target twice). Trade rows use the shared buildTradeSentence
 * (one grammar across sheet / row / trades-page / activity):
 *
 *   Holding  → "Bought N shares at $X, now trading at $Y"   [+$gain ↗ %]
 *   Pending  → "Proposed: Buy N shares at $X"
 *   Won/Loss → "Bought N shares at $X, closed at $Y"        [+$gain ↗ %]
 *   Watching → "buy above $target"   (not a trade — light inline line)
 *   Pass     → "@ $entry"            (reads "Pass @ $40.35")
 *   terminal → "@ $entry"
 *
 * When a position exists the badge is the TRADE status (Holding/Won/Loss) —
 * the thesis "Active" status is implied by holding a position, so it's not
 * shown twice. The $/% gain sits on the RIGHT of the row.
 */
function buildRowBanner(t: ThesisRowData): RowBanner | null {
  const $ = (n: number) => `$${n.toFixed(2)}`;
  const pos = t.position;

  if (pos) {
    const ts: TradeStatus = pos.tradeStatus ?? (pos.avgCost === 0 ? "PENDING" : "OPEN");
    const cfg = getTradeStatusDisplay(ts);
    const qty = pos.quantity ?? null;
    const entry = pos.avgCost;

    if (ts === "PENDING") {
      return {
        label: cfg.label,
        dotClass: cfg.dotClass,
        sentence: buildTradeSentence({ kind: "proposed-buy", qty, entry }),
        gain: null,
        isTrade: true,
      };
    }

    // The order never filled — nothing was bought. Not a trade; falls
    // through to the light status line via isTrade: false.
    if (ts === "CANCELLED" || ts === "REJECTED") {
      return {
        label: cfg.label,
        dotClass: cfg.dotClass,
        sentence: null,
        gain: null,
        isTrade: false,
      };
    }

    const isClosed =
      ts === "CLOSED_WIN" || ts === "CLOSED_LOSS" || ts === "CLOSED_EXPIRED";
    const gainDollar = isClosed
      ? (pos.realizedPnl ?? null)
      : t.currentPrice != null && qty != null
        ? (t.currentPrice - entry) * qty
        : null;
    const gainPct =
      gainDollar != null && entry > 0 && qty != null && qty !== 0
        ? (gainDollar / (entry * qty)) * 100
        : null;

    return {
      label: cfg.label,
      dotClass: cfg.dotClass,
      sentence: buildTradeSentence({
        kind: isClosed ? "closed" : "holding",
        qty,
        entry,
        current: t.currentPrice,
        closePrice: pos.closePrice,
      }),
      gain: gainDollar != null ? { dollar: gainDollar, pct: gainPct } : null,
      isTrade: true,
    };
  }

  // ── No position — thesis-status states (light inline line, not a banner) ──
  if (t.direction === "PASS") {
    return {
      label: "Pass",
      dotClass: "bg-muted-foreground/40",
      sentence: t.entryPrice != null ? `@ ${$(t.entryPrice)}` : null,
      gain: null,
      isTrade: false,
    };
  }

  const d = getThesisStatusDisplay(t.status);
  const status = (t.status ?? "").toUpperCase();

  if (status === "WATCHING") {
    return {
      label: d.label,
      dotClass: d.dotClass,
      sentence:
        t.targetPrice != null && t.targetPrice > 0
          ? `buy above ${$(t.targetPrice)}`
          : null,
      gain: null,
      isTrade: false,
    };
  }

  if (status === "ACTIVE" || status === "PROMOTED") {
    // Trade-eligible coverage with no position open yet — show the target
    // as the next step, not a stale "@ entry".
    return {
      label: d.label,
      dotClass: d.dotClass,
      sentence:
        t.targetPrice != null && t.targetPrice > 0
          ? `target ${$(t.targetPrice)}`
          : null,
      gain: null,
      isTrade: false,
    };
  }

  // INVALIDATED / ARCHIVED / SUPERSEDED — the price the thesis referenced.
  return {
    label: d.label,
    dotClass: d.dotClass,
    sentence: t.entryPrice != null ? `@ ${$(t.entryPrice)}` : null,
    gain: null,
    isTrade: false,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function ThesisRow({ thesis: t, showTicker = true }: ThesisRowProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const sources = parseSources(t.sourcesUsed);
  const banner = buildRowBanner(t);

  const deltaPct = t.priceChange?.percent
    ?? (t.currentPrice && t.entryPrice && t.entryPrice > 0 ? ((t.currentPrice - t.entryPrice) / t.entryPrice) * 100 : null);

  return (
    <div className="rounded-xl border bg-background overflow-hidden">

      {/* ── Stock row ── */}
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

      {/* ── Body: status line + summary ── */}
      {/* A real trade renders as a contained rounded muted banner (the
          sheet's TradeBlock shape) so a position reads as distinct from a
          plain thesis — without being a full-width colored strip. A plain
          thesis renders as a light inline status line. The gain on the
          right keeps its green/red; the container stays muted. */}
      <div className="px-4 py-3 space-y-2">
        {banner?.isTrade ? (
          <TradeStatement
            label={banner.label}
            dotClass={banner.dotClass}
            sentence={banner.sentence}
            gain={banner.gain}
            className="rounded-lg bg-muted/50 px-3 py-2"
          />
        ) : banner ? (
          <TradeStatement
            label={banner.label}
            dotClass={banner.dotClass}
            sentence={banner.sentence}
            gain={banner.gain}
          />
        ) : null}
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
