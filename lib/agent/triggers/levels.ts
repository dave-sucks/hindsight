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
 * Structural equality over predicates. `triggerBucket` already matched
 * the KIND and the discriminating fields, so this is really asking "same
 * numbers?" — JSON comparison over sorted keys is sufficient and stays
 * correct as new predicate kinds are added.
 */
function samePredicateValue(a: Trigger["predicate"], b: Trigger["predicate"]): boolean {
  const norm = (p: unknown): string =>
    JSON.stringify(p, (_k, v: unknown) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>).sort(([x], [y]) =>
              x.localeCompare(y),
            ),
          )
        : v,
    );
  return norm(a) === norm(b);
}

export function resolveLadder(input: LadderLevels): ResolvedTrigger[] {
  const byLevel: Record<TriggerLevel, Trigger[]> = {
    THESIS: input.thesis ?? [],
    ANALYST: input.analyst ?? [],
    ACCOUNT: input.account ?? [],
    DEFAULT: input.defaults ?? [],
  };

  const claimed = new Set<string>();
  const out: ResolvedTrigger[] = [];
  // Bucket → the winning rung's index in `out`, so a later (lower) level
  // can record itself as the thing that rung overrode.
  const winnerIndexByBucket = new Map<string, number>();

  for (const level of LEVEL_PRECEDENCE) {
    for (const t of byLevel[level]) {
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
