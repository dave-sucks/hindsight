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

import type { Trigger } from "@/lib/agent/triggers/types";
import { evaluateTrigger } from "@/lib/agent/triggers/evaluate";
import { computeLadderHealth, type LadderHealth } from "@/lib/agent/ladder-health";
import { computePlanSanity, type PlanSanityFlag } from "@/lib/agent/plan-sanity";

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

  triggerState: TriggerState;
  /** Human-readable for the agent + UI: e.g. "PRICE_ABOVE 92.5 (cur 90.30, -2.4%)". */
  triggerDetail: string | null;

  actionability: Actionability;
  /** Newer thesis id on same ticker when supersession applies. */
  supersededBy: string | null;
  staleness: "FRESH" | "STALE";

  resolvedAt: string;
  /** 0 if live; up to cache TTL otherwise. Currently always 0 — no cache yet. */
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
  /** Paired open Position's blended avgCost — feeds P&L for HOLDING rows. */
  avgCost?: number | null;
  /**
   * Paired open Position's water mark (high LONG / low SHORT) — feeds the
   * TRAILING_FROM_HIGH floor math in the ladder-health block. Null when not
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
  triggers: unknown; // Json column; parsed via triggersArraySchema by caller
  catalystDate: Date | null;
  createdAt: Date;
  scoring: unknown; // for entryQualityScore surfacing
  /** Pre-parsed trigger array — caller invokes triggersArraySchema.safeParse. */
  parsedTriggers: Trigger[];
  /**
   * P1-14 — paired open Position's openedAt, for ACTIVE rows only. Lets
   * TIME_ELAPSED measure "max hold" from when the position opened rather
   * than from the (possibly older) thesis row. Null when not held or the
   * caller didn't resolve a position.
   */
  positionOpenedAt?: Date | null;
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
  /** Most-recent terminal sister thesis on the same ticker, if any. */
  supersession?: SupersessionEntry | null;
  now: Date;
}): ResolvedEnvelope {
  const { thesis, currentPrice, supersession, now } = args;

  // entryQuality surfaced flat from nested scoring (was buried under
  // scoring.entryQuality.score — primary cause of the "composite hides
  // bottleneck" gap from tonight's ranking exercise).
  const entryQualityScore = extractEntryQualityScore(thesis.scoring);

  // Find the ENTER trigger (one per thesis by writer discipline). Used
  // for triggerState + actionability.
  const enterTrigger = thesis.parsedTriggers.find((t) => t.action === "ENTER");
  const exitTriggers = thesis.parsedTriggers.filter(
    (t) => t.action === "EXIT" || t.action === "TRIM" || t.action === "MOVE_STOP",
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
      // P1-14: ACTIVE rows anchor TIME_ELAPSED to the position open time.
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
  } else if (
    !enterTrigger &&
    thesis.entryPrice != null &&
    currentPrice != null &&
    Math.abs(currentPrice - thesis.entryPrice) / thesis.entryPrice <= 0.01
  ) {
    // "Buy now" case — no ENTER trigger AND entry ≈ current price.
    // The writer is saying "buy at market" via the trigger structure.
    actionability = "ENTER_NOW";
  } else {
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
  });

  return {
    currentPrice,
    entryQualityScore,
    unrealizedGainPct: winner.unrealizedGainPct,
    progressToTarget: winner.progressToTarget,
    ladderHealth,
    planSanity: planSanityFlags.length > 0 ? planSanityFlags : null,
    triggerState,
    triggerDetail,
    actionability,
    supersededBy,
    staleness,
    resolvedAt: now.toISOString(),
    quoteAgeMs: currentPrice != null ? 0 : null,
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

function describePredicate(
  predicate: unknown,
  currentPrice: number | null,
): string {
  if (!predicate || typeof predicate !== "object") return "(unknown predicate)";
  const p = predicate as { kind?: string; level?: number };
  switch (p.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW": {
      const level = p.level;
      if (typeof level !== "number") return p.kind;
      if (currentPrice == null) return `${p.kind} ${level} (no quote)`;
      const gapPct = ((currentPrice - level) / level) * 100;
      const sign = gapPct >= 0 ? "+" : "";
      return `${p.kind} ${level} (cur ${currentPrice.toFixed(2)}, ${sign}${gapPct.toFixed(1)}%)`;
    }
    case "EARNINGS_BEAT":
    case "EARNINGS_MISS":
    case "GUIDANCE_CHANGE":
    case "FILING":
    case "SIGNAL_TYPE":
      return `${p.kind} (event-driven; fires on signal)`;
    case "TIME_ELAPSED": {
      const days = (predicate as { days?: number }).days;
      return `TIME_ELAPSED ${days ?? "?"}d`;
    }
    default:
      return p.kind ?? "(unknown)";
  }
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
