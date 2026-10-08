/**
 * The work-list flag: the one lead reason a stock shows today, and each kind
 * on its own (moved from lib/agent/needs-action.ts). The situations module
 * (./index.ts) reads every kind for the situations a stock is in, and takes
 * its lead from `leadFlag`. A situation's `data.flag` carries one of these,
 * unchanged in shape, for the sheet header and complete_run.
 *
 * Eight kinds, in the order `leadFlag` ranks them:
 *
 *   PROMOTED_AWAITING_RESOLUTION — the thesis is PROMOTED: the next run must
 *                         re-enter it, defer it or kill it.
 *   SALE_DECLINED       — the principal declined a protective sale and the
 *                         price is still past the line (DAV-315).
 *   TRIGGER_FIRED       — a trigger fired after the newest line an agent
 *                         wrote on this thesis (stock-context.ts
 *                         `openFires`). The principal's edits, proposal
 *                         decisions and the app's bookkeeping do not answer
 *                         a fire; only a run's own line does. When several
 *                         fired, the lead is the one that moves money (not a
 *                         REVIEW) and the rest ride along in `alsoFired`.
 *   TRIGGER_MATCHING_NOW — `shouldFire` against the fresh quote says one of
 *                         the thesis's price- or time-side triggers is true
 *                         now; the first in ladder order.
 *   FLOOR_TOO_FAR       — a holding whose floor would lose more than 1.5% of
 *                         the account (DAV-344).
 *   UNPROTECTED_GAIN    — a holding whose gain is meaningfully above what its
 *                         tightest protective EXIT locks in: gain ≥ 8% AND
 *                         (gain − flooredGain) ≥ 6pts, a missing floor
 *                         counting as −infinity. See ladder-health.ts.
 *   REVIEW_DUE          — the review clock (counted from lastReviewedAt)
 *                         comes due within the next 24h.
 *   RESEARCH_STALE      — the deep research behind a committed view is past
 *                         its horizon's threshold, or missing.
 *
 * The order is not a fixed rank of kinds. A floor too far outranks a fired or
 * matching REVIEW but not a fire or match that moves money; a fire outranks a
 * match of any action. So a floor too far beats a fired review, a fired review
 * beats a sale true now, and a sale true now beats a floor too far.
 *
 * A thesis with no PROMOTED status, no fires, no matches, and a review not yet
 * due has no flag: yesterday's thesis stands.
 *
 * Pure. Caller supplies all data; no DB, no clock, no fetches.
 */

import { shouldFire } from "@/lib/agent/triggers/evaluate";
import { isMarketOpen } from "@/lib/market-hours";
import { isUnresearchedSeed } from "@/lib/agent/thesis-direction";
import { computeLadderHealth, type LadderHealth } from "@/lib/agent/ladder-health";
import { floorTooFar, type FloorStructure } from "@/lib/agent/floor-risk";
import type { Trigger } from "@/lib/agent/triggers/types";
import { readsTheTape, reviewClockDays, sentenceOf, shapeOf } from "@/lib/agent/triggers/condition";
import { classifyResearchAge } from "@/lib/agent/thesis-research/staleness";
import type { DeclinedSaleWork } from "@/lib/agent/declined-sale";
import { fireStreak, type FireStreakUpdate } from "@/lib/agent/fire-streak";
import { openFires, type ActivityRow, type OpenFire } from "@/lib/agent/stock-context";
import type { Horizon as StalenessHorizon } from "@/lib/agent/horizon-policy";
import type { When } from "@/lib/agent/triggers/condition";

// ─── Public types ─────────────────────────────────────────────────────────────

export type WorkFlagVerb =
  | "ENTER"
  | "EXIT"
  | "REVIEW"
  | "ADD"
  | "TRIM";

export type WorkFlag =
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
      /**
       * The principal declined (or let expire) a protective sale, the price
       * is still past the line, and no run has answered it (DAV-315).
       *
       * Ranks ABOVE the trigger kinds deliberately. The floor is a standing
       * order, so while the breach persists TRIGGER_FIRED or
       * TRIGGER_MATCHING_NOW is true every single day and would win the
       * precedence race — which is exactly what happened to IOT for nine
       * days. "This fired and you said no" is the more specific, and more
       * useful, statement of the same situation.
       */
      kind: "SALE_DECLINED";
      declineCount: number;
      lastDeclinedAt: string;
      /** The principal's own words, verbatim. */
      rejectMessage: string | null;
      floorPrice: number | null;
      recentLow: number | null;
    }
  | {
      kind: "TRIGGER_FIRED";
      triggerId: string;
      action: WorkFlagVerb;
      summary: string;
      firedAt: string;
      /**
       * How many times this rung has fired since the plan last changed,
       * and when that was (DAV-323). Absent on a first ask, and absent
       * when the caller passed no history. ABT's "below the 200-day →
       * review" reached its ninth fire indistinguishable from its first;
       * `repeatLine` is that sentence, ready to print. An input, not a bar.
       */
      repeatCount?: number;
      unchangedSince?: string | null;
      repeatLine?: string;
      /**
       * Every other trigger that fired since the last agent answer. CEG on
       * 2026-09-18 had three open (the 200-day, 15% off the high, 8% under
       * what we paid) and the run was shown one; the other two are these.
       */
      alsoFired?: Array<{
        triggerId: string;
        action: WorkFlagVerb;
        summary: string;
        count: number;
        lastAt: string;
      }>;
    }
  | {
      kind: "TRIGGER_MATCHING_NOW";
      triggerId: string;
      action: WorkFlagVerb;
      predicateSummary: string;
      livePrice: number | null;
    }
  | {
      /**
       * A holding whose floor would lose more than 1.5% of the account,
       * measured from what we paid (DAV-344). Every field is on the line;
       * the numbers ride along for the UI. See ./floor-risk.
       */
      kind: "FLOOR_TOO_FAR";
      floorPrice: number;
      avgCost: number;
      quantity: number;
      lossAtFloor: number;
      pctOfAccount: number;
      structureBelow: Array<{ label: string; price: number }>;
      line: string;
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
      /** True when a trail EXIT rung exists. */
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

// The review clock is deliberately not here (it is a schedule): it has its
// own needsAction kind (REVIEW_DUE) with a 24h look-ahead the generic loop
// can't express, and routing it through TRIGGER_MATCHING_NOW would relabel
// every routine review as an urgent trigger fire.
function isPriceOrTimePredicate(p: When): boolean {
  const w = shapeOf(p);
  return w != null && readsTheTape(w);
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface WorkFlagInput {
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
     * Paired open Position's openedAt, for held rows only. Null when not
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
     * hourly by the price monitor. Feeds the trail floor math
     * in the UNPROTECTED_GAIN computation. Null when not held / not tracked
     * — ladder-health falls back to the current price.
     */
    peakPrice?: number | null;
    /** ATR(14) from the daily snapshot — widens an atrMultiple trail (DAV-294). */
    atr14?: number | null;
    /** Paired open Position's share count — with avgCost, what the floor would lose (DAV-344). */
    quantity?: number | null;
    /** The chart numbers FLOOR_TOO_FAR names as places the floor could go. */
    structure?: FloorStructure | null;
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
  /**
   * This thesis's recent Activity lines, any order — at least back to the
   * newest line an agent wrote. The fires after that line are the open ones
   * (stock-context.ts `openFires`). Omit or pass [] and no fire is open.
   */
  activity?: ActivityRow[];
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
  /**
   * An unanswered protective sale the principal declined (DAV-315).
   * Computed by the caller with `declinedSaleWork` — the caller is the only
   * one that can read the orders and the floor — and passed in so the
   * precedence decision stays here with every other kind.
   */
  declinedSale?: DeclinedSaleWork | null;
  /**
   * A slice of this thesis's audit log — any order (DAV-323). Only a fired
   * trigger reads it, to count how many times the same rung has asked since
   * the plan last changed. Omit and the count is simply absent; no other
   * kind changes.
   */
  recentUpdates?: FireStreakUpdate[];
  /** The account's equity, for FLOOR_TOO_FAR. Omit and that flag never fires. */
  equity?: number | null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * The work-list flag: the one lead reason, by precedence. Each kind is
 * computed by its own function below; this function is only the order.
 */
export function leadFlag(
  input: WorkFlagInput,
): WorkFlag | null {
  // 0) PROMOTED_AWAITING_RESOLUTION — highest precedence.
  const promoted = promotedFlag(input);
  if (promoted) return promoted;

  // 0.5) SALE_DECLINED — ranks above the trigger kinds on purpose (see
  //    saleDeclinedFlag).
  const declined = saleDeclinedFlag(input);
  if (declined) return declined;

  // The held row's ladder, read once: the floor both held-row flags use.
  const ladder = heldLadder(input);

  // FLOOR_TOO_FAR (DAV-344) — a holding whose floor would lose more than
  // 1.5% of the account. It outranks a fired or matching REVIEW: CEG's
  // reviews ("below the 200-day", "15% off the high") fired on most days
  // from 09-15 to 09-30, so ranked under them this flag would never have
  // been CEG's work — each run answered the review "hold, business intact"
  // and the $220 floor stayed. A fired sale, trim, add or buy still comes
  // first: that is money moving now.
  const floorWork = floorTooFarFlag(input, ladder);

  // 1) TRIGGER_FIRED — a trigger fired after the newest line an agent wrote.
  //    Tactical-run writes its UPDATED/REVIEWED/CLOSED/INVALIDATED row at
  //    completion, so an open fire is still open work. Before 2026-09-30 a
  //    fire counted as answered by ANY newer line; CEG's "15% off the high"
  //    review was closed by the principal's unrelated cleanup edit and no run
  //    was ever handed it.
  {
    const fired = openFireWork(input);
    // The fire that moves money leads; among equals, the newest.
    const lead = fired.find((x) => x.action !== "REVIEW") ?? fired[0];
    if (lead) {
      if (floorWork && lead.action === "REVIEW") return floorWork;
      return firedFlag(input, lead, fired);
    }
  }

  // 2) TRIGGER_MATCHING_NOW — server-side eval against the fresh quote
  //    + time-based predicates. Same `shouldFire` the trigger evaluator
  //    runs every 5 minutes; we just want the run-start snapshot too.
  //    Cooldown gating respected — a match within the cooldown window
  //    returns false from shouldFire, which is correct (the cron will
  //    re-fire when cooldown expires). The first match in ladder order.
  const match = matchingWork(input)[0];
  if (match) {
    if (floorWork && match.action === "REVIEW") return floorWork;
    return matchingFlag(input, match);
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
  if (floorWork) return floorWork;
  const unprotected = unprotectedGainFlag(input, ladder);
  if (unprotected) return unprotected;

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

  // 5) REVIEW_DUE — see reviewDueFlag.
  const due = reviewDueFlag(input);
  if (due) return due;

  // 5) RESEARCH_STALE — lowest precedence deliberately: it runs only after
  //    REVIEW_DUE has declined, because a due review already carries the
  //    staleness instruction in the prompt. See researchStaleFlag.
  const stale = researchStaleFlag(input);
  if (stale) return stale;

  // Nothing to act on. Yesterday's thesis stands.
  return null;
}

// ─── Each kind, on its own ────────────────────────────────────────────────────

/**
 * PROMOTED_AWAITING_RESOLUTION. Any PROMOTED thesis ALWAYS needs resolution
 * this run regardless of trigger state. The user explicitly graduated this
 * analyst to live money and the paper position was force-closed at
 * promotion; the next daily run after promotion has to either re-enter
 * (place_trade), defer (update_thesis change_status: WATCHING), or kill
 * (where tool gates allow). Surfaces conviction context for the agent to
 * weigh in the decision.
 */
export function promotedFlag(input: WorkFlagInput): WorkFlag | null {
  const { thesis } = input;
  if (thesis.status !== "PROMOTED") return null;
  return {
    kind: "PROMOTED_AWAITING_RESOLUTION",
    paperTenureDays: thesis.paperTenureDays ?? null,
    paperRealizedPnl: thesis.paperRealizedPnl ?? null,
    paperReviewCount: thesis.paperReviewCount ?? null,
    promotedAt: thesis.promotedAt ? thesis.promotedAt.toISOString() : null,
  };
}

/**
 * SALE_DECLINED — the principal said no to a protective sale and the price
 * is still past the line (DAV-315). Ranks above the trigger kinds on
 * purpose: the floor is a standing order, so while the breach lasts
 * TRIGGER_FIRED / TRIGGER_MATCHING_NOW is true every day and would win the
 * race. It did, on IOT, for nine days — the run kept seeing "the floor is
 * breached" and never "and you already told me not to sell there." The
 * second sentence is the one that needs answering.
 */
export function saleDeclinedFlag(input: WorkFlagInput): WorkFlag | null {
  if (!input.declinedSale) return null;
  const d = input.declinedSale;
  return {
    kind: "SALE_DECLINED",
    declineCount: d.declineCount,
    lastDeclinedAt: d.lastDeclinedAt,
    rejectMessage: d.rejectMessage,
    floorPrice: d.floorPrice,
    recentLow: d.recentLow,
  };
}

/** The held row's ladder: the floor both held-row flags use. Null when not held. */
export function heldLadder(input: WorkFlagInput): LadderHealth | null {
  const { thesis, latestQuote, now } = input;
  return thesis.status === "HOLDING"
    ? computeLadderHealth({
        direction: thesis.direction,
        avgCost: thesis.avgCost,
        currentPrice: latestQuote?.price ?? null,
        peakPrice: thesis.peakPrice ?? null,
        triggers: thesis.triggers,
        atr14: thesis.atr14 ?? null,
        lastLadderEditAt: null, // not needed for the flag; surfaced via get_theses
        now,
      })
    : null;
}

/** FLOOR_TOO_FAR (DAV-344) — a holding whose floor would lose more than 1.5% of the account. */
export function floorTooFarFlag(
  input: WorkFlagInput,
  ladder: LadderHealth | null,
): WorkFlag | null {
  const { thesis, latestQuote } = input;
  const floorRisk = ladder
    ? floorTooFar({
        direction: thesis.direction ?? null,
        avgCost: thesis.avgCost ?? null,
        quantity: thesis.quantity ?? null,
        floorPrice: ladder.floor?.price ?? null,
        equity: input.equity ?? null,
        currentPrice: latestQuote?.price ?? null,
        structure: thesis.structure ?? null,
      })
    : null;
  return floorRisk
    ? {
        kind: "FLOOR_TOO_FAR",
        floorPrice: floorRisk.floorPrice,
        avgCost: floorRisk.avgCost,
        quantity: floorRisk.quantity,
        lossAtFloor: floorRisk.lossAtFloor,
        pctOfAccount: floorRisk.pctOfAccount,
        structureBelow: floorRisk.structureBelow,
        line: floorRisk.line,
      }
    : null;
}

/** An open fire with its trigger's action and sentence. */
export interface FireWork {
  f: OpenFire;
  action: WorkFlagVerb;
  summary: string;
}

/**
 * The fires no agent has answered (stock-context.ts `openFires`), newest
 * first, each with its trigger's action and sentence. A trigger removed since
 * reads as a REVIEW.
 */
export function openFireWork(input: WorkFlagInput): FireWork[] {
  const { thesis, hasPendingEntryProposal } = input;
  return openFires(input.activity ?? [])
    .map((f) => {
      const t = thesis.triggers.find((x) => x.id === f.triggerId);
      return {
        f,
        action: (t?.action as WorkFlagVerb) ?? "REVIEW",
        summary: t ? sentenceOf(t, thesis.status == null || thesis.status === "HOLDING") : "(predicate removed)",
      };
    })
    // P1-25 Change 4: a pending buy proposal already expresses the ENTER —
    // don't re-flag it (the agent would re-attempt place_trade and hit the
    // PENDING_APPROVAL dedup guard). Non-ENTER work still surfaces.
    .filter((x) => !(hasPendingEntryProposal && x.action === "ENTER"));
}

/** One open fire as the TRIGGER_FIRED flag, every other open fire riding along. */
export function firedFlag(
  input: WorkFlagInput,
  lead: FireWork,
  fired: FireWork[],
): WorkFlag {
  // DAV-323: how long this same rung has been asking. Absent when the
  // caller passed no history, or on a first ask.
  const streak = input.recentUpdates
    ? fireStreak(input.recentUpdates, lead.f.triggerId, input.now)
    : null;
  const others = fired.filter((x) => x !== lead);
  return {
    kind: "TRIGGER_FIRED",
    triggerId: lead.f.triggerId,
    action: lead.action,
    summary: lead.summary,
    firedAt: lead.f.lastAt.toISOString(),
    ...(streak && streak.line
      ? {
          repeatCount: streak.fireCount,
          unchangedSince: streak.lastChangedAt
            ? streak.lastChangedAt.toISOString()
            : null,
          repeatLine: streak.line,
        }
      : {}),
    ...(others.length
      ? {
          alsoFired: others.map((x) => ({
            triggerId: x.f.triggerId,
            action: x.action,
            summary: x.summary,
            count: x.f.count,
            lastAt: x.f.lastAt.toISOString(),
          })),
        }
      : {}),
  };
}

/** A trigger true on the live price right now. */
export interface MatchWork {
  trigger: Trigger;
  action: WorkFlagVerb;
}

/**
 * Every price- or time-side trigger true right now, in ladder order — the
 * same `shouldFire` the evaluator runs. A buy with a proposal pending is left
 * out (P1-25 Change 4).
 */
export function matchingWork(input: WorkFlagInput): MatchWork[] {
  const { thesis, latestQuote, now, hasPendingEntryProposal } = input;
  const out: MatchWork[] = [];
  for (const trigger of thesis.triggers) {
    if (!isPriceOrTimePredicate(trigger.predicate)) continue;
    const result = shouldFire(trigger, {
      latestQuote: latestQuote ?? undefined,
      // During the session a "closes above $X" level is not true yet — it
      // waits for the close pass. Outside it, the last price IS a close.
      session: isMarketOpen(now) ? "INTRADAY" : undefined,
      thesis: {
        createdAt: thesis.createdAt,
        lastReviewedAt: thesis.lastReviewedAt ?? null,
      },
      now,
    });
    if (result.fires) {
      const action = (trigger.action as WorkFlagVerb) ?? "REVIEW";
      // P1-25 Change 4: suppress ENTER while a buy proposal is pending.
      if (hasPendingEntryProposal && action === "ENTER") continue;
      out.push({ trigger, action });
    }
  }
  return out;
}

/** One match as the TRIGGER_MATCHING_NOW flag. */
export function matchingFlag(input: WorkFlagInput, m: MatchWork): WorkFlag {
  const { thesis, latestQuote } = input;
  return {
    kind: "TRIGGER_MATCHING_NOW",
    triggerId: m.trigger.id,
    action: m.action,
    predicateSummary: sentenceOf(m.trigger, thesis.status == null || thesis.status === "HOLDING"),
    livePrice: latestQuote?.price ?? null,
  };
}

/** UNPROTECTED_GAIN — a held winner whose floor doesn't reflect its gain. */
export function unprotectedGainFlag(
  input: WorkFlagInput,
  ladder: LadderHealth | null,
): WorkFlag | null {
  if (input.thesis.status !== "HOLDING") return null;
  if (!ladder?.isUnprotectedGain) return null;
  return {
    kind: "UNPROTECTED_GAIN",
    unrealizedGainPct: ladder.gainPct,
    flooredGainPct: ladder.flooredGainPct,
    unprotectedGapPct: ladder.unprotectedGapPct,
    hasTrail: ladder.hasTrail,
    floorSummary: ladder.floor?.label ?? null,
  };
}

/**
 * REVIEW_DUE — the review cadence elapsed OR coming due within the next
 * 24h. The 24h look-ahead is load-bearing: the morning daily-run fires once
 * at 08:00 ET, but a review can come due at 09:30 ET (market open) the same
 * day. Without look-ahead the morning agent skips today's-09:30 review as
 * "future," then the trigger evaluator's cron fires 90 min later and spawns
 * a redundant tactical run to do the same work. With look-ahead, the
 * morning agent catches it upfront. See lib/agent/triggers/defaults.ts
 * header comment for the matching half (old review-date removed from
 * watching defaults).
 *
 * Special case: unresearched seeds (user/builder/editor adds, direction
 * null or legacy 'PENDING') carry a 7-day cadence trigger from mint and a
 * null lastReviewedAt (falls back to createdAt), so they surface as
 * REVIEW_DUE within a week with the pendingFirstReview discriminator.
 *
 * The cadence trigger on the resolved ladder is the authority — "review
 * every N days", counted from the last actual review. It used to be a date
 * column the agent set by hand, which was a second store of the same idea
 * and the one nothing fired on.
 *
 * The 24h look-ahead is load-bearing and is why this doesn't just go
 * through the generic trigger loop: the morning run fires once at 08:00,
 * so a review coming due later today has to be caught now or it waits a
 * whole day.
 */
export function reviewDueFlag(input: WorkFlagInput): WorkFlag | null {
  const { thesis, now } = input;
  const REVIEW_DUE_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
  // Only the review clock decides REVIEW_DUE. A day count from the buy or
  // the event date is an ordinary trigger: it fires through the evaluator
  // and arrives as TRIGGER_FIRED.
  const clockDays = thesis.triggers
    .map((t) => shapeOf(t.predicate))
    .map((w) => (w == null ? null : reviewClockDays(w)))
    .find((d) => d != null);
  if (clockDays != null) {
    const lastLooked = thesis.lastReviewedAt ?? thesis.createdAt;
    const dueAt = lastLooked.getTime() + clockDays * 86_400_000;
    if (dueAt <= now.getTime() + REVIEW_DUE_LOOKAHEAD_MS) {
      // Clamp negative ("due later today") to 0 so the UI reads "due today"
      // rather than "-1 days overdue".
      const daysOverdue = Math.max(
        0,
        Math.floor((now.getTime() - dueAt) / 86_400_000),
      );
      const result: WorkFlag = { kind: "REVIEW_DUE", daysOverdue };
      // A seed has no committed view yet — route it to "commit a direction".
      if (isUnresearchedSeed(thesis.direction)) result.pendingFirstReview = true;
      return result;
    }
  }
  return null;
}

/**
 * RESEARCH_STALE — the thesis is not due for review, but the work behind it
 * is old enough that acting on it would mean acting on stale reasoning.
 *
 * This branch catches the gap that used to swallow it — a long clock (a
 * compounder's 30 days) outliving the research threshold, so "stale" was
 * true for weeks with nothing scheduled to look. Terminal rows are history
 * and never flagged. Two exclusions, both load-bearing:
 *   • direction null — an unresearched seed or a quiet watch. Neither has a
 *     committed view whose research could have gone stale: the seed is
 *     ASKING for first research (it surfaces via REVIEW_DUE with
 *     pendingFirstReview, which routes to "commit a direction", not
 *     "refresh"), and a quiet watch deliberately has no clock, so flagging
 *     it would put a name the principal asked to leave alone into every
 *     single morning's work list, forever, with nothing that could ever
 *     satisfy it.
 *   • `researchUpdatedAt === undefined` — the caller didn't select the
 *     column; absent data is not evidence of staleness.
 */
export function researchStaleFlag(input: WorkFlagInput): WorkFlag | null {
  const { thesis } = input;
  if (
    thesis.researchUpdatedAt !== undefined &&
    !isUnresearchedSeed(thesis.direction) &&
    thesis.direction != null &&
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
  return null;
}
