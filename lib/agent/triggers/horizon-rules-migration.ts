/**
 * One-time move of an account's sell rules to one set per horizon (DAV-250).
 *
 * Pure planner — the Inngest function (`migrate-horizon-rules`) loads the
 * rows, calls this, prints the plan on a dry run and writes it otherwise.
 *
 * Three steps, each idempotent:
 *
 *  1. Account. The legacy every-horizon rules in the four buckets the
 *     horizon sets now own (+10% review, 8% trail sell, −12% review, the
 *     pullback add) are replaced by `horizonStandingRules()`. Every other
 *     account rule — the review clock, earnings, the +7% add, anything the
 *     principal wrote — is kept as it is. An account already carrying a
 *     horizon-scoped rule is left alone.
 *
 *  2. Keep what protects today. For each held stock, a sell line it
 *     inherited that the new rules would loosen or drop is copied onto the
 *     thesis at its current value. Only the principal lowers a protective
 *     level (2026-08-16 ruling), and a migration is not the principal.
 *
 *  3. Loosen the named ones. For the tickers the principal named (Dave's
 *     ruling: ASML, CEG, WST — compounders carrying an 8% automatic sale
 *     their mandate forbids), the thesis's own trail sells tighter than the
 *     horizon's are removed, so the horizon's rules govern. This IS the
 *     principal lowering a level: by name, in the event payload.
 */

import { horizonStandingRules } from "./defaults";
import { triggerBucket } from "./bucket";
import { resolveThesisLadder } from "./load-levels";
import { protectiveRatchetViolations } from "./ratchet";
import type { Trigger } from "./types";

/** The buckets the horizon sets own. Legacy every-horizon rules here are replaced. */
const REPLACED_BUCKETS = new Set([
  "GAIN_FROM_ENTRY:UP::REVIEW",
  "TRAILING_FROM_HIGH::EXIT",
  "GAIN_FROM_ENTRY:DOWN::REVIEW",
  "PRICE_MOVE_PCT:1D:DOWN::ADD",
]);

const scopeKey = (t: Trigger) => (t.horizons?.length ? [...t.horizons].sort().join(",") : "*");

export interface HeldThesisRow {
  id: string;
  ticker: string;
  horizon: string | null;
  direction: string | null;
  triggers: Trigger[];
  /** The owning analyst's own standing rules. */
  analystRules: Trigger[];
}

export interface ThesisChange {
  thesisId: string;
  ticker: string;
  /** Inherited sell lines copied onto the thesis at today's value. */
  pinned: Trigger[];
  /** The thesis's own trail sells removed at the principal's request. */
  loosened: Trigger[];
  nextTriggers: Trigger[];
}

export interface HorizonRulesPlan {
  /** Null when the account already has horizon-scoped rules. */
  account: { removed: Trigger[]; added: Trigger[]; next: Trigger[] } | null;
  theses: ThesisChange[];
  /** Named tickers that aren't held, or aren't compounders — reported, not acted on. */
  warnings: string[];
}

export function planHorizonRules(args: {
  account: Trigger[];
  held: HeldThesisRow[];
  loosen: string[];
  mintId: () => string;
}): HorizonRulesPlan {
  const warnings: string[] = [];
  const alreadyScoped = args.account.some((t) => t.horizons?.length);

  let account: HorizonRulesPlan["account"] = null;
  let nextAccount = args.account;
  if (!alreadyScoped) {
    const removed = args.account.filter((t) => REPLACED_BUCKETS.has(triggerBucket(t)));
    const kept = args.account.filter((t) => !REPLACED_BUCKETS.has(triggerBucket(t)));
    const have = new Set(kept.map((t) => `${triggerBucket(t)}@${scopeKey(t)}`));
    const added = horizonStandingRules().filter(
      (t) => !have.has(`${triggerBucket(t)}@${scopeKey(t)}`),
    );
    nextAccount = [...kept, ...added];
    account = { removed, added, next: nextAccount };
  }

  const loosen = new Set(args.loosen.map((t) => t.toUpperCase()));
  for (const ticker of loosen) {
    const row = args.held.find((h) => h.ticker.toUpperCase() === ticker);
    if (!row) warnings.push(`${ticker}: not held — nothing to loosen.`);
    else if (row.horizon !== "COMPOUNDER") {
      warnings.push(`${ticker}: horizon is ${row.horizon ?? "none"}, not COMPOUNDER — left as it is.`);
    }
  }

  const theses: ThesisChange[] = [];
  for (const row of args.held) {
    const ladderRow = { triggers: row.triggers, status: "HOLDING", horizon: row.horizon, direction: row.direction };
    const before = resolveThesisLadder(ladderRow, { analyst: row.analystRules, account: args.account });
    const after = resolveThesisLadder(ladderRow, { analyst: row.analystRules, account: nextAccount });

    // Step 2: every sell line the new inheritance loosens or drops is kept
    // at today's value, on the thesis.
    const violations = protectiveRatchetViolations({
      direction: row.direction,
      before: before as Trigger[],
      after: after as Trigger[],
      inherited: [],
    });
    const pinned: Trigger[] = violations
      .filter((v) => (before.find((t) => t.id === v.before.id)?.level ?? "THESIS") !== "THESIS")
      .map((v) => ({
        id: args.mintId(),
        predicate: v.before.predicate,
        action: v.before.action,
        rationale: `${v.before.rationale} (Kept on this stock when the account's sell rules moved to one set per horizon — only you lower it.)`,
        ...(v.before.cooldownDays != null ? { cooldownDays: v.before.cooldownDays } : {}),
        ...(v.before.fireMode ? { fireMode: v.before.fireMode } : {}),
        source: v.before.source ?? "DEFAULT",
      }));

    // Step 3: the principal's named loosenings — the thesis's own trail
    // sells tighter than the horizon's catastrophe line come off.
    let loosened: Trigger[] = [];
    if (loosen.has(row.ticker.toUpperCase()) && row.horizon === "COMPOUNDER") {
      // What the stock inherits once its own rule is gone — resolved without
      // the thesis rungs, since a thesis rung hides the inherited one.
      const inherited = resolveThesisLadder(
        { ...ladderRow, triggers: [] },
        { analyst: row.analystRules, account: nextAccount },
      );
      const horizonTrail = inherited
        .filter((t) => t.action === "EXIT" && t.predicate.kind === "TRAILING_FROM_HIGH")
        .map((t) => (t.predicate.kind === "TRAILING_FROM_HIGH" ? t.predicate.pct : Infinity));
      const line = Math.min(...horizonTrail, Infinity);
      loosened = row.triggers.filter(
        (t) =>
          t.action === "EXIT" &&
          t.predicate.kind === "TRAILING_FROM_HIGH" &&
          Number.isFinite(line) &&
          t.predicate.pct < line,
      );
      if (!Number.isFinite(line)) {
        warnings.push(`${row.ticker}: no compounder trail sell is inherited — refusing to remove its own.`);
      }
    }

    if (pinned.length === 0 && loosened.length === 0) continue;
    const gone = new Set(loosened.map((t) => t.id));
    theses.push({
      thesisId: row.id,
      ticker: row.ticker,
      pinned,
      loosened,
      nextTriggers: [...row.triggers.filter((t) => !gone.has(t.id)), ...pinned],
    });
  }

  return { account, theses, warnings };
}
