"use client";

/**
 * ThesisSheet — standalone sheet body extracted from thesis-card.tsx.
 *
 * Exports:
 *  - ThesisSheetBody: raw content (no Sheet wrapper). Used by ThesisCard.
 *  - ThesisSheet: controlled Sheet wrapping ThesisSheetBody. Used by
 *    ThesisCardRenderer and any surface that needs to open the sheet
 *    programmatically without the card trigger.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useLivePoll } from "@/hooks/useLivePoll";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PriceTargetsBlock } from "@/components/domain/price-targets-block";
import { EarningsCard } from "@/components/domain/earnings-card";
import { ThesisChart } from "@/components/domain/thesis-chart";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { PriceChange } from "@/components/ui/price-change";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ChipTabs } from "@/components/ui/chip-tabs";
import { ThesisHeader } from "@/components/domain/thesis-header";
import { TradeSummary } from "@/components/domain/trade-summary";
import type { RangeMove } from "@/components/stocks/StockPriceChart";
import { formatCurrency } from "@/lib/format";
import type { SourceChipData } from "@/components/chat/SourceChip";
import { RecentActivity, ThesisTimelineSection } from "@/components/agent/sheets/ThesisTimelineSection";
import { needsActionFlag } from "@/lib/agent/needs-action-line";
import { FlagNotificationIcon } from "@/components/ui/flag-notification-icon";
import { latestNoteView } from "@/lib/thesis/latest-note";
import { caseBullets, type CaseBullet } from "@/lib/thesis/case-bullets";
import { stripCitationTags } from "@/lib/thesis/clean-text";
import type { NeedsAction } from "@/lib/agent/needs-action";
import { agentWatchDays } from "@/lib/agent/triggers/agent-watch";
import {
  ThesisTriggersSection,
  type ThesisDossier,
  type QuoteResponse,
} from "@/components/agent/sheets/ThesisTriggersSection";
import type { StockCandle } from "@/lib/actions/finnhub.actions";
import type { AnalystCoverageData } from "@/lib/actions/analyst-coverage";
import type { EarningsResponse, FilingsResponse } from "@/lib/types/thesis-sheet";
import { describeFilingEvent } from "@/lib/market-data/sec-events";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionLabel } from "@/components/domain/section-label";
import {
  AnalystConsensusWidget,
  researchCitationSources,
} from "@/components/domain/analyst-consensus";
import { SourceCitation } from "@/components/ai-elements/inline-citation";
import type { ThesisStatus } from "@/lib/thesis-status";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types (canonical definitions — re-exported from thesis-card.tsx) ─────────

export type FundamentalsData = {
  market_cap?: number;
  pe_ratio?: number;
  beta?: number;
  avg_volume?: number;
  high_52w?: number;
  low_52w?: number;
  sector?: string;
  analyst_consensus?: { buy: number; hold: number; sell: number };
};

export type ThesisCardData = {
  /**
   * Persisted Thesis row id. Optional because agent runs render the card
   * inline before the row commits. When present, the sheet shows the
   * Activity timeline section by fetching ThesisUpdate rows.
   */
  thesis_id?: string;
  ticker: string;
  // P1-24: a committed view (LONG/SHORT) or null. A pass stores direction=null
  // and is identified by status=PASSED, not by the direction column.
  direction: "LONG" | "SHORT" | null;
  reasoning_summary?: string;
  thesis_bullets?: string[];
  risk_flags?: string[];
  entry_price?: number | null;
  target_price?: number | null;
  stop_loss?: number | null;
  hold_duration?: string;
  signal_types?: string[];
  sources?: SourceChipData[];
  pass_reason?: string;
  company_name?: string | null;
  exchange?: string | null;
  fundamentals?: FundamentalsData | null;
  // P1-24: PASSED is the researched-declined status (a pass now stores
  // direction=null). Threaded so the sheet's isPass keys on status.
  status?: "HOLDING" | "RETIRED" | "WATCHING" | "PROMOTED" | "PASSED";
  created_at?: string;
  /** Days between the agent's reviews; null = a plain watch (DAV-225). */
  agent_watch_days?: number | null;
  /**
   * Per-thesis "needs work today" annotation set by get_theses: the lead of
   * the stock's work list. Drives the flag on the read-theses table row.
   * null/undefined means no work needed.
   */
  needs_action?: NeedsAction | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function hasFundamentalDetails(f: FundamentalsData): boolean {
  return (
    f.market_cap != null ||
    f.pe_ratio != null ||
    f.beta != null ||
    f.avg_volume != null ||
    f.high_52w != null ||
    f.low_52w != null ||
    !!f.sector
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// StatusPill and ConvictionBadge live in components/domain/thesis-header.tsx —
// the ONE header the sheet and the trade page share.

// ── PositionRow ──
// Plain text, no card wrapper. Three stacked lines:
//   "Bought {N} shares at ${avg}, now trading at ${current}"
//   +$X ↗ N.NN%                                                (one size up)
//   "{LONG|SHORT} · target ${T} / stop ${S} · {HORIZON} horizon"
//
// The third line is the "intent" suffix — at-a-glance what kind of
// trade this is and where the exits are. Renders only when we have
// horizon/target/stop info to show.

// WatchingRow ("Watching for entry above $X") was deleted in this redesign.
// The headline is now coreBelief — the standing opinion — and the actual
// entry condition is read from the ENTER trigger below it. The derived
// headline duplicated trigger data, often got stale, and pre-empted the
// belief text from being the visual anchor.

// Per-block skeletons were deleted 2026-06-02. The sheet now does a single
// atomic load (see the ThesisSheetBody effect + the `loaded` gate): one full
// skeleton while every fetch is in flight, then the whole body renders once
// with complete data. Each block renders iff its value is present — no
// tri-state (`real : loading-skeleton : null`), no partial-paint window.

// TradeStructureBlock (Status · Horizon · Next review · Size) was deleted
// 2026-09-30. Dave: "For trade structure. No. lol. We just dont need it."
// Next review was a row of derived restatements: the review clock is a
// review-clock trigger and shows in the trigger list, the horizon is on
// the thesis body, and "Status" was an internal actionability enum nobody
// could name. Nothing here had a reader.

/**
 * The work flag over the stock's Activity: why a run will pick it up today,
 * named (`needsActionFlag`), with the other situations it is in. Absent when
 * nothing is flagged. The analysts' notes are the Activity rows below it.
 */
function WorkFlagLine({
  status,
  needsAction,
  situations,
  quoteLoading,
  quoteFailed,
}: {
  status: string;
  needsAction: NeedsAction | null;
  /** Every situation the stock is in, lead first; the ones the lead didn't put it in follow the flag. */
  situations: Array<{ name: string; lead: boolean }>;
  quoteLoading: boolean;
  /** The live layer came back empty — we do not KNOW whether anything is flagged. */
  quoteFailed: boolean;
}) {

  // ONE flag line. `planSanity` used to stack under it — a second, unrelated
  // system (is this PLAN coherent?) painting the same amber as the work flag
  // (why will a run pick this up?), in prose written for the agent to read.
  // It renders beside the triggers now, where its numbers live.
  const flag = needsAction ? needsActionFlag(needsAction) : null;
  const also = situations.filter((x) => !x.lead).map((x) => x.name);
  const view = latestNoteView({
    status,
    hasNote: false,
    hasReasons: flag != null || also.length > 0,
    quoteLoading,
    quoteFailed,
  });
  if (!view) return null;
  // Nothing while the live layer loads, and no wrapper when there is nothing
  // to say: an empty element still takes a slot in the stack's spacing, which
  // read as a double gap under the chips (2026-11-04).
  if (view.flags === "hidden" || view.flags === "loading") return null;

  return (
    <>
      {view.flags === "reasons" ? (
        // The lead flag, then the other situations the stock is in. With no
        // work flag, the situations alone are why the morning read lists it.
        <p className="flex items-center gap-1.5 text-sm text-foreground">
          <FlagNotificationIcon className="size-4 shrink-0" />
          <span>
            Flagged for review — {flag ? flag.name : also.join(", ")}
            {flag?.detail ? <>: {flag.detail}</> : null}
            {flag && also.length > 0 ? <span className="text-muted-foreground"> · also: {also.join(", ")}</span> : null}
          </span>
        </p>
      ) : view.flags === "unchecked" ? (
        // The flags are computed against the live price. Without one we do
        // not know whether this stock is flagged, and saying "nothing" would
        // be a clean-looking answer to a question we could not ask.
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t reach the live price, so the work flags couldn&apos;t be checked.
        </p>
      ) : null}
    </>
  );
}

/** "Written Sep 13 at $38.38": the date the research writer wrote the belief, and the price its own pull read. */
function WrittenUpLine({ writtenUp }: { writtenUp: ThesisDossier["writtenUp"] }) {
  if (!writtenUp) return null;
  const at = new Date(writtenUp.at);
  if (!Number.isFinite(at.getTime())) return null;
  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      Written {at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
      {writtenUp.price != null ? ` at $${writtenUp.price.toFixed(2)}` : ""}
    </p>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/** The label over a section of the Research tab, as the tab has always drawn it. */
function Label({ children }: { children: ReactNode }) {
  return <SectionLabel>{children}</SectionLabel>;
}

/** A labelled section, exposed on the tab. */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** A sentence as the Writer stored it: the citation tags removed, a **bold** lead drawn bold. */
function Prose({ text }: { text: string }) {
  const parts = stripCitationTags(text).split("**");
  if (parts.length < 3) return <>{parts.join("")}</>;
  return <>{parts.map((part, i) => (i % 2 === 1 ? <strong key={i} className="font-medium">{part}</strong> : part))}</>;
}

/** Bullets, each with its source pill when it names one. */
function Bullets({ items }: { items: ReadonlyArray<CaseBullet> }) {
  return (
    <ul className="space-y-1.5">
      {items.map((b, i) => (
        <li key={i} className="flex gap-2 text-sm text-foreground leading-relaxed">
          <span className="text-muted-foreground/50 select-none">•</span>
          <span className="flex-1">
            <Prose text={b.text} />
            {b.citation ? (
              <>
                {" "}
                <SourceCitation sources={researchCitationSources([b.citation])} />
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── FilingsBlock ───────────────────────────────────────────────────────
// What this company told the SEC in the last month, live off EDGAR when the
// sheet opens — the serious and material filings only, since the routine
// ones (earnings results, press releases, exhibits) are noise on a sheet.
// One line, each filing linked. Renders nothing when there are none, and
// says so plainly when EDGAR couldn't be read — "no filings" would be a
// different claim. See docs/plans/SEC_FILINGS.md §8.

function FilingsBlock({ data }: { data: FilingsResponse }) {
  const worthALook = data.filings.filter((f) => f.tier !== "CONTEXT");
  if (!data.error && worthALook.length === 0) return null;

  return (
    <Section label="Filings">
      {data.error ? (
        <p className="text-sm text-muted-foreground">SEC filings unavailable — {data.error}.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          {worthALook.slice(0, 4).map((f, i) => (
            <span key={f.accession} className="inline-flex items-center gap-1.5">
              {i > 0 && <span className="text-muted-foreground/40">·</span>}
              <span className="text-muted-foreground tabular-nums">
                {new Date(`${f.filedDate}T00:00:00Z`).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })}
              </span>
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "font-medium underline-offset-4 hover:underline",
                  f.tier === "RED" ? "text-red-500" : "text-foreground",
                )}
              >
                {describeFilingEvent(f)}
              </a>
            </span>
          ))}
        </div>
      )}
    </Section>
  );
}

/** A row of the tab's accordion: its label, a chevron, the content on a click. */
function Fold({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium hover:bg-muted/30 transition-colors data-[panel-open]:bg-muted/20">
        <span>{label}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 text-sm leading-relaxed space-y-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The Research tab, in the shape it has always had — a heading, labelled
 * sections exposed on the tab, one accordion at the foot — with the fields
 * placed by the owner's order (2026-11-02, labels 2026-11-03): the company
 * (two sentences) as the heading, under "About <company>"; the belief under
 * it as "Core thesis" in every state, with the write-up's date and price;
 * the bull case, the bear case and what would prove us wrong exposed as
 * bullets; the filings in their old place under the top block; then the
 * accordion, with its "Updated 50d ago" header row as before, holding the
 * key assumptions, where we differ from the street, and the conviction's
 * reason under its own fold. Every sentence is drawn with the Writer's
 * citation tags removed. A row written before the company line shows
 * nothing there, never a placeholder.
 */
function ResearchView({ state, filings, companyName }: { state: ThesisDossier; filings: FilingsResponse | null; companyName: string | null }) {
  const clean = (v: string | null | undefined) => (v?.trim() ? stripCitationTags(v) : null);
  const company = clean(state.company);
  const belief = clean(state.coreBelief);
  const bull = caseBullets(state.bullCase);
  const bear = caseBullets(state.bearCase);
  const wrong = (state.invalidationConds ?? []).filter(Boolean).map((text) => ({ text }));
  const assumptions = (state.keyAssumptions ?? []).filter(Boolean).map((text) => ({ text }));
  const variant = clean(state.variantView);
  const reason = clean(state.convictionRationale);
  const convictionWord = state.conviction
    ? `${state.conviction.charAt(0)}${state.conviction.slice(1).toLowerCase()} conviction`
    : "Conviction";
  const updatedAt = state.writtenUp?.at ?? state.researchUpdatedAt;
  if (!company && !belief && bull.length === 0 && bear.length === 0 && wrong.length === 0 && assumptions.length === 0 && !variant) {
    return <p className="text-sm text-muted-foreground">No research on this stock yet.</p>;
  }
  return (
    <>
      {company ? (
        <Section label={`About ${companyName?.trim() || state.ticker}`}>
          <p className="text-lg font-normal leading-relaxed">{company}</p>
        </Section>
      ) : null}

      {belief ? (
        <Section label="Core thesis">
          <p className="text-sm text-foreground leading-relaxed">{belief}</p>
          <WrittenUpLine writtenUp={state.writtenUp} />
        </Section>
      ) : company ? (
        <WrittenUpLine writtenUp={state.writtenUp} />
      ) : null}

      {filings ? <FilingsBlock data={filings} /> : null}

      {bull.length > 0 ? (
        <Section label="Bull case">
          <Bullets items={bull} />
        </Section>
      ) : null}

      {bear.length > 0 ? (
        <Section label="Bear case">
          <Bullets items={bear} />
        </Section>
      ) : null}

      {wrong.length > 0 ? (
        <Section label="What would prove us wrong">
          <Bullets items={wrong} />
        </Section>
      ) : null}

      {assumptions.length > 0 || variant || reason ? (
        <div className="space-y-2">
          <SectionLabel action={updatedAt ? <p className="text-xs text-muted-foreground">Updated {relativeTime(updatedAt)}</p> : null}>Research notes</SectionLabel>
        <div className="rounded-lg border divide-y">
          {assumptions.length > 0 ? (
            <Fold label="Key assumptions">
              <Bullets items={assumptions} />
            </Fold>
          ) : null}
          {variant ? (
            <Fold label="Where we differ from the street">
              <p>{variant}</p>
            </Fold>
          ) : null}
          {reason ? (
            <Fold label={convictionWord}>
              <p>{reason}</p>
            </Fold>
          ) : null}
        </div>
        </div>
      ) : null}
    </>
  );
}

// ── TerminalStatusAlert ─────────────────────────────────────────────────
// Renders a single Alert when the thesis is in a terminal state. Tells
// the user *why* the thesis ended + when, so the rest of the sheet
// (entry levels, triggers, etc.) reads as history rather than as live
// state. Added 2026-05-18 (THESIS_CLEANUP PR-2) — both reasons were
// fetched but never rendered.
function TerminalStatusAlert({
  status,
  retiredReason,
  closedAt,
  closeReason,
  invalidatedAt,
  invalidReason,
}: {
  status: ThesisStatus | undefined;
  retiredReason: string | null;
  closedAt: string | null;
  closeReason: string | null;
  invalidatedAt: string | null;
  invalidReason: string | null;
}) {
  // CLOSED is deliberately NOT handled here. A closed position renders
  // inside TradeBlock ("Bought N @ $X, closed at $Y" + realized P&L + close
  // reason) — the single source of truth for the closed trade state. This
  // banner exists only for terminal states with NO trade to show:
  // INVALIDATED (thesis disproven) and ARCHIVED (walked away from the
  // watchlist without ever trading).
  // P1-24 B3: legacy INVALIDATED/ARCHIVED collapse into RETIRED + retiredReason.
  // Show the banner only for the no-trade terminals: legacy INVALIDATED /
  // ARCHIVED, or RETIRED with reason INVALIDATED / DROPPED. RETIRED+SOLD has a
  // real trade (TradeBlock owns it) and RETIRED+REPLACED is shown via
  // supersession — skip both, same as CLOSED.
  const retiredNoTrade =
    status === "RETIRED" &&
    (retiredReason === "INVALIDATED" || retiredReason === "DROPPED");
  if (!retiredNoTrade) {
    return null;
  }
  // RETIRED+INVALIDATED tracks invalidatedAt/invalidReason; RETIRED+DROPPED
  // ("walked away" without a trade outcome) reuses closedAt/closeReason.
  const isInvalid = retiredReason === "INVALIDATED";
  const date = isInvalid ? invalidatedAt : closedAt;
  const reason = isInvalid ? invalidReason : closeReason;
  if (!date && !reason) return null;
  const title = isInvalid ? "Thesis invalidated" : "Thesis archived";
  const formattedDate = date
    ? new Date(date).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;
  return (
    <Alert>
      <AlertTitle>{title}{formattedDate ? ` · ${formattedDate}` : ""}</AlertTitle>
      {reason ? <AlertDescription>{reason}</AlertDescription> : null}
    </Alert>
  );
}

// AnalystConsensusWidget lives in components/domain/analyst-consensus.tsx —
// the ONE Street-view widget shared with the stock page sidebar.

// ─── ThesisSheetBody ──────────────────────────────────────────────────────────

// One skeleton for the ENTIRE sheet — shown while the atomic load is in flight.
// Mirrors the real layout (identity header, price line, trade block, thesis
// paragraph, chart) so there's no layout jump when the real content swaps in.
/** The body's skeleton: price line, trade block, chart, paragraph. */
export function ThesisBodySkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-[300px] w-full rounded-lg" />
      <div className="space-y-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-11/12" />
        <Skeleton className="h-5 w-3/4" />
      </div>
    </div>
  );
}

function ThesisSheetSkeleton() {
  return (
    <div className="px-4 pb-6 pt-2 space-y-5">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-lg shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <ThesisBodySkeleton />
      </div>
    </div>
  );
}

// The sheet's ENTIRE contract: which thesis. Everything rendered is fetched by
// thesis_id — the durable dossier (GET /api/theses/:id) gates the paint, then
// the live layers (quote, candles, coverage) hydrate their own regions. No
// row-snapshot props, no second source. (Callers still hand ThesisSheet full
// ThesisCardData for back-compat; the wrapper forwards only these two fields.)
export interface ThesisSheetBodyProps {
  /** Persisted Thesis id — the sheet loads everything by this. */
  thesis_id?: string;
  /** Only used before/without a load: skeleton a11y + the error state. */
  ticker: string;
}

/** Everything the sheet loads for one thesis, by id. */
export interface ThesisSheetData {
  state: ThesisDossier | null;
  loaded: boolean;
  quote: QuoteResponse | null;
  quoteLoading: boolean;
  earnings: EarningsResponse | null;
  filings: FilingsResponse | null;
  candles: StockCandle[] | null;
  candlesLoading: boolean;
  coverage: AnalystCoverageData | null;
  coverageLoading: boolean;
  /** Re-fetch the dossier + quote after a trigger edit or a send-to-agent. */
  refresh: () => void;
}

/**
 * The sheet's data, as a hook, so the sheet and the trade page load the same
 * thesis the same way. Durable-first paint, progressive live hydration:
 *   • GET /api/theses/:id                  → dossier (DB only) — GATES paint
 *   • GET /api/theses/:id/quote            → price + PnL + resolved (Finnhub)
 *   • GET /api/stocks/candles?symbols=…    → price chart (Alpaca)
 *   • GET /api/theses/:id/analyst-coverage → Wall Street (ratings + targets)
 * Each live layer has its own loading flag driving a region-level skeleton.
 */
export function useThesisSheetData(
  thesis_id: string | undefined,
  ticker: string,
  /** The trade page's own position row; the sheet takes the thesis's current one. */
  positionId?: string | null,
): ThesisSheetData {
  const [state, setState] = useState<ThesisDossier | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  // Earnings + filings: own regions, never gate the paint, no skeleton (the
  // block simply appears when the vendor answers; absence is a valid state).
  const [earnings, setEarnings] = useState<EarningsResponse | null>(null);
  const [filings, setFilings] = useState<FilingsResponse | null>(null);
  const [candles, setCandles] = useState<StockCandle[] | null>(null);
  const [candlesLoading, setCandlesLoading] = useState(true);
  const [coverage, setCoverage] = useState<AnalystCoverageData | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);
  // Bumped after a trigger edit so the dossier re-fetches and the open sheet
  // reflects the new value without a manual reopen (live layers don't move).
  const [refreshKey, setRefreshKey] = useState(0);
  // The header price re-pulls on the live cadence while the sheet is open.
  const [liveTick, setLiveTick] = useState(0);
  useLivePoll(() => setLiveTick((n) => n + 1));

  // Re-gate (show the skeletons) only when a DIFFERENT thesis opens — NOT on a
  // refreshKey bump from a trigger edit, which swaps the dossier in place. Clear
  // the live data too, not just the loading flags: otherwise an in-place
  // thesis_id switch briefly renders the PREVIOUS thesis's price/chart/coverage.
  useEffect(() => {
    setLoaded(false);
    setQuote(null);
    setCandles(null);
    setCoverage(null);
    setEarnings(null);
    setFilings(null);
    setQuoteLoading(true);
    setCandlesLoading(true);
    setCoverageLoading(true);
  }, [thesis_id]);

  useEffect(() => {
    if (!thesis_id) return;
    let cancelled = false;
    fetch(`/api/theses/${thesis_id}/earnings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: EarningsResponse | null) => {
        if (!cancelled) setEarnings(json);
      })
      .catch(() => {
        /* absent block is the failure state */
      });
    return () => {
      cancelled = true;
    };
  }, [thesis_id]);

  useEffect(() => {
    if (!thesis_id) return;
    let cancelled = false;
    fetch(`/api/theses/${thesis_id}/filings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: FilingsResponse | null) => {
        if (!cancelled) setFilings(json);
      })
      .catch(() => {
        /* absent block is the failure state */
      });
    return () => {
      cancelled = true;
    };
  }, [thesis_id]);

  // Durable dossier — the ONLY fetch that gates the paint. Re-runs on a
  // trigger edit (refreshKey) to swap the new triggers in place.
  useEffect(() => {
    if (!thesis_id) return;
    let cancelled = false;
    fetch(`/api/theses/${thesis_id}${positionId ? `?position=${encodeURIComponent(positionId)}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: ThesisDossier | null) => {
        if (cancelled) return;
        setState(json);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [thesis_id, positionId, refreshKey]);

  // Quote ALSO re-fetches on refreshKey: it carries the `resolved` envelope,
  // whose actionability is computed from the thesis's triggers, so a trigger
  // edit must re-resolve it (candles/coverage don't move on a trigger edit).
  // quoteLoading is NOT set here — a refetch updates price + resolved in
  // place without flashing the header skeleton.
  useEffect(() => {
    if (!thesis_id) return;
    let cancelled = false;
    fetch(`/api/theses/${thesis_id}/quote`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: QuoteResponse | null) => {
        if (!cancelled) setQuote(json);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      })
      .finally(() => {
        if (!cancelled) setQuoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [thesis_id, refreshKey, liveTick]);

  useEffect(() => {
    if (!thesis_id) return;
    // No ticker → nothing to chart; clear the loading flag so the chart region
    // doesn't sit on an eternal skeleton (the reset effect set it true).
    if (!ticker) {
      setCandlesLoading(false);
      return;
    }
    let cancelled = false;
    setCandlesLoading(true);
    fetch(`/api/stocks/candles?symbols=${encodeURIComponent(ticker)}&days=400`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { candles?: Record<string, StockCandle[]> } | null) => {
        if (cancelled) return;
        setCandles(json?.candles?.[ticker.toUpperCase()] ?? null);
      })
      .catch(() => {
        if (!cancelled) setCandles(null);
      })
      .finally(() => {
        if (!cancelled) setCandlesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [thesis_id, ticker]);

  useEffect(() => {
    if (!thesis_id) return;
    let cancelled = false;
    setCoverageLoading(true);
    fetch(`/api/theses/${thesis_id}/analyst-coverage`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: AnalystCoverageData | null) => {
        if (!cancelled) setCoverage(json);
      })
      .catch(() => {
        if (!cancelled) setCoverage(null);
      })
      .finally(() => {
        if (!cancelled) setCoverageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [thesis_id]);

  return {
    state,
    loaded,
    quote,
    quoteLoading,
    earnings,
    filings,
    candles,
    candlesLoading,
    coverage,
    coverageLoading,
    refresh: () => setRefreshKey((k) => k + 1),
  };
}

// ─── ThesisBody ──────────────────────────────────────────────────────────────
// Everything under the header, the same on the sheet and the trade page: the
// price with the chart's selected move, then three tabs. Overview is the
// timeline (the trade banner, the chart, the plan, the flag line, the newest
// 8 Activity lines); Research is the analyst's view (ResearchView); Activity
// is the whole list.
//   surface "sheet": the trade banner shows for a held or closed position and
//                    the stock cards (the levels, Wall Street) close the Overview.
//   surface "page":  the page's right-hand column carries the position card
//                    and the stock cards beside every tab, so the banner shows
//                    only while a proposal waits on you.
export function ThesisBody({
  data,
  thesis_id,
  ticker,
  surface,
  aside,
  moreTabs,
  afterActivity,
}: {
  data: ThesisSheetData & { state: ThesisDossier };
  thesis_id?: string;
  ticker: string;
  surface: "sheet" | "page";
  /**
   * The page's right-hand cards. Rendered beside the tab panels, under the
   * tab row, so they start level with the chart instead of with the price.
   */
  aside?: ReactNode;
  /** More tabs after Activity (the stock page's News). */
  moreTabs?: Array<{ label: string; content: ReactNode }>;
  /** Under the Activity tab's list (the stock page's history of the stock). */
  afterActivity?: ReactNode;
}) {
  const { state, quote, quoteLoading, earnings, filings, candles, candlesLoading, coverage, coverageLoading, refresh } = data;
  const extraTabs = moreTabs ?? [];
  // What the chart's selected range shows; the price row prints it.
  const [move, setMove] = useState<RangeMove | null>(null);
  // The open tab: Overview's "View all" opens Activity.
  const [tab, setTab] = useState(0);
  const ACTIVITY_TAB = 2;

  // ── Derived — durable from `state`, live from the hydration states ────────
  const liveStatus = state.status as ThesisStatus;
  const position = state.position;
  // P1-24: a pass is identified by status=PASSED (direction is null on a pass).
  const isPass = state.status === "PASSED";
  const direction: "LONG" | "SHORT" | null =
    state.direction === "LONG" || state.direction === "SHORT"
      ? state.direction
      : null;
  // `state.levels` is what fires; entryPrice/targetPrice/stopLoss are the
  // cache and are passed only so the card can flag a number no trigger backs.
  // See docs/plans/LEVELS_AS_TRIGGERS.md.
  const entryPrice = state.levels?.entry?.price ?? state.entryPrice;
  const targetPrice = state.targetPrice;
  const stopLoss = state.stopLoss;
  const floorLevel = state.levels?.floor ?? null;
  const targetLevel = state.levels?.target ?? null;
  // Show the block when there is either a live level or a stored number worth
  // flagging — a decorative stop is exactly what the reader needs to see.
  const showLevels =
    !isPass &&
    entryPrice != null &&
    (targetLevel != null ||
      floorLevel != null ||
      targetPrice != null ||
      stopLoss != null);

  // The price row's move. On 1D it is the quote's own day change — the live
  // price against yesterday's close, the same number the ticker tape shows.
  // On every other range it is what the chart shows for that stretch.
  const dayMove =
    quote?.dayChange != null ? { dollars: quote.dayChange, pct: quote.dayChangePct } : null;
  const shownMove =
    move == null || move.range === "1D"
      ? (dayMove ?? (move ? { dollars: move.dollars, pct: move.pct } : null))
      : { dollars: move.dollars, pct: move.pct };

  const pendingProposal = position?.pendingProposal ?? null;

  // Wall Street: the consensus card, live. It hydrates on its own boundary so
  // it never blocks the chart; skeleton until it lands.
  const wallStreet =
    coverageLoading && !coverage ? (
      <Skeleton className="h-40 w-full rounded-lg" />
    ) : (
      <AnalystConsensusWidget coverage={coverage} currentPrice={quote?.currentPrice ?? null} />
    );

  // The trade, in its two looks. The banner sits under the price: on the
  // sheet in every state, on the page only while a proposal waits (the card
  // in the sidebar carries the held numbers there). Both read the same
  // position and the same live P&L, so they can't disagree.
  const tradeBanner =
    position && (surface === "sheet" || pendingProposal != null) ? (
      <TradeSummary
        look="banner"
        position={position}
        pnl={quote?.positionPnl ?? null}
        pendingProposal={pendingProposal}
        direction={direction}
      />
    ) : null;
  const tradeCard =
    position && surface === "page" ? (
      <TradeSummary
        look="card"
        position={position}
        pnl={quote?.positionPnl ?? null}
        pendingProposal={pendingProposal}
        direction={direction}
      />
    ) : null;

  // The stock cards — the plan's levels, Wall Street, the earnings record —
  // built once. With a sidebar (the page) they go there; without one (the
  // sheet) they close the Overview.
  const stockCards = (
    <>
      {showLevels && entryPrice != null ? (
        <PriceTargetsBlock
          entry={entryPrice}
          target={targetLevel}
          stop={floorLevel}
          storedTarget={targetPrice}
          storedStop={stopLoss}
          current={quote?.currentPrice ?? null}
          direction={direction === "SHORT" ? "SHORT" : "LONG"}
        />
      ) : null}
      {wallStreet}
      {earnings ? <EarningsCard data={earnings} /> : null}
    </>
  );

  // The page's two columns: the tab's content on the left, the cards on the
  // right. Each tab opens its own pair under the tab bar — on Overview under
  // the price row too — so the cards start level with the chart. Only the
  // open tab is mounted, so the cards render once.
  // The stock's newest 8 Activity lines: what the agents are handed, as Activity rows.
  const recent = state.recent ?? [];

  const columns = cn(surface === "page" && "grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]");
  // The standing opinion, first thing under the chips on Overview.
  const belief = state.coreBelief?.trim() ? stripCitationTags(state.coreBelief) : null;
  const tabOptions = [
    { value: "0", label: "Overview" },
    { value: "1", label: "Research" },
    { value: String(ACTIVITY_TAB), label: "Activity" },
    ...extraTabs.map((t, i) => ({ value: String(ACTIVITY_TAB + 1 + i), label: t.label })),
  ];
  const sideColumn =
    surface === "page" ? (
      <div className="hidden lg:block space-y-4">
        {tradeCard}
        {aside}
        {stockCards}
      </div>
    ) : null;

  return (
    <div className={columns}>
    <div className="min-w-0">
    <Tabs value={tab} onValueChange={(v) => setTab(Number(v))} className="gap-4">
      {/* ── Above the tabs on every tab (the owner's order, 2026-11-04): the price, the trade, the chart ── */}
      {/* ── Live price + the selected range's move ───────────── */}
      {/* Hydrates from /quote after the dossier paints: skeleton while in
          flight, nothing if the vendor failed (currentPrice null). */}
      {quoteLoading ? (
        <Skeleton className="h-7 w-32" />
      ) : quote?.currentPrice != null ? (
        <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
          <span className="text-xl font-semibold tabular-nums">
            {formatCurrency(quote.currentPrice)}
          </span>
          {shownMove ? (
            <PriceChange dollarChange={shownMove.dollars} percentChange={shownMove.pct} size="xl" />
          ) : null}
        </div>
      ) : null}
      {tradeBanner}

      {/* ── Price chart (annotated) ───────────────────────────── */}
      {/* Full price line with Entry/Target/Stop lines + "Watching"/"Entry"
          markers. Its selected range's move prints in the price row above,
          not inside the chart. */}
      {!isPass && candlesLoading ? (
        <Skeleton className="h-[300px] w-full rounded-lg" />
      ) : !isPass && candles && candles.length >= 2 ? (
        <ThesisChart
          ticker={ticker}
          candles={candles}
          direction={direction === "SHORT" ? "SHORT" : "LONG"}
          entryPrice={entryPrice}
          avgCost={position?.avgCost ?? null}
          levels={state.levels ?? null}
          targetPrice={targetPrice}
          stopLoss={stopLoss}
          current={quote?.currentPrice ?? null}
          addedAt={state.createdAt}
          enteredAt={position?.openedAt ?? null}
          soldAt={position?.closedAt ?? null}
          variant="full"
          onChange={setMove}
          showChange={false}
        />
      ) : null}

      {/* The sections, as chips: the chart is always worth the screen; the chips pick what sits under it. */}
      <ChipTabs options={tabOptions} value={String(tab)} onChange={(v) => { if (v != null) setTab(Number(v)); }} clearable={false} />

      {/* ── Overview: the belief → the plan → the newest 8 ── */}
      <TabsContent value={0} className="space-y-6">
      {/* ── Whether it needs work today (DAV-304) ── */}
      <WorkFlagLine
        status={state.status}
        needsAction={quote?.needsAction ?? null}
        situations={quote?.situations ?? []}
        quoteLoading={quoteLoading}
        quoteFailed={!quoteLoading && quote == null}
      />

      {/* The standing opinion, the same size as the company line on Research. */}
      {belief ? <p className="text-lg font-normal text-foreground leading-relaxed">{belief}</p> : null}


      {/* ── The plan: the triggers ── */}
      {thesis_id ? (
        <ThesisTriggersSection
          thesisId={thesis_id}
          data={state}
          direction={direction}
          editable={
            !isPass && (liveStatus === "HOLDING" || liveStatus === "WATCHING")
          }
          onChanged={refresh}
        />
      ) : null}

      {/* The newest 8 Activity lines, the ones the agents are handed, in the Activity tab's own design. */}
      <RecentActivity items={recent} triggers={state.triggers} onViewAll={() => setTab(ACTIVITY_TAB)} />

      {surface === "sheet" ? stockCards : null}
      </TabsContent>

      {/* ── Research: the claim and the write-up behind it ─────── */}
      <TabsContent value={1} className="space-y-6">
        <ResearchView state={state} filings={filings} companyName={quote?.companyName ?? null} />
      </TabsContent>

      {/* ── Activity tab: the whole list ───────────────────────── */}
      <TabsContent value={ACTIVITY_TAB} className="space-y-6">
          {thesis_id ? (
            <ThesisTimelineSection
              thesisId={thesis_id}
              recentIds={recent.map((r) => r.id)}
              triggers={state.triggers}
              provenance={
                state.sourceKind
                  ? {
                      sourceKind: state.sourceKind,
                      rationale: state.sourceRationale ?? null,
                    }
                  : null
              }
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              No activity yet — this thesis hasn&apos;t been persisted.
            </p>
          )}
          {afterActivity}
      </TabsContent>

      {extraTabs.map((t, i) => (
        <TabsContent key={t.label} value={ACTIVITY_TAB + 1 + i} className="space-y-6">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
    </div>
    {sideColumn}
    </div>
  );
}

// ─── ThesisSheetBody ──────────────────────────────────────────────────────────
// The sheet: the terminal-state alert, then the shared header, then the body.
export function ThesisSheetBody({ thesis_id, ticker }: ThesisSheetBodyProps) {
  const data = useThesisSheetData(thesis_id, ticker);

  // Skeleton until the DURABLE dossier settles, an honest error if it failed.
  // A sheet without a persisted id (e.g. a failed record_thesis card) has
  // nothing to load — that's the error state, not an eternal skeleton.
  if (!data.loaded && thesis_id) {
    return <ThesisSheetSkeleton />;
  }
  const state = data.state;
  if (!state) {
    return (
      <div className="px-4 py-16 text-center space-y-1">
        <p className="text-sm font-medium">Couldn&apos;t load this thesis</p>
        <p className="text-xs text-muted-foreground">
          {ticker} — the thesis data failed to load. Close and reopen the sheet to retry.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-6 pt-3 space-y-4">
      {/* Terminal non-trade states only (INVALIDATED / DROPPED): why the thesis
          ended + when, so the rest reads as history. Returns null otherwise. */}
      <TerminalStatusAlert
        status={state.status as ThesisStatus}
        retiredReason={state.retiredReason ?? null}
        closedAt={state.closedAt ?? null}
        closeReason={state.closeReason ?? null}
        invalidatedAt={state.invalidatedAt ?? null}
        invalidReason={state.invalidReason ?? null}
      />
      <div className="space-y-4">
        <ThesisHeader
          ticker={ticker}
          // Identity rides in the payload (StockInfo cache via quote) — one
          // source; the bare ticker is the degenerate case when that failed.
          displayName={data.quote?.companyName ?? ticker}
          exchange={data.quote?.exchange ?? null}
          status={state.status}
          agentWatchDays={agentWatchDays(state.triggers)}
          conviction={(state.conviction ?? null) as "STRONG" | "HIGH" | "MEDIUM" | "LOW" | null}
          analystId={state.analystId}
          thesisId={thesis_id}
          onSent={data.refresh}
          surface="sheet"
          expandHref={state.position?.id ? `/trades/${state.position.id}` : `/stocks/${ticker}`}
          closeTrade={state.position?.id && !state.position.closed ? { tradeId: state.position.id } : null}
        />
        <ThesisBody data={{ ...data, state }} thesis_id={thesis_id} ticker={ticker} surface="sheet" />
      </div>
    </div>
  );
}

// ─── ThesisSheet — controlled standalone sheet ────────────────────────────────

// Accepts full ThesisCardData for caller back-compat, but the sheet loads
// everything by id — only thesis_id + ticker are actually consumed.
interface ThesisSheetProps extends ThesisCardData {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ThesisSheet({ open, onOpenChange, ...data }: ThesisSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" size="xl" floating showCloseButton={false} className="gap-0">
        <SheetHeader className="p-0">
          <SheetTitle className="sr-only">{data.ticker} Thesis</SheetTitle>
        </SheetHeader>
        <ThesisSheetBody thesis_id={data.thesis_id} ticker={data.ticker} />
      </SheetContent>
    </Sheet>
  );
}
