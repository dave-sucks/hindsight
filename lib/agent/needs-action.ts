/**
 * `needsAction` — the per-thesis annotation get_theses puts on every row
 * so the daily-run agent doesn't have to cross-reference five different
 * prompt blocks to figure out what needs attention today.
 *
 * Six kinds. Three are trigger-driven (FIRED / MATCHING_NOW / REVIEW_DUE);
 * PROMOTED is status-driven (any PROMOTED thesis ALWAYS requires resolution
 * this run); UNPROTECTED_GAIN and RUNNING_WINNER are position-P&L-driven
 * (a held winner whose floor doesn't reflect its gain, and a held winner
 * that reached its target's decision point with no trigger set to catch it).
 *
 *   PROMOTED_AWAITING_RESOLUTION — thesis.status === "PROMOTED".
 *                         The user explicitly graduated this analyst to
 *                         live money and the paper position was force-
 *                         closed at promotion. The daily run must decide
 *                         today: re-enter (place_trade) / defer (update_
 *                         thesis change_status: WATCHING) / kill (when
 *                         tool gates allow). Highest precedence — fires
 *                         regardless of other trigger state.
 *   TRIGGER_FIRED       — there is a TRIGGER_FIRED ThesisUpdate row on
 *                         this thesis with no UPDATED/REVIEWED/CLOSED/
 *                         INVALIDATED follow-up newer than it. The
 *                         trigger evaluator already determined the
 *                         predicate matched; tactical-run either hasn't
 *                         spawned yet or didn't close out.
 *   TRIGGER_MATCHING_NOW — server-side `shouldFire` evaluation against
 *                         the fresh quote says one of the thesis's
 *                         price/time-side predicates is currently true.
 *                         Catches matches the cron may not have
 *                         delivered yet.
 *   UNPROTECTED_GAIN    — a HOLDING whose cumulative gain is meaningfully
 *                         above what its tightest protective EXIT rung locks
 *                         in: gain ≥ 8% AND (gain − flooredGain) ≥ 6pts, a
 *                         missing floor counting as −infinity. The IONS
 *                         detector (Game Plan PR-B): a +17% position with a
 *                         day-one floor at −12% is flagged every single
 *                         morning until the floor is raised. See
 *                         docs/plans/THESIS_GAME_PLAN.md + ladder-health.ts.
 *   (RUNNING_WINNER was removed 2026-08-25 — the account trigger fires first.
 *                         entry (avgCost) to its target (or blown past it),
 *                         up ≥8%, with no fired/matching trigger already
 *                         catching it. The backstop for the "agent ignores
 *                         winners" gap: an un-laddered winner near its target
 *                         would otherwise resolve to needsAction=null and be
 *                         skipped. Surfaces it as a press/hold/take decision.
 *                         See docs/plans/SCALE_INTO_WINNERS.md + winner-signal.ts.
 *   REVIEW_DUE          — the review cadence (counted from lastReviewedAt)
 *                         elapses within the next 24h (i.e. due today or
 *                         already overdue). Look-ahead window covers
 *                         reviews scheduled for later in the same trading
 *                         day — without it, a thesis coming due at
 *                         today 09:30 ET would be
 *                         skipped by the 08:00 ET morning daily-run
 *                         ("not yet due"), then fire the REVIEW_DATE_HIT
 *                         trigger 90 min later, spawning a tactical run
 *                         that did the same work. 24h is wide enough to
 *                         catch same-day reviews regardless of when the
 *                         agent scheduled them; weekend gaps get caught
 *                         as overdue on the following Monday's daily
 *                         run.
 *
 * Precedence when multiple match:
 *   PROMOTED_AWAITING_RESOLUTION > TRIGGER_FIRED > TRIGGER_MATCHING_NOW >
 *   UNPROTECTED_GAIN > RUNNING_WINNER > REVIEW_DUE
 * (An explicit fired/matching trigger — a stop, a target-EXIT — outranks both
 * P&L flags: it's more specific, and if the protection itself is firing the
 * fire IS the work item. UNPROTECTED_GAIN outranks RUNNING_WINNER because
 * locking the downside precedes pressing the upside — the two often coincide
 * on the same big winner, and floor-first ordering means the agent fixes the
 * ladder now; once the floor reflects the gain the flag self-clears and the
 * press/hold/take decision surfaces on the next read. Both outrank a routine
 * review because they tell the agent WHY to look.)
 *
 * A thesis with no PROMOTED status, no fires, no matches, and a review
 * not yet due returns `null` — yesterday's thesis stands and the agent
 * doesn't need to touch it.
 *
 * Pure function. Caller supplies all data; no DB, no clock, no fetches.
 */

import { shouldFire } from "@/lib/agent/triggers/evaluate";
import { isUnresearchedSeed } from "@/lib/agent/thesis-direction";
import { computeLadderHealth } from "@/lib/agent/ladder-health";
import type { Trigger, TriggerPredicate } from "@/lib/agent/triggers/types";
import { classifyResearchAge } from "@/lib/agent/thesis-research/staleness";
import type { Horizon as StalenessHorizon } from "@/lib/agent/horizon-policy";

// ─── Public types ─────────────────────────────────────────────────────────────

export type NeedsActionVerb =
  | "ENTER"
  | "EXIT"
  | "REVIEW"
  | "ADD"
  | "TRIM"
  | "MOVE_STOP";

export type NeedsAction =
  | {
      kind: "PROMOTED_AWAITING_RESOLUTION";
      /**
       * Conviction-context fields frozen on the thesis row at promotion
       * time, surfaced here so the agent has the doubled-conviction
       * signal at the same point it decides re-enter vs defer vs kill.
       * Nullable because pre-PR-#330 PROMOTED rows may lack these
       * fields; in that case the agent should still resolve the status
       * but won't have paper-tenure / P&L context.
       */
      paperTenureDays?: number | null;
      paperRealizedPnl?: number | null;
      paperReviewCount?: number | null;
      promotedAt?: string | null;
    }
  | {
      kind: "TRIGGER_FIRED";
      triggerId: string;
      action: NeedsActionVerb;
      summary: string;
      firedAt: string;
    }
  | {
      kind: "TRIGGER_MATCHING_NOW";
      triggerId: string;
      action: NeedsActionVerb;
      predicateSummary: string;
      livePrice: number | null;
    }
  | {
      kind: "UNPROTECTED_GAIN";
      /** Unrealized gain %, direction-aware. */
      unrealizedGainPct: number;
      /**
       * % gain locked in by the tightest protective EXIT rung (negative =
       * floor is BELOW entry). Null = NO protective EXIT rung at all.
       */
      flooredGainPct: number | null;
      /** gainPct − flooredGainPct. Null when there is no floor (unbounded). */
      unprotectedGapPct: number | null;
      /** True when a TRAILING_FROM_HIGH EXIT rung exists. */
      hasTrail: boolean;
      /** Compact description of the tightest floor, e.g. "price < $65.00". */
      floorSummary: string | null;
    }
  | {
      /**
       * The deep research behind this thesis is older than its threshold.
       *
       * Why this is a work-list flag and not just a label: `researchAge`
       * has ridden along on every thesis row since P1-1, but only the
       * REVIEW_DUE branch of the prompt ever consulted it — so a name whose
       * review clock wasn't due carried "stale" silently. GD, GEV and VST
       * sat at 80 days with a 30-day clock last reviewed 2026-08-28: the
       * label said stale, and nothing was going to look until 2026-09-27.
       *
       * Same shape as UNPROTECTED_GAIN: computed, not a trigger. Neither
       * one needs to be a trigger to earn the agent's attention — a flag on
       * a row nobody opens is decoration.
       */
      kind: "RESEARCH_STALE";
      /** Whole days since the research was last written. Null = never written. */
      daysOld: number | null;
      /** The threshold it broke, in days. */
      threshold: number | null;
      /** "stale" (past the threshold) or "missing" (no deep research at all). */
      freshness: "stale" | "missing";
    }
  | {
      kind: "REVIEW_DUE";
      daysOverdue: number;
      /**
       * True when this is a PENDING thesis's first review — user/builder/
       * editor seeded the ticker and the agent hasn't researched it yet.
       * UI renders "Awaiting first research" instead of "Review overdue."
       */
      pendingFirstReview?: boolean;
    };

// ─── Predicate-side filters ──────────────────────────────────────────────────
// Mirror of trigger-evaluator's isPriceSidePredicate. A price-side
// predicate evaluates against a quote alone; a signal-side predicate
// needs a signal payload and we don't have one in this context, so we
// can't evaluate them inline at run-start. (Signal-side fires already
// arrive via the TRIGGER_FIRED audit row path.)

const PRICE_OR_TIME_KINDS = new Set([
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "PRICE_MOVE_PCT",
  "GAIN_FROM_ENTRY",
  "TRAILING_FROM_HIGH",
  "VS_SMA",
  "RSI",
  "TIME_ELAPSED",
  // REVIEW_CADENCE is deliberately NOT here: it has its own needsAction
  // kind (REVIEW_DUE) with a 24h look-ahead the generic loop can't express,
  // and routing it through TRIGGER_MATCHING_NOW would relabel every routine
  // review as an urgent trigger fire.
]);

function isPriceOrTimePredicate(p: TriggerPredicate): boolean {
  if (PRICE_OR_TIME_KINDS.has(p.kind)) return true;
  if (p.kind === "AND" || p.kind === "OR") {
    return p.predicates.every(isPriceOrTimePredicate);
  }
  return false;
}

// ─── Predicate description (compact one-liner for the prompt) ───────────────

export function describePredicate(p: TriggerPredicate): string {
  switch (p.kind) {
    case "PRICE_BELOW":
      return `price < $${p.level}`;
    case "PRICE_ABOVE":
      return `price > $${p.level}`;
    case "PRICE_MOVE_PCT":
      return `${p.direction === "UP" ? "+" : "−"}${p.pct}% over ${p.window}`;
    case "GAIN_FROM_ENTRY":
      return `${p.direction === "UP" ? "up" : "down"} ${p.pct}% from entry`;
    case "TRAILING_FROM_HIGH":
      return `gives back ${p.pct}% from the high`;
    case "VS_SMA":
      return `${p.direction.toLowerCase()} ${p.period}-day SMA`;
    case "RSI":
      return `RSI ${p.direction.toLowerCase()} ${p.threshold}`;
    case "TIME_ELAPSED":
      return `${p.days}d elapsed since thesis creation`;
    case "REVIEW_CADENCE":
      return `due for review (every ${p.days}d)`;
    case "SIGNAL_TYPE":
      return `${p.signalType} signal${p.sentiment ? ` (${p.sentiment.toLowerCase()})` : ""}`;
    case "EARNINGS_BEAT":
      return `earnings beat${p.minSurprisePct ? ` ≥ ${p.minSurprisePct}%` : ""}`;
    case "EARNINGS_MISS":
      return `earnings miss${p.minSurprisePct ? ` ≥ ${p.minSurprisePct}%` : ""}`;
    case "GUIDANCE_CHANGE":
      return `guidance ${p.direction.toLowerCase()}`;
    case "FILING":
      return `${p.formType} filing`;
    case "AND":
      return `(${p.predicates.map(describePredicate).join(" AND ")})`;
    case "OR":
      return `(${p.predicates.map(describePredicate).join(" OR ")})`;
  }
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface NeedsActionInput {
  thesis: {
    id: string;
    /**
     * Direction is needed so unresearched seeds (user/builder/editor adds
     * awaiting first research) surface as REVIEW_DUE with the
     * `pendingFirstReview` discriminator. P1-24 B4: a seed is direction=null
     * (new) or 'PENDING' (legacy) — both must set pendingFirstReview.
     */
    direction?: string | null;
    /**
     * Status drives PROMOTED_AWAITING_RESOLUTION at top precedence —
     * any PROMOTED-status thesis ALWAYS needs resolution this run
     * regardless of trigger state. The promotion was the explicit
     * "deploy real money on this name" decision; the next daily run
     * after promotion has to either execute it (place_trade) or
     * defer it explicitly (update_thesis change_status: WATCHING).
     */
    status?: string;
    triggers: Trigger[];
    createdAt: Date;
    /** When an analyst last actually looked. Drives the review cadence. */
    lastReviewedAt?: Date | null;
    /**
     * When the deep research behind this thesis was last WRITTEN — not when
     * someone last glanced at it. Drives RESEARCH_STALE. Omit and the flag
     * simply never fires (callers that can't select the column keep their
     * old behavior).
     */
    researchUpdatedAt?: Date | null;
    /** Horizon picks the staleness threshold. Null falls back to the conservative default. */
    horizon?: string | null;
    /**
     * P1-14 — paired open Position's openedAt, for ACTIVE rows only. Lets
     * the TRIGGER_MATCHING_NOW evaluation anchor TIME_ELAPSED to when the
     * position opened rather than the (older) thesis row. Null when not
     * held or the caller didn't resolve a position.
     */
    positionOpenedAt?: Date | null;
    /**
     * Paired open Position's blended avgCost + the thesis target price, for
     * HOLDING rows only. Feed the RUNNING_WINNER computation (progress-to-
     * target + unrealized gain). Null when not held, no target, or the caller
     * didn't resolve a position. See lib/agent/winner-signal.ts.
     */
    avgCost?: number | null;
    targetPrice?: number | null;
    /**
     * Paired open Position's water mark (high LONG / low SHORT), maintained
     * hourly by the price monitor. Feeds the TRAILING_FROM_HIGH floor math
     * in the UNPROTECTED_GAIN computation. Null when not held / not tracked
     * — ladder-health falls back to the current price.
     */
    peakPrice?: number | null;
    /**
     * Conviction context, frozen at promotion time. Surfaced into the
     * PROMOTED_AWAITING_RESOLUTION needsAction so the agent has the
     * doubled-conviction signal next to the decision. Null on
     * non-PROMOTED rows + pre-PR-#330 PROMOTED rows.
     */
    paperTenureDays?: number | null;
    paperRealizedPnl?: number | null;
    paperReviewCount?: number | null;
    promotedAt?: Date | null;
  };
  /** Most recent ThesisUpdate row for this thesis, if any. */
  latestUpdate?: {
    type: string;
    triggerId?: string | null;
    timestamp: Date;
  } | null;
  /** Fresh quote — null when we couldn't fetch one for the ticker. */
  latestQuote?: { price: number; changePct: number } | null;
  /** Caller-supplied `now` keeps the function pure and testable. */
  now: Date;
  /**
   * P1-25 Change 4 — true when this analyst has a pending buy proposal on the
   * thesis's ticker (Position.status='PENDING_APPROVAL'). Suppresses ENTER
   * needsAction: the entry is already proposed, so re-flagging it would make
   * the agent re-attempt place_trade (rejected by the dedup guard) and nag
   * complete_run. Non-ENTER triggers and REVIEW_DUE still surface.
   */
  hasPendingEntryProposal?: boolean;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function computeNeedsAction(
  input: NeedsActionInput,
): NeedsAction | null {
  const { thesis, latestUpdate, latestQuote, now, hasPendingEntryProposal } =
    input;

  // 0) PROMOTED_AWAITING_RESOLUTION — highest precedence. Any PROMOTED
  //    thesis ALWAYS needs resolution this run regardless of trigger
  //    state. The user explicitly graduated this analyst to live money
  //    and the paper position was force-closed at promotion; the next
  //    daily run after promotion has to either re-enter (place_trade),
  //    defer (update_thesis change_status: WATCHING), or kill (where
  //    tool gates allow). Surfaces conviction context for the agent to
  //    weigh in the decision.
  if (thesis.status === "PROMOTED") {
    return {
      kind: "PROMOTED_AWAITING_RESOLUTION",
      paperTenureDays: thesis.paperTenureDays ?? null,
      paperRealizedPnl: thesis.paperRealizedPnl ?? null,
      paperReviewCount: thesis.paperReviewCount ?? null,
      promotedAt: thesis.promotedAt ? thesis.promotedAt.toISOString() : null,
    };
  }

  // 1) TRIGGER_FIRED — most recent update is a fire that hasn't been
  //    answered by the agent. Tactical-run writes its UPDATED/REVIEWED/
  //    CLOSED/INVALIDATED row at completion, so seeing TRIGGER_FIRED at
  //    the top of the stack means the fire is still open work.
  if (latestUpdate?.type === "TRIGGER_FIRED" && latestUpdate.triggerId) {
    const t = thesis.triggers.find((x) => x.id === latestUpdate.triggerId);
    const action = (t?.action as NeedsActionVerb) ?? "REVIEW";
    // P1-25 Change 4: a pending buy proposal already expresses the ENTER —
    // don't re-flag it (the agent would re-attempt place_trade and hit the
    // PENDING_APPROVAL dedup guard). Fall through; non-ENTER work still surfaces.
    if (!(hasPendingEntryProposal && action === "ENTER")) {
      return {
        kind: "TRIGGER_FIRED",
        triggerId: latestUpdate.triggerId,
        action,
        summary: t ? describePredicate(t.predicate) : "(predicate removed)",
        firedAt: latestUpdate.timestamp.toISOString(),
      };
    }
  }

  // 2) TRIGGER_MATCHING_NOW — server-side eval against the fresh quote
  //    + time-based predicates. Same `shouldFire` the trigger evaluator
  //    runs every 5 minutes; we just want the run-start snapshot too.
  //    Cooldown gating respected — a match within the cooldown window
  //    returns false from shouldFire, which is correct (the cron will
  //    re-fire when cooldown expires).
  for (const trigger of thesis.triggers) {
    if (!isPriceOrTimePredicate(trigger.predicate)) continue;
    const result = shouldFire(trigger, {
      latestQuote: latestQuote ?? undefined,
      thesis: {
        createdAt: thesis.createdAt,
        lastReviewedAt: thesis.lastReviewedAt ?? null,
        // P1-14: ACTIVE rows anchor TIME_ELAPSED to the position open time.
        status: thesis.status,
        positionOpenedAt: thesis.positionOpenedAt ?? null,
      },
      now,
    });
    if (result.fires) {
      const action = (trigger.action as NeedsActionVerb) ?? "REVIEW";
      // P1-25 Change 4: suppress ENTER while a buy proposal is pending.
      if (hasPendingEntryProposal && action === "ENTER") continue;
      return {
        kind: "TRIGGER_MATCHING_NOW",
        triggerId: trigger.id,
        action,
        predicateSummary: describePredicate(trigger.predicate),
        livePrice: latestQuote?.price ?? null,
      };
    }
  }

  // 3) UNPROTECTED_GAIN — the IONS detector (Game Plan PR-B). A held winner
  //    whose cumulative gain is meaningfully above what the tightest
  //    protective EXIT rung locks in: the floor a thesis was born with
  //    reflects entry-day information forever unless something forces an
  //    update. Slotted below the explicit trigger paths (a fired/matching
  //    trigger — often the floor itself firing — is the more specific work
  //    item) and ABOVE RUNNING_WINNER: both flags frequently coincide on the
  //    same big winner, and locking the downside precedes pressing the
  //    upside — once the agent raises the floor this flag self-clears and
  //    the press/hold/take decision surfaces on the next read. HOLDING only;
  //    needs avgCost + a live quote (graceful null degradation otherwise).
  if (thesis.status === "HOLDING") {
    const ladder = computeLadderHealth({
      direction: thesis.direction,
      avgCost: thesis.avgCost,
      currentPrice: latestQuote?.price ?? null,
      peakPrice: thesis.peakPrice ?? null,
      triggers: thesis.triggers,
      lastLadderEditAt: null, // not needed for the flag; surfaced via get_theses
      now,
    });
    if (ladder?.isUnprotectedGain) {
      return {
        kind: "UNPROTECTED_GAIN",
        unrealizedGainPct: ladder.gainPct,
        flooredGainPct: ladder.flooredGainPct,
        unprotectedGapPct: ladder.unprotectedGapPct,
        hasTrail: ladder.hasTrail,
        floorSummary: ladder.floor?.label ?? null,
      };
    }
  }

  // RUNNING_WINNER was here, and is deleted (DAV-195 L8).
  //
  // It flagged a held position at >=75% of the way to target, or up >=12%.
  // The account already carries "review if up 10% from entry", which fires
  // FIRST in every realistic case: at a +30% target, 75% progress is +22.5%,
  // long past the 10% checkpoint. The only window where the flag fired and
  // the trigger did not was a target under ~13% total — which is exactly what
  // its own MIN_GAIN floor was added to suppress. It was a trigger
  // re-implemented as a morning calculation, permanently second.
  //
  // What replaced it is not another flag: resolved.unrealizedGainPct and
  // resolved.progressToTarget sit on every held row the agent reads, so a
  // stock up 212% is visible without anything pre-deciding that it matters.

  // 5) REVIEW_DUE — the review cadence elapsed OR coming due within the
  //    next 24h. The 24h look-ahead is load-bearing: the morning daily-run
  //    fires once at 08:00 ET, but a review can come due at 09:30 ET
  //    (market open) the same day. Without look-ahead the morning agent
  //    skips today's-09:30 review as "future," then the trigger
  //    evaluator's cron fires 90 min later and spawns a redundant
  //    tactical run to do the same work. With look-ahead, the morning
  //    agent catches it upfront. See lib/agent/triggers/defaults.ts
  //    header comment for the matching half (REVIEW_DATE_HIT removed
  //    from watching defaults).
  //
  //    Special case: unresearched seeds (user/builder/editor adds, direction
  //    null or legacy 'PENDING') carry a 7-day cadence trigger from mint and
  //    a null lastReviewedAt (falls back to createdAt), so they surface as
  //    REVIEW_DUE within a week with the pendingFirstReview discriminator.
  // The cadence trigger on the resolved ladder is the authority — "review
  // every N days", counted from the last actual review. It used to be a date
  // column the agent set by hand, which was a second store of the same idea
  // and the one nothing fired on.
  //
  // The 24h look-ahead is load-bearing and is why this doesn't just go
  // through the generic trigger loop: the morning run fires once at 08:00,
  // so a review coming due later today has to be caught now or it waits a
  // whole day.
  const REVIEW_DUE_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
  const cadence = thesis.triggers.find(
    (t) => t.predicate.kind === "REVIEW_CADENCE",
  );
  if (cadence?.predicate.kind === "REVIEW_CADENCE") {
    const lastLooked = thesis.lastReviewedAt ?? thesis.createdAt;
    const dueAt = lastLooked.getTime() + cadence.predicate.days * 86_400_000;
    if (dueAt <= now.getTime() + REVIEW_DUE_LOOKAHEAD_MS) {
      // Clamp negative ("due later today") to 0 so the UI reads "due today"
      // rather than "-1 days overdue".
      const daysOverdue = Math.max(
        0,
        Math.floor((now.getTime() - dueAt) / 86_400_000),
      );
      const result: NeedsAction = { kind: "REVIEW_DUE", daysOverdue };
      // A seed has no committed view yet — route it to "commit a direction".
      if (isUnresearchedSeed(thesis.direction)) result.pendingFirstReview = true;
      return result;
    }
  }

  // 5) RESEARCH_STALE — the thesis is not due for review, but the work
  //    behind it is old enough that acting on it would mean acting on
  //    stale reasoning.
  //
  //    Lowest precedence deliberately: it runs only after REVIEW_DUE has
  //    declined, because a due review already carries the staleness
  //    instruction in the prompt. This branch catches the gap that used to
  //    swallow it — a long clock (a compounder's 30 days) outliving the
  //    research threshold, so "stale" was true for weeks with nothing
  //    scheduled to look. Terminal rows are history and never flagged.
  if (
    thesis.researchUpdatedAt !== undefined &&
    (thesis.status === "WATCHING" || thesis.status === "HOLDING")
  ) {
    const age = classifyResearchAge(
      thesis.researchUpdatedAt,
      (thesis.horizon ?? null) as StalenessHorizon | null,
      thesis.status,
    );
    if (age.freshness === "stale" || age.freshness === "missing") {
      return {
        kind: "RESEARCH_STALE",
        daysOld: age.daysOld,
        threshold: age.horizonThreshold,
        freshness: age.freshness,
      };
    }
  }

  // Nothing to act on. Yesterday's thesis stands.
  return null;
}
