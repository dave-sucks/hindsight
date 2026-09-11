/**
 * Horizon-keyed default trigger templates.
 *
 * Every thesis carries a `triggers[]` array of structured predicates that
 * the router evaluates deterministically. Most of those are universal —
 * "stop hit", "earnings dropped", "closed under the 50-day", "quarterly hygiene check"
 * — and the agent shouldn't have to remember to attach them to every
 * thesis it mints. This module supplies the baseline keyed off horizon.
 *
 * Usage:
 *   const merged = mergeTriggers(
 *     defaultTriggersForHorizon("COMPOUNDER", thesis),
 *     args.triggers ?? [],
 *   );
 *
 * Merge rule (kept simple for v1): defaults fill gaps. Agent-supplied
 * triggers take precedence on the same (predicate.kind, action) key.
 * That way the agent can override "PRICE_BELOW $stop → EXIT" with a
 * tighter level without producing two contradictory exits.
 *
 * IDs are auto-assigned via randomUUID() — stable for the life of the
 * trigger so cooldown stamps survive subsequent merges.
 */

import { randomUUID } from "node:crypto";
import {
  COMPOUNDER_CATASTROPHE_PCT,
  COMPOUNDER_GIVEBACK_REVIEW_PCT,
} from "@/lib/agent/knowledge/setups";
import type { Trigger, TriggerPredicate } from "./types";
import { triggerBucket } from "./bucket";

const createId = () => randomUUID();

export type Horizon = "CATALYST" | "TARGET" | "TRADE" | "COMPOUNDER";

/**
 * Thesis state at the time defaults are derived. Drives the template
 * selection — held positions get EXIT/REVIEW templates around the open
 * position; watching theses get ENTER/REVIEW templates around the
 * watchlist entry condition; PROMOTED theses get the WATCHING-style
 * ENTER + REVIEW set (no EXIT — there's no live position to exit since
 * the paper position was force-closed at promotion).
 *
 * Without this distinction, watchlist theses end up with EXIT triggers
 * on stop-loss that can never fire usefully — there's no position to
 * exit. The agent then has no entry trigger to push it from WATCHING
 * → INITIATE, and the watchlist becomes inert. PROMOTED has the
 * symmetric trap: inheriting HELD-template EXIT triggers spawns an
 * orphan tactical EXIT run whenever price crosses the old stop.
 */
export type ThesisState = "HELD" | "WATCHING" | "PROMOTED";

export type ThesisDirection = "LONG" | "SHORT" | "PASS";

export interface ThesisShape {
  entryPrice?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  catalystDate?: Date | null;
  /** Direction colors entry-trigger semantics for watching theses. */
  direction?: ThesisDirection | null;
}

// ── Builders for each horizon ──────────────────────────────────────────

/**
 * Reactive strength-press rung (docs/plans/SCALE_INTO_WINNERS.md PR2).
 *
 * A strong single-day up-move on a HELD position spawns a tactical run to
 * evaluate pressing the winner. `ADD` is a held-only action and resolves to
 * fireMode TACTICAL by default (the agent decides + confirms; it never
 * auto-fills), and it is approval-gated, so a fire produces an add *proposal*.
 * `PRICE_MOVE_PCT{window:"1D"}` is cron-evaluable (reads the daily change), so
 * this fires intraday — the reactive complement to PR3's morning RUNNING_WINNER
 * flag.
 *
 * Deliberately UP-only for now. The pullback (down-day) add rung waits for PR4,
 * where the tactical run gains the market-wide-vs-company-specific judgment
 * needed to add into a dip without buying into thesis damage. Threshold tunable.
 */
const SCALE_IN_MOVE_PCT = 7;

function scaleInOnStrengthTrigger(): Trigger {
  return {
    id: createId(),
    predicate: {
      kind: "PRICE_MOVE_PCT",
      pct: SCALE_IN_MOVE_PCT,
      direction: "UP",
      window: "1D",
    },
    action: "ADD",
    rationale: `Up ${SCALE_IN_MOVE_PCT}% in a day — strength on a held name. Evaluate pressing the winner (add + raise target/stop) if the move is thesis-confirming, not an exhaustion spike. Approval-gated.`,
    // 3-day cooldown so a multi-day run doesn't re-propose an add every session.
    cooldownDays: 3,
  };
}

/**
 * Reactive pullback-add rung (docs/plans/SCALE_INTO_WINNERS.md PR4).
 *
 * A sharp single-day DOWN move on a held conviction name spawns a tactical run
 * to evaluate adding at the discount — but the tactical prompt runs the
 * make-or-break "market/sector-wide vs company-specific" check first. A
 * market-wide dip with the thesis intact is a gift; a company-specific drop is
 * thesis damage (don't add — hold/trim/exit). ADD is held-only + TACTICAL +
 * approval-gated, so a fire is a proposal the agent only makes after that check.
 *
 * Omitted for TRADE horizon on purpose: short-horizon momentum trades exit on
 * weakness, they don't average into a dip. Strength-press applies to all
 * horizons; pullback-add is for the conviction holds (COMPOUNDER/TARGET/CATALYST).
 */
function scaleInOnPullbackTrigger(): Trigger {
  return {
    id: createId(),
    predicate: {
      kind: "PRICE_MOVE_PCT",
      pct: SCALE_IN_MOVE_PCT,
      direction: "DOWN",
      window: "1D",
    },
    action: "ADD",
    rationale: `Down ${SCALE_IN_MOVE_PCT}% in a day — evaluate a pullback-add ONLY if the drop is market/sector-wide with the thesis intact. A company-specific drop is thesis damage: do not add — hold, trim, or exit. Approval-gated.`,
    cooldownDays: 3,
  };
}

// ── Standing sell rules by horizon (DAV-250) ────────────────────────────
//
// These used to be stamped onto every thesis at mint and again at the buy
// fill — one TARGET ladder (8% trail sell) for every holding on every seat,
// and a thesis-level rung beats any account rule, so nothing above it could
// ever govern. ASML/CEG/WST carried an automatic 8% sale their compounder
// mandate forbids; winners were sold 7–17 points off their peaks.
//
// Now they are ACCOUNT rules, one set per horizon (Trigger.horizons), seeded
// from here and edited in the same trigger popover as everything else. A
// held thesis carries only what is its own — the floor, the target, the
// catalyst exit, its review clock — and inherits its horizon's sell rules.
// Numbers: TRADING_PLAYBOOK.md E5/F, blessed on DAV-245.

type H = "TRADE" | "TARGET" | "CATALYST" | "COMPOUNDER";

function rule(
  horizons: H[] | undefined,
  predicate: TriggerPredicate,
  action: Trigger["action"],
  rationale: string,
  cooldownDays?: number,
): Trigger {
  return {
    id: createId(),
    predicate,
    action,
    rationale,
    ...(cooldownDays != null ? { cooldownDays } : {}),
    ...(horizons ? { horizons } : {}),
    source: "DEFAULT",
  };
}

/** A beat the market sold: the strongest fade signal in earnings (playbook D4). */
const beatAndFade = (horizons: H[]): Trigger =>
  rule(
    horizons,
    {
      kind: "AND",
      predicates: [
        { kind: "EARNINGS_BEAT" },
        { kind: "PRICE_MOVE_PCT", pct: 3, direction: "DOWN", window: "1D" },
      ],
    },
    "REVIEW",
    "Beat and the stock fell 3%+ — the market wanted more. On a trade this is a review-or-exit, not a hold.",
    7,
  );

/**
 * Every standing sell rule an account is seeded with, horizon-scoped.
 * Fresh ids per call.
 */
export function horizonStandingRules(): Trigger[] {
  return [
    // ── Every horizon ─────────────────────────────────────────────────
    { ...scaleInOnStrengthTrigger(), source: "DEFAULT" },
    // Short-horizon trades exit on weakness; they don't average into a dip.
    // One rule per horizon, so each is edited in its own horizon's group.
    ...(["TARGET", "CATALYST", "COMPOUNDER"] as const).map(
      (h): Trigger => ({ ...scaleInOnPullbackTrigger(), horizons: [h], source: "DEFAULT" }),
    ),

    // ── TRADE — tight: a trade is right fast or it's wrong ─────────────
    rule(["TRADE"], { kind: "GAIN_FROM_ENTRY", pct: 8, direction: "UP" }, "REVIEW",
      "Up 8% on a trade — take a partial or raise the stop to breakeven."),
    rule(["TRADE"], { kind: "TRAILING_FROM_HIGH", pct: 8 }, "EXIT",
      "Gave back 8% from the high — the trade's trail.", 0),
    rule(["TRADE"], { kind: "GAIN_FROM_ENTRY", pct: 7, direction: "DOWN" }, "EXIT",
      "Down 7% from entry — a trade that's wrong by this much is wrong. Cut it.", 0),
    beatAndFade(["TRADE"]),

    // ── TARGET — room to work, then a trail tied to the chart ──────────
    rule(["TARGET"], { kind: "GAIN_FROM_ENTRY", pct: 10, direction: "UP" }, "REVIEW",
      "Up 10% from entry — re-underwrite: raise the floor under real structure and arm the next milestone."),
    rule(["TARGET"], { kind: "TRAILING_FROM_HIGH", pct: 12, armAtGainPct: 10 }, "EXIT",
      "Gave back 12% from the high, once the position had been up 10% — bank the run.", 0),
    rule(["TARGET"], { kind: "GAIN_FROM_ENTRY", pct: 12, direction: "DOWN" }, "REVIEW",
      "Down 12% from entry — decide hold-vs-cut deliberately, before the floor decides for us."),
    beatAndFade(["TARGET"]),

    // ── CATALYST — the event is the exit; the thesis carries the stop ──
    rule(["CATALYST"], { kind: "GAIN_FROM_ENTRY", pct: 10, direction: "DOWN" }, "REVIEW",
      "Down 10% into the catalyst — is the run-up broken, or is the event still the thesis?"),

    // ── COMPOUNDER — only a named invalidation sells; price asks ───────
    rule(["COMPOUNDER"], { kind: "GAIN_FROM_ENTRY", pct: 15, direction: "UP" }, "REVIEW",
      "Up 15% — check the business is doing what we said; trims only at valuation extremes."),
    rule(["COMPOUNDER"], { kind: "TRAILING_FROM_HIGH", pct: COMPOUNDER_GIVEBACK_REVIEW_PCT }, "REVIEW",
      `Gave back ${COMPOUNDER_GIVEBACK_REVIEW_PCT}% from the high. A question, not a sale: is the reason we bought still true?`, 7),
    rule(["COMPOUNDER"], { kind: "VS_SMA", period: 200, direction: "BELOW" }, "REVIEW",
      "Below the 200-day — the long trend is in question. Review the business, not the chart."),
    rule(["COMPOUNDER"], { kind: "TRAILING_FROM_HIGH", pct: COMPOUNDER_CATASTROPHE_PCT }, "EXIT",
      `Gave back ${COMPOUNDER_CATASTROPHE_PCT}% from the high — the catastrophe line for a multi-year hold. The review at ${COMPOUNDER_GIVEBACK_REVIEW_PCT}% should have acted long before this.`, 0),
    rule(["COMPOUNDER"], { kind: "GAIN_FROM_ENTRY", pct: 15, direction: "DOWN" }, "REVIEW",
      "Down 15% from entry — has the thesis broken, or only the price?"),
  ];
}

/**
 * "Look at this again every N days", counted from the last actual review.
 *
 * The review clock, and the ONLY thing that decides whether an analyst
 * spends money reviewing a watched name (DAV-209). With one, the daily run
 * picks the name up on that schedule; without one, nothing touches it until
 * one of its own triggers fires.
 *
 * A clock is chosen, never inherited. The WATCHING templates below do not
 * stamp one: whoever creates the thesis decides how often to look at it, or
 * that nobody should, by including a REVIEW_CADENCE trigger or leaving it
 * out. Held templates keep theirs — a position we own is reviewed on a
 * schedule by default.
 */
export function reviewCadenceTrigger(days: number): Trigger {
  return {
    id: createId(),
    predicate: { kind: "REVIEW_CADENCE", days },
    action: "REVIEW",
    rationale:
      days === 1
        ? `Look at this every day.`
        : `Look at this every ${days} days, counting from the last real review.`,
    cooldownDays: days,
  };
}

/** Days between reviews by horizon. Was HORIZON_REVIEW_DAYS. */
export const CADENCE_DAYS_BY_HORIZON: Record<Horizon, number> = {
  CATALYST: 1,
  TRADE: 1,
  TARGET: 7,
  COMPOUNDER: 30,
};

/**
 * When this thesis is next due, given when it was last actually looked at.
 *
 * This is the ONE place the review date comes from. The cached column this
 * used to feed is gone (DAV-221): it froze once when its writers were
 * deleted (DAV-195 L7) and every thesis past its last written date read as
 * overdue forever. A value derived at read time cannot freeze.
 *
 * Cadence comes from the thesis's own review trigger when it has one, and
 * from its horizon otherwise — which is exactly what the account rule would
 * hand it, so an inheriting thesis gets the same answer without resolving
 * the whole cascade on the hottest write path in the app.
 */
export function nextReviewFrom(
  lastReviewedAt: Date,
  triggers: Array<{ predicate: TriggerPredicate }> | null | undefined,
  horizon: Horizon | null,
): Date {
  const own = resolvedCadenceDays(triggers ?? []);
  const days = own ?? CADENCE_DAYS_BY_HORIZON[horizon ?? "TARGET"];
  return new Date(lastReviewedAt.getTime() + days * 86_400_000);
}

/**
 * The review date every reporting surface shows, derived at read time.
 *
 * Null when there is no scheduled review: terminal rows, and WATCHING rows
 * with no clock of their own (DAV-209 — a watched name is reviewed iff it
 * carries a clock; inventing one from the horizon would display a review
 * that will never fire). Everything else falls through to `nextReviewFrom`, whose
 * horizon fallback matches what a held row inherits from the account rule
 * even when the caller only has the thesis's own trigger list.
 */
export function derivedNextReviewAt(thesis: {
  status: string | null;
  lastReviewedAt: Date | null;
  createdAt: Date;
  /** Trigger list — resolved ladder where the caller has one, else the raw column. */
  triggers: unknown;
  horizon: string | null;
}): Date | null {
  if (thesis.status === "RETIRED" || thesis.status === "PASSED") return null;
  const triggers = Array.isArray(thesis.triggers)
    ? (thesis.triggers as Array<{ predicate: TriggerPredicate }>)
    : [];
  if (thesis.status === "WATCHING" && resolvedCadenceDays(triggers) == null) {
    return null;
  }
  return nextReviewFrom(
    thesis.lastReviewedAt ?? thesis.createdAt,
    triggers,
    (thesis.horizon ?? null) as Horizon | null,
  );
}

/** The cadence in force on a resolved ladder; null when nothing sets one. */
export function resolvedCadenceDays(
  triggers: Array<{ predicate: TriggerPredicate }>,
): number | null {
  for (const t of triggers ?? []) {
    // Defensive: legacy rows carry malformed triggers (that is why
    // parseTriggersResilient exists), and this runs on the review-stamp path
    // of the most-called tool in the app. One bad trigger must not fail an
    // otherwise valid thesis update — it just doesn't supply the cadence.
    const kind = t?.predicate?.kind;
    if (kind === "REVIEW_CADENCE") {
      const days = (t.predicate as { days?: unknown }).days;
      if (typeof days === "number" && days > 0) return days;
    }
  }
  return null;
}

function compounderDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  out.push(reviewCadenceTrigger(CADENCE_DAYS_BY_HORIZON.COMPOUNDER));

  if (thesis.stopLoss != null) {
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_BELOW", level: thesis.stopLoss },
      action: "EXIT",
      rationale: `Hard stop at $${thesis.stopLoss}. If we hit it the thesis is broken; close and write up the lessons.`,
      cooldownDays: 0, // explicit opt-out — EXIT is terminal; the position closes and the cron's status:ACTIVE filter takes over.
    });
  }

  if (thesis.entryPrice != null) {
    const reviewLevel = +(thesis.entryPrice * 0.92).toFixed(2);
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_BELOW", level: reviewLevel },
      action: "REVIEW",
      rationale: `8% drop from entry — something material happened. Re-evaluate before deciding to ride it out or trim.`,
      cooldownDays: 1,
    });
  }

  out.push(
    {
      id: createId(),
      predicate: { kind: "EARNINGS_BEAT" },
      action: "REVIEW",
      rationale: `Earnings beat — re-score target. Beats often expand the multiple; consider scaling into the next rung.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "EARNINGS_MISS", minSurprisePct: 3 },
      action: "REVIEW",
      rationale: `Earnings miss ≥ 3% — downside surprise tests the core belief. Validate or step back.`,
      cooldownDays: 7,
    },
  );


  return out;
}

function targetDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  out.push(reviewCadenceTrigger(CADENCE_DAYS_BY_HORIZON.TARGET));
  if (thesis.stopLoss != null) {
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_BELOW", level: thesis.stopLoss },
      action: "EXIT",
      rationale: `Hard stop at $${thesis.stopLoss}.`,
      cooldownDays: 0, // explicit opt-out — terminal EXIT.
    });
  }
  if (thesis.targetPrice != null) {
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_ABOVE", level: thesis.targetPrice },
      action: "REVIEW",
      rationale: `Target $${thesis.targetPrice} hit. Decide: close at target or trail higher with confidence intact.`,
      cooldownDays: 1,
    });
  }
  out.push(
    {
      id: createId(),
      predicate: { kind: "EARNINGS_BEAT" },
      action: "REVIEW",
      rationale: `Beat — possibly a reason to extend the target.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "EARNINGS_MISS", minSurprisePct: 3 },
      action: "REVIEW",
      rationale: `Miss ≥ 3% — re-evaluate target.`,
      cooldownDays: 7,
    },
  );
  return out;
}

function tradeDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  out.push(reviewCadenceTrigger(CADENCE_DAYS_BY_HORIZON.TRADE));
  if (thesis.stopLoss != null) {
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_BELOW", level: thesis.stopLoss },
      action: "EXIT",
      rationale: `Tight stop at $${thesis.stopLoss}. Trade-horizon — get out fast on invalidation.`,
      cooldownDays: 0, // explicit opt-out — terminal EXIT.
    });
  }
  if (thesis.targetPrice != null) {
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_ABOVE", level: thesis.targetPrice },
      action: "EXIT",
      rationale: `Target $${thesis.targetPrice} hit. Trade plan executed; close.`,
      cooldownDays: 0, // explicit opt-out — terminal EXIT.
    });
  }
  // The "open long enough?" rung is gone, and nothing
  // replaces it. It was a 14-day window on a horizon the review clock
  // already visits EVERY day — the daily review asks "close it or
  // re-underwrite it" two weeks before the max-hold rung ever fired. A
  // second, slower clock on the same ladder would only add noise.
  return out;
}

function catalystDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  out.push(reviewCadenceTrigger(CADENCE_DAYS_BY_HORIZON.CATALYST));
  if (thesis.stopLoss != null) {
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_BELOW", level: thesis.stopLoss },
      action: "EXIT",
      rationale: `Hard stop at $${thesis.stopLoss}.`,
      cooldownDays: 0, // explicit opt-out — terminal EXIT.
    });
  }
  out.push(
    {
      id: createId(),
      predicate: { kind: "EARNINGS_BEAT" },
      action: "REVIEW",
      rationale: `Beat — possibly the catalyst.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "EARNINGS_MISS", minSurprisePct: 3 },
      action: "REVIEW",
      rationale: `Miss ≥ 3% — possibly the inverse catalyst.`,
      cooldownDays: 7,
    },
  );
  return out;
}

// ── Watching templates ─────────────────────────────────────────────────
// For NON-HELD theses on the watchlist. Also reused for PROMOTED theses
// (post-paper-graduation, awaiting first-live re-entry) — same semantic:
// no open position, so no EXIT; ENTER on the target level is the way
// price-crossings re-engage tactical. Semantic shift vs HELD:
//   - No EXIT triggers (nothing to exit)
//   - The TARGET price is the ENTRY-trigger threshold ("waiting for
//     price to break above X to consider INITIATE")
//   - The STOP price becomes a REVIEW threshold for LONG ("price
//     fell to support — better entry or thesis weakening?") and an
//     ENTRY threshold for SHORT (mirror semantics)
//   - News/event triggers stay as REVIEW
//   - REVIEW_DATE_HIT trigger REMOVED from watching templates 2026-05-20.
//     It was duplicating daily-run's needsAction.REVIEW_DUE check —
//     daily-run computes review due-ness itself every morning and
//     decides REVIEW_DUE without needing a trigger. Auto-attaching the
//     trigger meant the 5-min cron also spawned a TACTICAL run on every
//     overdue WATCHING thesis intra-day, which produced almost zero
//     state changes (28 of 35 tactical runs on 2026-05-18 were
//     REVIEW_DATE_HIT, 0 produced state changes). The intra-day
//     "review" was pure busywork — the agent wasn't going to make a
//     different decision at 11 AM than it would the next morning at
//     8 AM. The predicate kind stays in the schema + evaluator for
//     backwards compat with existing rows; cleanup script
//     scripts/dedupe-review-date-hit-triggers.ts strips it from
//     existing WATCHING theses.
//
// Direction matters here: LONG watches enter on PRICE_ABOVE entryPrice,
// SHORT watches enter on PRICE_BELOW entryPrice. PASS watches get only
// REVIEW triggers ("the move I dismissed actually happened — re-look").
//
// Per-horizon shape (matches the held side's per-horizon split):
//   CATALYST    — entry trigger + earnings REVIEW + tight 14d
//                 hygiene (catalyst windows are short)
//   TRADE       — entry trigger + 14d REVIEW (matches max-hold; if a
//                 watch is stale after the trade window, kill it)
//   TARGET      — current shape: entry + support REVIEW + 30d hygiene
//   COMPOUNDER  — entry trigger with longer cooldown (ignore noise) +
//                 90d hygiene; no support REVIEW (compounders shouldn't
//                 react to short-term wiggles)

/**
 * Direction-aware ENTER trigger keyed off `entryPrice`. Shared across
 * horizons.
 *
 * 2026-05-31 (P1-3 fix): this used to read `targetPrice`, which was the
 * structural bug GAPS P1-3 tracked — targetPrice was the take-profit
 * level when ACTIVE, so defaulting the ENTER trigger to
 * PRICE_ABOVE(targetPrice) on WATCHING meant the agent would literally
 * buy at the take-profit level (production evidence: MDB 2026-05-25).
 * The fix is one line: read `entryPrice` instead. The schema already had
 * `entryPrice` as a distinct column meaning "where you'd buy / did buy."
 * Two separate fields, two separate purposes — the bug was just the
 * default reading the wrong column. See docs/plans/PRICE_LEVEL_SEMANTICS.md.
 */
function watchingEntryTrigger(
  thesis: ThesisShape,
  direction: ThesisDirection,
  cooldownDays: number,
): Trigger | null {
  if (thesis.entryPrice == null) return null;
  // Direction-only placeholder. WHICH SIDE the rung compares on is decided
  // once, in `predicateFor` (price-levels.ts), which every write path runs
  // after this — so a second copy of the rule here only gets overwritten.
  // It was: #566 put a tape-reading version in this function on 2026-08-27,
  // applyLevelArgs rewrote its output on the very next line of
  // record_thesis, and no pullback rung reached the book in five days live.
  if (direction === "LONG") {
    return {
      id: createId(),
      predicate: { kind: "PRICE_ABOVE", level: thesis.entryPrice },
      action: "ENTER",
      rationale: `Entry trigger — price broke above $${thesis.entryPrice}. Validate setup and consider INITIATE.`,
      cooldownDays,
    };
  }
  if (direction === "SHORT") {
    return {
      id: createId(),
      predicate: { kind: "PRICE_BELOW", level: thesis.entryPrice },
      action: "ENTER",
      rationale: `Short entry trigger — price broke below $${thesis.entryPrice}. Validate setup and consider INITIATE short.`,
      cooldownDays,
    };
  }
  // PASS: the move we dismissed actually happened. Re-evaluate.
  return {
    id: createId(),
    predicate: { kind: "PRICE_ABOVE", level: thesis.entryPrice },
    action: "REVIEW",
    rationale: `Price hit the entry level we dismissed. Re-evaluate the PASS — was the rejection wrong?`,
    cooldownDays: 7,
  };
}

// reviewDateHitTrigger() removed 2026-05-20 (see header comment above).
// REVIEW_DATE_HIT predicate stays in types/evaluator for back-compat with
// existing rows; new theses no longer get it.


/**
 * The floor and the target, for a thesis we don't own yet.
 *
 * Every WATCHING template was missing these. Only one of the four read
 * `stopLoss` at all, and it minted a REVIEW ("better entry, or thesis
 * weakening?") rather than a sell level — so a watch item's floor and target
 * were written on the thesis and enforced by nothing. That is why all 19
 * watchlist rows in the book carried a stop that fired nothing, and it is
 * KLAC: buy $262, floor $225, price $184, breached in June, nothing happened.
 *
 * Safe to arm on an un-held thesis only because `effectiveTriggerAction`
 * resolves both to DEMOTE when they fire — set the plan down, keep watching.
 * A sell on something we never bought is meaningless; before that verb
 * existed, writing these would have spawned an agent run per name.
 */
function watchingPlanLevels(
  thesis: ThesisShape,
  direction: ThesisDirection,
): Trigger[] {
  const out: Trigger[] = [];
  const long = direction !== "SHORT";
  if (thesis.stopLoss != null) {
    out.push({
      id: createId(),
      predicate: long
        ? { kind: "PRICE_BELOW", level: thesis.stopLoss }
        : { kind: "PRICE_ABOVE", level: thesis.stopLoss },
      action: "EXIT",
      rationale: `Floor $${thesis.stopLoss} — below this the setup is wrong, so the plan comes off rather than waiting to be bought.`,
    });
  }
  if (thesis.targetPrice != null) {
    out.push({
      id: createId(),
      predicate: long
        ? { kind: "PRICE_ABOVE", level: thesis.targetPrice }
        : { kind: "PRICE_BELOW", level: thesis.targetPrice },
      action: "REVIEW",
      rationale: `Target $${thesis.targetPrice} reached before we bought — the move happened without us, so the entry is stale.`,
    });
  }
  return out;
}

/**
 * The four watch templates below emit ONLY what the author's own numbers
 * imply: the entry rung off `entryPrice`, and the plan levels off
 * `stopLoss` / `targetPrice`. Nothing else.
 *
 * They used to invent a review schedule and a set of earnings / filing /
 * guidance rungs on every new watch. Both are gone (DAV-209). The schedule
 * was the forced clock. The event rungs were worse than useless: news and
 * earnings routing is paused, so an EARNINGS_BEAT rung cannot fire at all —
 * it was ladder decoration that made a name look watched when nothing was
 * watching it. A watch now carries what its author wrote, and nothing more.
 *
 * The horizon still decides the ENTER rung's cooldown: a COMPOUNDER waits a
 * week before re-firing on a level it keeps crossing; a TRADE fires the same
 * day.
 */
function watchingDefaults(thesis: ThesisShape, enterCooldownDays: number): Trigger[] {
  const direction = thesis.direction ?? "LONG";
  const out: Trigger[] = [];
  const entry = watchingEntryTrigger(thesis, direction, enterCooldownDays);
  if (entry) out.push(entry);
  out.push(...watchingPlanLevels(thesis, direction));
  return out;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Returns the horizon-keyed default trigger array for this thesis.
 * Pure function — no DB, no clock; delegates ID generation to cuid.
 *
 * @param horizon  Trade structure (CATALYST/TARGET/TRADE/COMPOUNDER)
 * @param state    HELD vs WATCHING vs PROMOTED — determines whether to
 *                 emit EXIT triggers (held), ENTER triggers (watching),
 *                 or the no-EXIT/ENTER-as-re-entry shape (promoted).
 *                 Defaults to HELD for backward compatibility with callers
 *                 minted before the split. New callers should pass
 *                 explicitly.
 * @param thesis   Thesis fields used to parameterize the templates
 *
 * PROMOTED note: a PROMOTED thesis was an ACTIVE paper position that
 * the user just graduated PAPER→LIVE. The paper position was
 * force-closed; the thesis itself still carries full conviction (entry,
 * target, stop, belief) and is awaiting first-live-run re-entry.
 * Trigger shape mirrors WATCHING — ENTER on the target level so a
 * matching price crossing wakes tactical-run which calls place_trade
 * (place_trade auto-flips PROMOTED → ACTIVE in the same tx per PR #324).
 * Critically, NO EXIT/TRIM/ADD/MOVE_STOP — those operate on positions
 * and a PROMOTED thesis has none.
 */
export function defaultTriggersForHorizon(
  horizon: Horizon,
  thesis: ThesisShape,
  state: ThesisState = "HELD",
): Trigger[] {
  return stampDefaultSource(defaultTriggersForHorizonInner(horizon, thesis, state));
}

/** source=DEFAULT on every rung a code template mints. */
function stampDefaultSource(triggers: Trigger[]): Trigger[] {
  return triggers.map((t) => ({ ...t, source: "DEFAULT" as const }));
}

function defaultTriggersForHorizonInner(
  horizon: Horizon,
  thesis: ThesisShape,
  state: ThesisState,
): Trigger[] {
  if (state === "WATCHING" || state === "PROMOTED") {
    // PROMOTED reuses the WATCHING template family: no EXIT (there's no
    // open position), an ENTER trigger off the target level (the re-entry
    // path that wakes tactical → place_trade → atomic PROMOTED→ACTIVE
    // flip), plus the same news/earnings/hygiene REVIEW set. The
    // WATCHING templates already produce exactly this shape so the
    // PROMOTED branch is a straight delegation.
    // COMPOUNDER waits a week before re-firing an entry level it keeps
    // crossing; the shorter horizons act the same day.
    return watchingDefaults(thesis, horizon === "COMPOUNDER" ? 7 : 1);
  }
  switch (horizon) {
    case "COMPOUNDER":
      return compounderDefaults(thesis);
    case "TARGET":
      return targetDefaults(thesis);
    case "TRADE":
      return tradeDefaults(thesis);
    case "CATALYST":
      return catalystDefaults(thesis);
  }
}

// ── Cooldown defaults ──────────────────────────────────────────────────
//
// Triggers without a `cooldownDays` value used to fire forever — the
// `shouldFire` gate only enforces cooldown when both `cooldownDays` and
// `lastFiredAt` are set, so an unset cooldown silently disabled rate
// limiting. Observed in production: agent-supplied EARNINGS_BEAT trigger
// on AMZN with no cooldown fired 10 tactical runs over 12.5 hours on a
// single earnings signal that the router (correctly) re-evaluated each
// time a new intel batch landed.
//
// We now apply a sane per-predicate-kind default at write time in
// record_thesis / update_thesis. The values mirror the conventions
// already baked into the horizon templates above (EARNINGS_*: 7,
// price and chart kinds: 1, etc.) so behavior of a default-minted trigger doesn't
// change — these only kick in when an agent-supplied trigger is
// missing the field.

/**
 * Default cooldown (days) for a predicate when the agent didn't specify
 * one. Mirrors the conventions in the horizon templates: earnings-class
 * predicates rate-limit at the quarterly cycle (7d caps the
 * "earnings-beat aftershocks" window); filings/news/price predicates
 * rate-limit at 1 day so they don't fan out on every quote tick or
 * intel batch; a review cadence rate-limits at its own interval.
 */
export function defaultCooldownDaysForPredicate(p: TriggerPredicate): number {
  switch (p.kind) {
    case "EARNINGS_BEAT":
    case "EARNINGS_MISS":
      return 7;
    case "EARNINGS_WITHIN":
    case "EARNINGS_SINCE":
      // "Reports within N days" is true every day of the approach, so the
      // cooldown is what makes it fire once. 30 clears any legal window
      // (≤14) with room and is well short of a quarter, so the next
      // report still fires.
      return 30;
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
    case "PRICE_MOVE_PCT":
    case "VS_SMA":
    case "NEAR_SMA":
    case "VOLUME_RATIO":
    case "NEW_HIGH":
    case "PCT_FROM_52W_HIGH":
    case "RS_VS_SPY":
    case "RSI":
      // Price and chart conditions: one nudge per day at most.
      return 1;
    case "GAP_UP":
      // A gap stays "within the last N sessions" for N days; one fire per gap.
      return Math.max(1, p.withinDays ?? 1);
    case "GAIN_FROM_ENTRY":
      // A gain milestone LATCHES (up 10% stays up 10%): the acting agent
      // is expected to replace the fired rung with the next checkpoint;
      // 7d stops a same-week re-fire if it doesn't.
      return 7;
    case "TRAILING_FROM_HIGH":
      // Also latches while price sits below the trail. EXIT is terminal
      // anyway; REVIEW/TRIM rungs get one nudge per day, matching the
      // other price predicates.
      return 1;
    case "REVIEW_CADENCE":
      // The cadence IS the interval. A clock allowed to re-fire sooner than
      // its own schedule is just a faster clock; the flat 7 that used to sit
      // here made a 30-day review nag weekly once it latched.
      return p.days;
    case "AND":
    case "OR":
      // Composite: pick the max child cooldown. If a composite contains
      // an EARNINGS_BEAT, use 7 — the more conservative default wins.
      return Math.max(
        1,
        ...p.predicates.map(defaultCooldownDaysForPredicate),
      );
  }
}

/**
 * Fill in `cooldownDays` on every trigger in the array that doesn't
 * already have one. Pure; returns a fresh array. Call this in the write
 * path (record_thesis / update_thesis) before persistence so disk state
 * always has cooldown bookkeeping.
 *
 * `cooldownDays: 0` is legitimate ONLY on EXIT triggers — those are
 * terminal (the position closes and the cron's `status:ACTIVE` filter
 * takes over), so re-firing isn't a runaway risk. On any other action
 * (REVIEW, ENTER, TRIM) `0` is structurally invalid against a sticky
 * predicate (PRICE_ABOVE/BELOW, VS_SMA, RSI, REVIEW_CADENCE, AND/OR
 * composites of the same) — once the condition is true it stays true,
 * and a 5-min trigger-evaluator tick re-fires every cycle until
 * intervention. Treat `0` on non-EXIT as "needs default" and overwrite
 * with the per-predicate cooldown.
 *
 * Background: 2026-06-02 NVDA tactical runaway — agent-supplied
 * `update_thesis` triggers stamped `cooldownDays: 0` on a review
 * 14d REVIEW, the old `!= null` check walked past it, and the loop
 * fired 15 times in 70 min before manual hotfix. See `docs/GAPS.md`.
 */
/**
 * Default fire mode for a manually-added trigger, keyed off action. A
 * deterministic EXIT (hard stop / trailing stop / take-profit level) has
 * nothing for an agent to decide, so it closes DIRECT — skipping the
 * GPT-5.5 tactical run (the principal's cost driver, TRIGGER_FOLLOWUPS #3).
 * It still flows through the approval gate. Every other action keeps the
 * judgment-bearing TACTICAL path.
 *
 * Scope note: this drives the UI add-path + popover only. The horizon
 * default templates intentionally do NOT call it — they omit fireMode, so
 * agent-minted EXIT stops stay on the historical TACTICAL behavior until
 * the principal opts a specific trigger into DIRECT. Changing the mass-mint
 * default is a separate decision.
 */
export function defaultFireModeForAction(
  action: Trigger["action"],
): "TACTICAL" | "DIRECT" {
  return action === "EXIT" ? "DIRECT" : "TACTICAL";
}

export function applyTriggerCooldownDefaults(triggers: Trigger[]): Trigger[] {
  return triggers.map((t) => {
    const needsDefault =
      t.cooldownDays == null || (t.cooldownDays === 0 && t.action !== "EXIT");
    return needsDefault
      ? { ...t, cooldownDays: defaultCooldownDaysForPredicate(t.predicate) }
      : t;
  });
}

/**
 * `triggerBucket` — the `(predicateKey, action)` precedence key — moved to
 * ./bucket on 2026-08-05 so the cascade resolver (./levels) and the client
 * trigger UI can share it without pulling this module's `node:crypto`
 * import into the browser bundle. Re-exported here so existing import
 * paths keep working.
 */
export { triggerBucket };

/**
 * Merge agent-supplied triggers with horizon defaults. Agent wins per
 * (predicate, action) bucket; defaults fill the gaps. Returns a fresh
 * array; never mutates inputs.
 */
export function mergeTriggers(
  defaults: Trigger[],
  agentSupplied: Trigger[],
): Trigger[] {
  const seen = new Set<string>();
  const out: Trigger[] = [];

  for (const t of agentSupplied) {
    const key = triggerBucket(t);
    if (seen.has(key)) continue; // dedupe within agent's own list
    seen.add(key);
    out.push(t.id ? t : { ...t, id: createId() });
  }
  for (const t of defaults) {
    const key = triggerBucket(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
