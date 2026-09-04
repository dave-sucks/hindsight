/**
 * The trigger cascade — account → analyst → thesis, most-specific wins.
 *
 * > Canonical shape: docs/plans/TRIGGER_MODEL.md §5.5 (the cascade) and
 * > TRIGGER_LIFECYCLE.md §1 (the authority model). This module is the
 * > implementation of "layer 2 (analyst standing rules)" + "layer 1 (code
 * > constants)" that both docs list as missing.
 *
 * ## Level is WHERE a rung is stored, not a field on it
 *
 *   Thesis.triggers      → THESIS   (solid pill, editable)
 *   AgentConfig.triggers → ANALYST  (dotted pill, edit at the analyst)
 *   Account.triggers     → ACCOUNT  (dotted pill, edit in settings)
 *   ./defaults templates → DEFAULT  (dotted pill, read-only — code constants)
 *
 * `Trigger.source` is a *different* axis (who authored the value) and is
 * deliberately not consulted here. Storing the level as a field would let
 * it drift from the record the rung actually lives on; deriving it cannot.
 *
 * ## Precedence
 *
 * One rung per `triggerBucket` — `(predicateKey, action)` — because two
 * rungs in the same bucket express the same intent at different values.
 * "Exit if price below $60" from the account and "$71" from the thesis are
 * the same stop; the thesis wins and the account rung is not shown twice.
 *
 * The corollary the UI depends on: **deleting a thesis rung reveals the
 * inherited rung underneath it.** That is the (only) way to stop
 * overriding a level, and it needs no special "revert" affordance.
 *
 * ## Why this must serve the evaluator, not just the UI
 *
 * If `resolveLadder` only fed the thesis sheet, analyst and account rungs
 * would render beautifully and never fire — the 5-minute trigger-evaluator
 * reads the ladder to decide what fires. That is exactly the failure mode
 * the signal-side rungs are in today (docs/plans/TRIGGER_MODEL.md §4 grid
 * 1: "severed — P1-34", every news/earnings rung decorative). So the
 * evaluator resolves through this same function. A level that does not
 * reach the evaluator is a lie told in CSS.
 */

import { triggerBucket } from "./bucket";
import { protectiveExitCloseReason } from "./types";
import type { Trigger } from "./types";

/** Where a resolved rung is stored — most-specific first. */
export type TriggerLevel = "THESIS" | "ANALYST" | "ACCOUNT" | "DEFAULT";

/**
 * Resolution order, most-specific → least. The array order IS the
 * precedence rule; `resolveLadder` walks it and first-claim-wins.
 */
export const LEVEL_PRECEDENCE: readonly TriggerLevel[] = [
  "THESIS",
  "ANALYST",
  "ACCOUNT",
  "DEFAULT",
];

/**
 * A rung plus the level it resolved from. `lastFiredAt` is already
 * overlaid from the per-thesis fire state for inherited rungs, so every
 * consumer (evaluator cooldown gate, popover "Fired …" line) reads the
 * same field regardless of level.
 */
export type ResolvedTrigger = Trigger & {
  level: TriggerLevel;
  /**
   * The rung is not stored at the level currently being VIEWED — it comes
   * from somewhere further down the cascade. Drives the dashed border and
   * the read-only popover.
   *
   * Relative to `viewLevel`, not to THESIS: on `/settings/triggers` an
   * ACCOUNT rung is the thing you own and a DEFAULT rung is inherited,
   * while on a thesis both are inherited. Hardcoding THESIS here made the
   * account and analyst pages render their own rules dashed and
   * read-only — the exact opposite of their purpose.
   */
  inherited: boolean;
  /**
   * The rung this one displaced, if any — the next level down that had a
   * rung in the same bucket.
   *
   * Without this the cascade is only half legible: a dashed border tells
   * you about levels nothing has overridden, but an override looks
   * identical to a rule invented from scratch. On a thesis reviewing at
   * +20% from entry, nothing on screen says the app default is +10% and
   * the analyst deliberately moved it. Surfaced in the popover.
   */
  overrides?: {
    level: TriggerLevel;
    predicate: Trigger["predicate"];
  };
};

export interface LadderLevels {
  /** `Thesis.triggers`. */
  thesis: Trigger[];
  /** `AgentConfig.triggers` — the analyst's standing rules. */
  analyst?: Trigger[];
  /** `Account.triggers` — account-wide standing rules. */
  account?: Trigger[];
  /**
   * Code-template constants for this thesis's state — see
   * `inheritableDefaultLadder`. Pass `[]` in contexts that have no
   * position concept (e.g. the account settings page renders these as the
   * bottom level explicitly rather than resolving against a thesis).
   */
  defaults?: Trigger[];
  /**
   * `Thesis.triggerState` — per-thesis fire bookkeeping for rungs that
   * live on a SHARED record. An analyst rung fires per-thesis, but it is
   * stored once on the AgentConfig, so its `lastFiredAt` cannot be written
   * back onto the rung without stamping every thesis at once. This map
   * (triggerId → ISO timestamp) keeps that state where it belongs.
   *
   * THESIS-level rungs keep `lastFiredAt` inline as they always have —
   * they are not shared, and rewriting that history would be a migration
   * for no benefit.
   */
  triggerState?: Record<string, string | null | undefined>;
  /**
   * Which level the caller is rendering FROM. Everything below it is
   * inherited; rungs at this level are owned and editable.
   *
   *   THESIS  (default) — the thesis sheet
   *   ANALYST — the analyst config's Triggers tab
   *   ACCOUNT — /settings/triggers
   *
   * Levels ABOVE the view are not passed in by those callers (there is no
   * thesis in scope on a settings page), so this only ever partitions
   * what was supplied.
   */
  viewLevel?: TriggerLevel;
  /**
   * The thesis's state, for gating position-scoped predicates.
   *
   * `GAIN_FROM_ENTRY` and `TRAILING_FROM_HIGH` measure off an open
   * position's avgCost / peak, so on a WATCHING or PROMOTED thesis they
   * evaluate false forever. That used to be handled by the DEFAULT
   * level's HELD-only templates; now that those rungs are seeded onto the
   * ACCOUNT (where there is no per-thesis state), the gate belongs here —
   * otherwise every watchlist thesis renders a trail rung that can never
   * fire. Omit ⇒ no gating (settings surfaces, which have no thesis).
   */
  state?: "HELD" | "WATCHING" | "PROMOTED";
  /**
   * "LONG" | "SHORT" | null. Only used to decide which of two triggers in
   * the same bucket is the tighter protection — see
   * `protectiveTightestFirst`. Absent behaves as LONG, the overwhelming
   * default, and on a thesis with no duplicate buckets it changes nothing.
   */
  direction?: string | null;
}

/** Predicates that measure off an open position and are inert without one. */
const POSITION_SCOPED_KINDS = new Set(["GAIN_FROM_ENTRY", "TRAILING_FROM_HIGH"]);
// Actions that operate on a position. A rung with one of these on a thesis
// we don't hold is not a plan, it is a spawn: the account's ±7% scale-in
// rules are PRICE_MOVE_PCT, so the predicate gate above let them through
// onto WATCHING rows, and on 2026-09-03 five of eight tactical runs were
// "scale in" on names with no position (HPE, RARE, PLTR, NOW; two of them
// were then retired by an agent that had been asked to add). EXIT is not
// here — an un-held floor resolves to DEMOTE (effectiveTriggerAction), which
// is a real verdict, not a position action.
const POSITION_SCOPED_ACTIONS = new Set(["ADD", "TRIM", "MOVE_STOP"]);

/**
 * Order the triggers WITHIN one level so that, when two of them land in the
 * same bucket, the tightest protective one is the one the claim loop keeps.
 *
 * The hazard this closes: two floors on one thesis — "sell below $500" and a
 * stale "sell below $100" — are the same bucket, so exactly one survives
 * resolution, and until now that was whichever happened to come first in the
 * array. Half the time the live floor is the weaker one, and nothing on
 * screen says so. That is the SNOW failure with two numbers instead of one.
 *
 * Only STOP-classified EXITs are reordered (`protectiveExitCloseReason` —
 * the same classifier the ratchet gate uses, so "protective" means one thing
 * in both places). Everything else keeps array order, because for a target
 * or a review there is no safe direction to prefer and reordering would
 * change behaviour for no reason.
 *
 * Stable: equal-priority triggers keep their relative order.
 */
function protectiveTightestFirst(
  triggers: Trigger[],
  direction: string | null | undefined,
): Trigger[] {
  const isLong = direction !== "SHORT";
  const rank = (t: Trigger): number | null => {
    if (t.action !== "EXIT") return null;
    if (protectiveExitCloseReason(t.predicate, direction ?? null) !== "STOP") {
      return null;
    }
    switch (t.predicate.kind) {
      // A higher floor on a long (lower ceiling on a short) is hit sooner.
      case "PRICE_BELOW":
        return isLong ? -t.predicate.level : t.predicate.level;
      case "PRICE_ABOVE":
        return isLong ? t.predicate.level : -t.predicate.level;
      // A smaller give-back / drawdown fires sooner.
      case "TRAILING_FROM_HIGH":
      case "GAIN_FROM_ENTRY":
      case "PRICE_MOVE_PCT":
        return t.predicate.pct;
      default:
        return null;
    }
  };

  // Reorder WITHIN each bucket only, and leave the buckets themselves in
  // first-appearance order. A global sort would be wrong twice over: it
  // can't produce a valid comparator across ranked and unranked triggers,
  // and it would shuffle unrelated triggers for no reason.
  const groups = new Map<string, Trigger[]>();
  for (const t of triggers) {
    const bucket = triggerBucket(t);
    const g = groups.get(bucket);
    if (g) g.push(t);
    else groups.set(bucket, [t]);
  }
  const out: Trigger[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    out.push(
      ...group
        .map((t, i) => ({ t, i, r: rank(t) }))
        .sort((a, b) =>
          a.r != null && b.r != null && a.r !== b.r ? a.r - b.r : a.i - b.i,
        )
        .map((x) => x.t),
    );
  }
  return out;
}

/**
 * Resolve the levels into the one ladder that is actually in force.
 *
 * Pure. Returns a fresh array, most-specific level first; consumers that
 * care about presentation order (the sheet groups by action) re-sort.
 */
/**
 * Strip rungs from a wholesale-replace payload that merely restate what
 * the thesis already inherits.
 *
 * The hazard this closes: `update_thesis.triggers` is wholesale-REPLACE
 * by design — the agent resends every rung it wants to keep. Now that
 * `get_theses` shows it the RESOLVED ladder, a faithful agent will resend
 * the inherited rungs too, which would copy them onto the thesis and
 * silently promote them to THESIS level. Do that once per review and
 * within a week every analyst and account rule is overridden everywhere
 * by a frozen snapshot of itself — the cascade would still typecheck,
 * pass tests, and be dead.
 *
 * A rung counts as "merely restating" when its predicate, action and
 * effective fire mode all match the inherited rung in its bucket.
 * Rationale is deliberately NOT compared: the agent rewording an
 * explanation is not a decision to override a level. Any change to the
 * VALUE (or the fire mode) is a real override and is kept.
 */
export function dropRedundantInherited(
  incoming: Trigger[],
  inherited: Trigger[],
): Trigger[] {
  if (inherited.length === 0) return incoming;
  const inheritedByBucket = new Map(inherited.map((t) => [triggerBucket(t), t]));

  return incoming.filter((t) => {
    const match = inheritedByBucket.get(triggerBucket(t));
    if (!match) return true;
    const sameMode =
      (t.fireMode ?? "TACTICAL") === (match.fireMode ?? "TACTICAL");
    return !(sameMode && samePredicateValue(t.predicate, match.predicate));
  });
}

/**
 * Canonical JSON of a predicate — object keys sorted recursively, so two
 * predicates that say the same thing serialize identically regardless of
 * the key order the author happened to use.
 */
const normPredicate = (p: unknown): string =>
  JSON.stringify(p, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([x], [y]) =>
            x.localeCompare(y),
          ),
        )
      : v,
  );

/**
 * Structural equality over predicates. `triggerBucket` already matched
 * the KIND and the discriminating fields, so this is really asking "same
 * numbers?" — JSON comparison over sorted keys is sufficient and stays
 * correct as new predicate kinds are added.
 */
function samePredicateValue(a: Trigger["predicate"], b: Trigger["predicate"]): boolean {
  return normPredicate(a) === normPredicate(b);
}

/**
 * Re-adopt stored trigger ids for a wholesale-replace payload.
 *
 * The agent resends trigger ladders WITHOUT ids and the schema mints a
 * fresh uuid for every id-less rung, so an UNCHANGED rung comes back as a
 * stranger. Everything keyed by id then breaks at once: `lastFiredAt`
 * doesn't carry over (the rung re-fires on the next evaluator tick — ABT
 * 2026-08-26, four tactical runs in 15 minutes on one unchanged ENTER),
 * `source` doesn't carry over (a principal-authored floor gets re-stamped
 * AGENT), and the per-thesis fire-state map orphans its entries.
 *
 * The rule: an incoming rung that does not name an existing id, but whose
 * CONTENT — action, predicate kind and exact values — matches a stored rung
 * nothing else in the payload claims, IS that rung and takes its id. A rung
 * whose values changed matches nothing and keeps its fresh identity: a
 * moved level is a new decision and may legitimately fire.
 *
 * Pure. Returns a fresh array; order and everything but `id` untouched.
 */
export function adoptStoredTriggerIdentity(
  incoming: Trigger[],
  existing: Trigger[],
): Trigger[] {
  if (existing.length === 0 || incoming.length === 0) return incoming;

  const existingIds = new Set(
    existing.map((t) => t.id).filter((id): id is string => Boolean(id)),
  );
  // Stored rungs the payload doesn't already claim by id, grouped by
  // content. A queue per key so two identical incoming rungs can't both
  // adopt the same stored id.
  const claimed = new Set(
    incoming
      .map((t) => t.id)
      .filter((id): id is string => Boolean(id) && existingIds.has(id as string)),
  );
  const adoptable = new Map<string, Trigger[]>();
  for (const t of existing) {
    if (!t.id || claimed.has(t.id)) continue;
    const key = `${triggerBucket(t)}|${normPredicate(t.predicate)}`;
    const queue = adoptable.get(key);
    if (queue) queue.push(t);
    else adoptable.set(key, [t]);
  }
  if (adoptable.size === 0) return incoming;

  return incoming.map((t) => {
    if (t.id && existingIds.has(t.id)) return t; // an edit-in-place — keep it
    const match = adoptable
      .get(`${triggerBucket(t)}|${normPredicate(t.predicate)}`)
      ?.shift();
    return match?.id ? { ...t, id: match.id } : t;
  });
}

export function resolveLadder(input: LadderLevels): ResolvedTrigger[] {
  const order = (ts: Trigger[]) => protectiveTightestFirst(ts, input.direction);
  const byLevel: Record<TriggerLevel, Trigger[]> = {
    THESIS: order(input.thesis ?? []),
    ANALYST: order(input.analyst ?? []),
    ACCOUNT: order(input.account ?? []),
    DEFAULT: order(input.defaults ?? []),
  };

  const claimed = new Set<string>();
  const out: ResolvedTrigger[] = [];
  // Bucket → the winning rung's index in `out`, so a later (lower) level
  // can record itself as the thing that rung overrode.
  const winnerIndexByBucket = new Map<string, number>();

  const dropPositionScoped = input.state != null && input.state !== "HELD";

  // W1 (DAV-216): review cadence is OPT-IN for watch items. A WATCHING
  // thesis is reviewed iff it carries its own cadence rung — it does not
  // inherit the analyst/account clock. This is what makes a "soft watch"
  // (wakes on events, costs no review attention) representable at all;
  // before this gate the account's 7d floor put every watch item on a
  // clock the moment it was minted (docs/plans/WATCHLIST_STATES.md §3).
  //
  // Scope, deliberately narrow:
  //   - WATCHING only. HELD always inherits — a position must never
  //     silently drop off the review clock. PROMOTED keeps inheriting
  //     too: it is awaiting a decide-today and going quiet would bury it.
  //   - Inherited levels only. A thesis-level cadence rung is the opt-in
  //     and always survives.
  //   - `state` is only passed by thesis-scoped callers, so the settings
  //     pages (no thesis in scope) still render account/analyst cadence
  //     rules normally.
  //
  // Downstream this also keeps `dropRedundantInherited` honest: on a
  // WATCHING thesis the inherited ladder contains no cadence, so an agent
  // deliberately opting in with days=7 is a real rung, not "redundant
  // with the account" — the opt-in cannot be silently swallowed.
  const dropInheritedCadence = input.state === "WATCHING";

  for (const level of LEVEL_PRECEDENCE) {
    for (const t of byLevel[level]) {
      if (
        dropPositionScoped &&
        (POSITION_SCOPED_KINDS.has(t.predicate.kind) ||
          POSITION_SCOPED_ACTIONS.has(t.action))
      ) {
        continue;
      }
      if (
        dropInheritedCadence &&
        t.predicate.kind === "REVIEW_CADENCE" &&
        level !== "THESIS"
      ) {
        continue;
      }
      const bucket = triggerBucket(t);
      // First level to claim a bucket owns it. Also dedupes within a
      // level, matching mergeTriggers' within-list behavior.
      if (claimed.has(bucket)) {
        // Losing rung: annotate the winner with what it displaced, but
        // only the FIRST one found — "overrides the analyst rule" is what
        // the reader needs, not the whole chain down to the code default.
        const winnerIdx = winnerIndexByBucket.get(bucket);
        if (winnerIdx != null && out[winnerIdx].overrides === undefined) {
          out[winnerIdx].overrides = { level, predicate: t.predicate };
        }
        continue;
      }
      claimed.add(bucket);
      winnerIndexByBucket.set(bucket, out.length);

      const inherited = level !== (input.viewLevel ?? "THESIS");
      // Inherited rungs read fire state from the per-thesis map; thesis
      // rungs keep theirs inline. `?? undefined` because the map stores
      // null for "never fired" and the Trigger type wants the field absent.
      const lastFiredAt = inherited
        ? (input.triggerState?.[t.id] ?? undefined)
        : t.lastFiredAt;

      out.push({ ...t, lastFiredAt: lastFiredAt ?? undefined, level, inherited });
    }
  }

  return out;
}

/**
 * Split fired rungs by where their cooldown bookkeeping lives: rungs
 * stored on the thesis stamp `lastFiredAt` inline, inherited rungs stamp
 * into the thesis's `triggerState` map.
 *
 * Pure, and here rather than in the evaluator so it can be tested without
 * standing up Inngest — getting this partition wrong silently mis-files a
 * cooldown, which shows up as a rung that re-fires or one that goes quiet.
 */
export function splitFiresByLevel(fires: ResolvedTrigger[]): {
  firedTriggerIds: string[];
  firedInheritedTriggerIds: string[];
} {
  return {
    firedTriggerIds: fires.filter((t) => !t.inherited).map((t) => t.id),
    firedInheritedTriggerIds: fires.filter((t) => t.inherited).map((t) => t.id),
  };
}

/**
 * When a wholesale trigger replace drops a rung as redundant with an
 * inherited one, hand its cooldown stamp to the inherited rung.
 *
 * The inherited rung has a DIFFERENT id, so without this the thesis loses
 * that rung's fire history the first time the agent resends its ladder,
 * and a rung mid-cooldown can re-fire immediately — the 2026-06-02 NVDA
 * runaway shape. Returns a fresh state map; never mutates its input.
 */
export function carryOverDroppedFireState(
  droppedRungs: Trigger[],
  inherited: Trigger[],
  state: Record<string, { firedAt?: string; side?: string }>,
): Record<string, { firedAt?: string; side?: string }> {
  const out = { ...state };
  const inheritedByBucket = new Map(inherited.map((t) => [triggerBucket(t), t]));
  for (const t of droppedRungs) {
    if (!t.lastFiredAt) continue;
    const target = inheritedByBucket.get(triggerBucket(t));
    if (!target) continue;
    // Keep the LATER of the two — the inherited rung may already have
    // fired on its own since the copy was made.
    if ((out[target.id]?.firedAt ?? "") < t.lastFiredAt) {
      out[target.id] = { ...out[target.id], firedAt: t.lastFiredAt };
    }
  }
  return out;
}
