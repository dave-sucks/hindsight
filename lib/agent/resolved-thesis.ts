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
  direction: string;
  entryPrice: number | null;
  triggers: unknown; // Json column; parsed via triggersArraySchema by caller
  catalystDate: Date | null;
  createdAt: Date;
  nextReviewAt: Date | null;
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
      nextReviewAt: thesis.nextReviewAt,
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
    (thesis.status === "ACTIVE" || thesis.status === "HOLDING")
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
  const terminal = ["INVALIDATED", "ARCHIVED", "CLOSED", "PASSED", "RETIRED"];
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
  } else if (thesis.status === "ACTIVE" || thesis.status === "HOLDING") {
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

  return {
    currentPrice,
    entryQualityScore,
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
