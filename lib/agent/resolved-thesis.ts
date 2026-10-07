/**
 * resolved-thesis.ts — read-time computed envelope for theses.
 *
 * Conviction Expression v4 reader-side fix. See
 * docs/plans/CONVICTION_EXPRESSION.md §6.
 *
 * The premise: tonight's ranking exercise failed because the agent had
 * to re-derive too much per cycle — "is OKTA above $92.50 right now?",
 * "is this older ZS thesis still live or superseded by a newer
 * INVALIDATED sister?", "is DELL's earnings catalyst still in the
 * future?". All derivable, but every agent has to derive it again in
 * its own context.
 *
 * This module moves the derivation once-into-tool-code. `get_theses`
 * calls `buildResolvedEnvelope` per row and includes the result inline
 * so the agent reads a resolved verdict.
 *
 * Not stored — prices move, trigger state is by definition derived,
 * supersession depends on the existence of OTHER rows. Computed every
 * read.
 */

import { getThesisComposite } from "@/lib/agent/thesis-narrative";
import type { Trigger } from "@/lib/agent/triggers/types";
import { evaluateTrigger } from "@/lib/agent/triggers/evaluate";
import { conditionSentence, levelOf, sentenceOf, shapeOf } from "@/lib/agent/triggers/condition";
import { computeLadderHealth, type LadderHealth } from "@/lib/agent/ladder-health";
import { computePlanSanity, type PlanSanityFlag } from "@/lib/agent/plan-sanity";
import { floorTooFar, type FloorRisk, type FloorStructure } from "@/lib/agent/floor-risk";
import { isPlanLevel } from "@/lib/agent/triggers/price-levels";
import type { SpentBuyCrossing } from "@/lib/agent/buy-crossing";
import type { EntryRaiseAway } from "@/lib/agent/entry-raises";
import { measuresOf } from "@/lib/agent/trigger-measures";

/**
 * The reviews a stock inherits, sorted into the ones that always reach it and
 * the ones that may not. A schedule always comes. A review before the report
 * comes only when the next report date is known and ahead: BBIO had none on
 * 2026-10-07, and JBL's and KMX's were already past, so a report wake was
 * not yet real for any of them. A review that waits on the price may stay
 * silent for months.
 */
export function inheritedWakes(
  parsed: Trigger[],
  /** The next scheduled report, YYYY-MM-DD; null or absent = not known. */
  nextReportDate?: string | null,
  /** Today, YYYY-MM-DD, Eastern. */
  today?: string,
): { always: boolean; mayWake: string[]; reportWithoutDate: boolean } {
  const reviews = parsed.filter((t) => ((t as { level?: string }).level ?? "THESIS") !== "THESIS" && t.action === "REVIEW");
  const watches = (t: Trigger, m: string) => measuresOf(t.predicate).includes(m);
  const reportKnown = nextReportDate != null && today != null && nextReportDate >= today;
  const always = reviews.some((t) => watches(t, "repeat") || (watches(t, "report") && reportKnown));
  const reportWithoutDate = !always && reviews.some((t) => watches(t, "report"));
  return {
    always,
    mayWake: always ? [] : reviews.filter((t) => !watches(t, "report")).map((t) => sentenceOf(t)),
    reportWithoutDate,
  };
}

// ── Public types ──────────────────────────────────────────────────────

export type Actionability =
  | "ENTER_NOW"
  | "WAIT_FOR_TRIGGER"
  | "PENDING_CATALYST"
  | "ACTIVE_HOLD"
  | "STALE_PAST_CATALYST"
  | "SUPERSEDED"
  | "PROMOTED_DECIDE_TODAY"
  | "DEAD";

export type TriggerState =
  | "ENTER_FIRED"
  | "ENTER_WAITING"
  | "EXIT_FIRED"
  | "NONE";

export interface ResolvedEnvelope {
  /** Live quote at read time. Null on quote failure. */
  currentPrice: number | null;
  /** Flat surfacing of scoring.entryQuality.score. */
  entryQualityScore: number | null;

  /**
   * Unrealized gain % for HOLDING rows (direction-aware), so the agent sees
   * P&L inline instead of cross-referencing get_portfolio_context. Null for
   * non-held rows or when avgCost/quote is unavailable. (SCALE_INTO_WINNERS.md)
   */
  unrealizedGainPct: number | null;
  /**
   * Fraction of the entry→target distance covered for HOLDING rows (≥1 = past
   * target). The at-a-glance "how close to the decision point." Null otherwise.
   */
  progressToTarget: number | null;

  /**
   * Ladder-health block for HOLDING rows (Game Plan PR-B): gain% from entry,
   * what the tightest protective EXIT rung locks in, whether a trail exists,
   * the nearest forward rung + distance, days since the ladder was last
   * edited, and the UNPROTECTED_GAIN flag (the IONS detector). Precomputed so
   * the daily-run auditor and tactical agent read the plan's health instead
   * of deriving it. Null for non-held rows or when avgCost/quote is
   * unavailable. See lib/agent/ladder-health.ts.
   */
  ladderHealth: LadderHealth | null;

  /**
   * Plan-sanity flags (System 1 Move 2, DAV-188): the arithmetic that says
   * a WATCHING plan contradicts the live tape — buy level far from the
   * price, target already passed, stop already breached. Plain-language,
   * recomputed against the live quote on every read. Null when clean (or
   * not applicable) so quiet rows cost no tokens. A non-empty value
   * promotes the row into the daily run's FULL work list — a flag the
   * agent never reads is decoration. See lib/agent/plan-sanity.ts.
   */
  planSanity: PlanSanityFlag[] | null;

  /**
   * A holding whose floor would lose more than 1.5% of the account,
   * measured from what we paid (DAV-344): the numbers and the one sentence
   * the run answers. Null when the loss fits, so quiet rows cost nothing.
   * Carried here as well as on needsAction because a fired sale can hold
   * the needsAction slot. See lib/agent/floor-risk.ts.
   */
  floorRisk: FloorRisk | null;

  triggerState: TriggerState;
  /** Human-readable for the agent + UI: e.g. "above $92.50 (now $90.30, -2.4%)". */
  triggerDetail: string | null;

  actionability: Actionability;
  /** Newer thesis id on same ticker when supersession applies. */
  supersededBy: string | null;
  staleness: "FRESH" | "STALE";

  resolvedAt: string;
  /** How old `currentPrice` was when this was resolved, from the time it printed. Null when that time is unknown. */
  quoteAgeMs: number | null;
}

// Minimal row shape the resolver needs. Keeps this module decoupled from
// the Prisma row type — callers pass exactly what's needed.
export interface ResolverThesisInput {
  id: string;
  ticker: string;
  status: string;
  // P1-24 B4: null when the thesis is an unresearched watchlist seed.
  // The resolver doesn't branch on direction, so null is a pure pass-through.
  direction: string | null;
  entryPrice: number | null;
  /** Thesis target price — feeds progress-to-target for HOLDING rows. */
  targetPrice?: number | null;
  /** Thesis stop — feeds the plan-sanity stop-already-breached check. */
  stopLoss?: number | null;
  /**
   * The stock's ordinary daily move (% of price) — feeds the plan-sanity
   * stop-inside-noise check. Callers fetch it batched (getDailyRangePcts)
   * for the rows that need it; absent ⇒ that check is skipped.
   */
  dayRangePct?: number | null;
  /** The stock's ATR(14) from the daily snapshot — widens an atrMultiple trail (DAV-294). */
  atr14?: number | null;
  /** Paired open Position's blended avgCost — feeds P&L for HOLDING rows. */
  avgCost?: number | null;
  /** Paired open Position's share count — with avgCost, the loss at the floor (DAV-344). */
  quantity?: number | null;
  /** The account's equity, for the floor-risk check. Absent ⇒ no check. */
  equity?: number | null;
  /** Chart numbers the floor-risk sentence names (20-day low, averages). */
  structure?: FloorStructure | null;
  /**
   * Paired open Position's water mark (high LONG / low SHORT) — feeds the
   * trail floor math in the ladder-health block. Null when not
   * held / not tracked (falls back to current price).
   */
  peakPrice?: number | null;
  /**
   * When the trigger ladder was last edited (newest CREATED or
   * ladder-touching UPDATED ThesisUpdate row — see isLadderEditUpdate in
   * ladder-health.ts). Null when the caller didn't resolve it; the block
   * then omits daysSinceLadderEdit.
   */
  lastLadderEditAt?: Date | null;
  /** The buy level's moves away from the price, no structure cited (DAV-253). */
  entryRaisesAway?: EntryRaiseAway[] | null;
  /** A fired buy the price has left behind, never bought and never answered (DAV-303). */
  spentBuyCrossing?: SpentBuyCrossing | null;
  triggers: unknown; // Json column; parsed via triggersArraySchema by caller
  catalystDate: Date | null;
  /** The setup the plan is written on — the pre-catalyst parking rule reads it. */
  setupId?: string | null;
  /** The horizon — a CATALYST row with no named setup is a dated binary too. */
  horizon?: string | null;
  createdAt: Date;
  scoring: unknown; // for entryQualityScore surfacing + the composite
  /** The owning analyst's minimum confidence (0–100), for the plan flag. */
  minConfidence?: number | null;
  /** Pre-parsed trigger array — caller invokes triggersArraySchema.safeParse. */
  parsedTriggers: Trigger[];
  /**
   * P1-14 — paired open Position's openedAt, for ACTIVE rows only. Lets
   * a held row measures from when the position opened rather
   * than from the (possibly older) thesis row. Null when not held or the
   * caller didn't resolve a position.
   */
  positionOpenedAt?: Date | null;
  /**
   * The next scheduled report, YYYY-MM-DD, for a stock whose only wake is an
   * inherited review before the report. Null or absent = not known.
   */
  nextReportDate?: string | null;
}

/**
 * Per-ticker supersession lookup. For each ticker present in the main
 * `get_theses` result, the caller queries the newest terminal/PASS row
 * and passes it in. Used to flag older live rows as SUPERSEDED.
 */
export interface SupersessionEntry {
  ticker: string;
  /** Most-recent terminal/PASS thesis id on this (ticker, accountId). */
  terminalId: string;
  terminalCreatedAt: Date;
}

// ── Resolver ──────────────────────────────────────────────────────────

export function buildResolvedEnvelope(args: {
  thesis: ResolverThesisInput;
  currentPrice: number | null;
  /** When `currentPrice` printed (ISO or unix seconds). */
  priceAsOf?: string | number | null;
  /** Most-recent terminal sister thesis on the same ticker, if any. */
  supersession?: SupersessionEntry | null;
  now: Date;
}): ResolvedEnvelope {
  const { thesis, currentPrice, supersession, now } = args;
  const printedAt =
    typeof args.priceAsOf === "number" ? args.priceAsOf * 1000 : args.priceAsOf ? new Date(args.priceAsOf).getTime() : NaN;

  // entryQuality surfaced flat from nested scoring (was buried under
  // scoring.entryQuality.score — primary cause of the "composite hides
  // bottleneck" gap from tonight's ranking exercise).
  const entryQualityScore = extractEntryQualityScore(thesis.scoring);

  // Find the ENTER trigger (one per thesis by writer discipline). Used
  // for triggerState + actionability.
  const enterTrigger = thesis.parsedTriggers.find((t) => t.action === "ENTER");
  const exitTriggers = thesis.parsedTriggers.filter(
    (t) => t.action === "EXIT" || t.action === "TRIM",
  );

  // ── Trigger state (against live price) ────────────────────────────
  let triggerState: TriggerState = "NONE";
  let triggerDetail: string | null = null;

  const evalCtx = {
    latestQuote:
      currentPrice != null && currentPrice > 0
        ? { price: currentPrice, changePct: 0 }
        : undefined,
    thesis: {
      createdAt: thesis.createdAt,
      status: thesis.status,
      positionOpenedAt: thesis.positionOpenedAt ?? null,
    },
    now,
  };

  if (enterTrigger) {
    const fired = currentPrice != null
      ? evaluateTrigger(enterTrigger.predicate, evalCtx)
      : false;
    triggerState = fired ? "ENTER_FIRED" : "ENTER_WAITING";
    triggerDetail = describePredicate(enterTrigger.predicate, currentPrice);
  } else if (
    exitTriggers.length > 0 &&
    (thesis.status === "HOLDING")
  ) {
    // Only relevant for held rows — exit fires drive close decisions.
    const fired = exitTriggers.some(
      (t) =>
        currentPrice != null && evaluateTrigger(t.predicate, evalCtx),
    );
    triggerState = fired ? "EXIT_FIRED" : "NONE";
    triggerDetail = fired
      ? describePredicate(exitTriggers[0].predicate, currentPrice)
      : null;
  }

  // ── Supersession ──────────────────────────────────────────────────
  const isSuperseded =
    supersession != null && supersession.terminalCreatedAt > thesis.createdAt;
  const supersededBy = isSuperseded ? supersession!.terminalId : null;

  // ── Staleness (past catalyst with no resolution) ──────────────────
  // FRESH = catalystDate in future OR null; STALE = catalystDate in past
  // AND no audit-row resolution (latter check deferred to caller — for
  // now treat past-catalyst as STALE; the daily-run can downgrade
  // STALE_PAST_CATALYST → ACTIVE if it resolved the catalyst already).
  const catalystPast =
    thesis.catalystDate != null && thesis.catalystDate.getTime() < now.getTime();
  const staleness: "FRESH" | "STALE" = catalystPast ? "STALE" : "FRESH";

  // ── Actionability decision tree ────────────────────────────────────
  // Order matters. First match wins. See CONVICTION_EXPRESSION.md §6.
  let actionability: Actionability;
  // PASSED (researched-and-declined) is terminal alongside the walk-away
  // ARCHIVED — both resolve to DEAD so the agent/UI skip them as live rows.
  const terminal = ["PASSED", "RETIRED"];
  if (terminal.includes(thesis.status)) {
    actionability = "DEAD";
  } else if (isSuperseded) {
    actionability = "SUPERSEDED";
  } else if (thesis.status === "PROMOTED") {
    // PROMOTED demands resolution today regardless of price proximity or
    // catalyst date — the user already affirmed conviction at promotion,
    // the paper position was force-closed, and the daily run must
    // re-enter / defer / kill in this session. See GAPS P1-10 + the
    // needsAction = PROMOTED_AWAITING_RESOLUTION peer in
    // lib/agent/needs-action.ts (this is the resolver-layer label of
    // the same state).
    actionability = "PROMOTED_DECIDE_TODAY";
  } else if (thesis.status === "HOLDING") {
    actionability = "ACTIVE_HOLD";
  } else if (thesis.catalystDate != null && thesis.catalystDate.getTime() > now.getTime()) {
    actionability = "PENDING_CATALYST";
  } else if (catalystPast) {
    // Past-catalyst with no recent resolution. The caller doesn't tell
    // us about audit rows yet — treat all past-catalyst rows as stale.
    // Future enhancement: check `latestUpdate.timestamp > catalystDate`
    // to flag resolved-but-unactioned vs unaddressed.
    actionability = "STALE_PAST_CATALYST";
  } else if (triggerState === "ENTER_FIRED") {
    actionability = "ENTER_NOW";
  } else {
    // There used to be a second ENTER_NOW branch here: no ENTER trigger and
    // an entry within 1% of the price was read as the writer saying "buy at
    // market". A buy at the price is an ordinary buy trigger now (it fires on
    // the first tick through it), so there is nothing to infer from the
    // distance — the trigger decides. Rows keep their review clock.
    actionability = "WAIT_FOR_TRIGGER";
  }

  // ── P&L on a held row ─────────────────────────────────────────────
  // Gain% and how far along to the target, inline, so the agent doesn't have
  // to join get_portfolio_context by ticker. These two numbers are all that
  // survived winner-signal.ts, which was deleted with the RUNNING_WINNER
  // flag: the flag re-implemented as a morning calculation what the account's
  // "review if up 10% from entry" trigger already does, and fires first in
  // every realistic case. The NUMBERS are still worth showing — an agent that
  // can see "+212%" on a row does not need a flag to find it interesting.
  const winner = holdingPnl(thesis, currentPrice);

  // ── Ladder health (HOLDING rows only — Game Plan PR-B) ────────────
  // Same shared-pure-module pattern as the winner signal above: the
  // UNPROTECTED_GAIN needsAction flag keys off the identical math in
  // needs-action.ts; this surfaces the full block (floor, trail, nearest
  // rung, edit staleness) inline on the row.
  const ladderHealth =
    thesis.status === "HOLDING"
      ? computeLadderHealth({
          direction: thesis.direction,
          avgCost: thesis.avgCost,
          currentPrice,
          peakPrice: thesis.peakPrice ?? null,
          triggers: thesis.parsedTriggers,
          atr14: thesis.atr14 ?? null,
          lastLadderEditAt: thesis.lastLadderEditAt ?? null,
          now,
        })
      : null;

  const planSanityFlags = computePlanSanity({
    status: thesis.status,
    direction: thesis.direction,
    entryPrice: thesis.entryPrice,
    targetPrice: thesis.targetPrice ?? null,
    stopLoss: thesis.stopLoss ?? null,
    currentPrice,
    dayRangePct: thesis.dayRangePct ?? null,
    composite: getThesisComposite({ scoring: thesis.scoring }),
    minConfidence: thesis.minConfidence ?? null,
    lastLadderEditAt: thesis.lastLadderEditAt ?? null,
    entryRaisesAway: thesis.entryRaisesAway ?? null,
    spentBuyCrossing: thesis.spentBuyCrossing ?? null,
    // The stock's own triggers — an inherited analyst or account rule is
    // not a plan for this stock.
    ownTriggerCount: thesis.parsedTriggers.filter((t) => ((t as { level?: string }).level ?? "THESIS") === "THESIS").length,
    // Can this stock ever be bought? The resolved ladder, not the column:
    // `entryPrice` is a read model and an inherited rule is not a plan, but
    // an ENTER trigger anywhere in the cascade genuinely can buy it.
    hasEnterTrigger: thesis.parsedTriggers.some((t) => t.action === "ENTER"),
    // A review of the stock's own on the side a buy would profit (above the
    // price on a LONG) — the wake it is waiting for, the level #737 stopped
    // reading as a target. A review below is a "something broke" line, not
    // a way in (BBIO, EME on 2026-09-29).
    inheritedWakes: inheritedWakes(
      thesis.parsedTriggers,
      thesis.nextReportDate ?? null,
      now.toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
    ),
    hasPriceWake: thesis.parsedTriggers.some(
      (t) =>
        ((t as { level?: string }).level ?? "THESIS") === "THESIS" &&
        t.action === "REVIEW" &&
        isPlanLevel(t, thesis.direction),
    ),
    setupId: thesis.setupId ?? null,
    catalystDate: thesis.catalystDate ?? null,
    horizon: thesis.horizon ?? null,
    now,
  });

  return {
    currentPrice,
    entryQualityScore,
    unrealizedGainPct: winner.unrealizedGainPct,
    progressToTarget: winner.progressToTarget,
    ladderHealth,
    planSanity: planSanityFlags.length > 0 ? planSanityFlags : null,
    floorRisk: ladderHealth
      ? floorTooFar({
          ticker: thesis.ticker,
          direction: thesis.direction,
          avgCost: thesis.avgCost ?? null,
          quantity: thesis.quantity ?? null,
          floorPrice: ladderHealth.floor?.price ?? null,
          equity: thesis.equity ?? null,
          currentPrice,
          structure: thesis.structure ?? null,
        })
      : null,
    triggerState,
    triggerDetail,
    actionability,
    supersededBy,
    staleness,
    resolvedAt: now.toISOString(),
    quoteAgeMs: currentPrice != null && Number.isFinite(printedAt) && printedAt > 0 ? now.getTime() - printedAt : null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

function extractEntryQualityScore(scoring: unknown): number | null {
  if (!scoring || typeof scoring !== "object") return null;
  const s = scoring as Record<string, unknown>;
  const eq = s.entryQuality;
  if (!eq || typeof eq !== "object") return null;
  const score = (eq as { score?: unknown }).score;
  return typeof score === "number" ? score : null;
}

/** The condition in words, and for a typed price how far the price is from it: "above $92.50 (now $90.30, -2.4%)". */
function describePredicate(predicate: unknown, currentPrice: number | null): string {
  const w = shapeOf(predicate);
  if (!w) return "(a removed condition)";
  const text = conditionSentence(w);
  const level = levelOf(w);
  if (!level) return text;
  if (currentPrice == null) return `${text} (no quote)`;
  const gapPct = ((currentPrice - level.value) / level.value) * 100;
  return `${text} (now $${currentPrice.toFixed(2)}, ${gapPct >= 0 ? "+" : ""}${gapPct.toFixed(1)}%)`;
}

// ── Supersession query helper ─────────────────────────────────────────
// Caller (get-theses) provides the list of (ticker, accountId) pairs and
// gets back per-ticker SupersessionEntry. Kept as a pure function over
// already-fetched rows so the query itself stays in get-theses where the
// prisma client + scoping live.

export function buildSupersessionMap(
  /** Terminal/PASS rows on the relevant tickers, sorted DESC by createdAt. */
  terminalRows: Array<{ ticker: string; id: string; createdAt: Date }>,
): Map<string, SupersessionEntry> {
  const byTicker = new Map<string, SupersessionEntry>();
  for (const r of terminalRows) {
    const existing = byTicker.get(r.ticker);
    if (!existing || existing.terminalCreatedAt < r.createdAt) {
      byTicker.set(r.ticker, {
        ticker: r.ticker,
        terminalId: r.id,
        terminalCreatedAt: r.createdAt,
      });
    }
  }
  return byTicker;
}

/**
 * Gain % and progress-to-target for a held row. Both null when the inputs
 * can't support the math (not held, no fill price, no live quote).
 *
 * `progressToTarget` is the fraction of the entry→target distance covered:
 * 0 at entry, 1 at target, >1 past it. Null when the target sits on the wrong
 * side of entry, because the distance is then meaningless rather than zero.
 */
function holdingPnl(
  thesis: { status: string | null; direction: string | null; avgCost?: number | null; targetPrice?: number | null },
  currentPrice: number | null,
): { unrealizedGainPct: number | null; progressToTarget: number | null } {
  const none = { unrealizedGainPct: null, progressToTarget: null };
  const { avgCost, targetPrice } = thesis;
  if (thesis.status !== "HOLDING") return none;
  if (avgCost == null || avgCost <= 0) return none;
  if (currentPrice == null || currentPrice <= 0) return none;

  const short = thesis.direction === "SHORT";
  const gained = short ? avgCost - currentPrice : currentPrice - avgCost;
  const distance =
    targetPrice != null && targetPrice > 0
      ? short
        ? avgCost - targetPrice
        : targetPrice - avgCost
      : null;

  return {
    unrealizedGainPct: (gained / avgCost) * 100,
    progressToTarget: distance != null && distance > 0 ? gained / distance : null,
  };
}
