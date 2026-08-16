/**
 * Seeding an account's standing trigger rules.
 *
 * Until 2026-08-16 the universal minimums (±7% scale-ins, +10% gain
 * checkpoint, 8% trail, −12% loser review) lived only as code constants,
 * resolved as a fourth cascade level beneath ACCOUNT. That made them
 * visible but permanently uneditable: changing a floor meant a deploy,
 * and the account page had to explain a layer nobody could touch.
 *
 * They are now DATA. A new account is seeded with them as ordinary
 * account rules — same shape, same pills, fully editable — and the code
 * templates become the seed, not a runtime layer.
 *
 * ## Seeded vs deliberately empty
 *
 * `Account.triggersSeededAt` distinguishes "never seeded" from "the
 * principal deleted every rule." Without it, emptying your account rules
 * would silently resurrect the defaults on the next read, which is the
 * opposite of what deleting means. Unseeded → the fallback below applies
 * and we log; seeded → the stored array is authoritative, empty included.
 */

import { prisma } from "@/lib/prisma";
import {
  inheritableDefaultLadder,
  defaultCooldownDaysForPredicate,
  defaultFireModeForAction,
} from "./defaults";
import { STRATEGY_ARCHETYPES } from "@/lib/agent/knowledge/strategy-archetypes";
import type { Trigger } from "./types";

/**
 * The rules a fresh account starts with: the constant rungs every holding
 * should carry. Derived from the same templates that used to supply them
 * at runtime, so the numbers can't drift from `defaults.ts`.
 *
 * TARGET/HELD is the source template — it carries the full constant set
 * (the TRADE variant omits the pullback-add, which is a horizon nuance,
 * not an account-wide rule).
 */
export function accountSeedTriggers(): Trigger[] {
  return inheritableDefaultLadder("TARGET", "HELD").map((t) => ({
    ...t,
    // Fresh ids: these are real stored rows now, not the synthetic
    // `default:*` handles the old runtime layer used for fire-state keying.
    id: globalThis.crypto.randomUUID(),
  }));
}

/**
 * Write the starting rules onto an account. Idempotent — an account that
 * has already been seeded is left alone, so this is safe to call from a
 * backfill and from the signup path.
 */
export async function seedAccountTriggers(accountId: string): Promise<boolean> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { triggersSeededAt: true },
  });
  if (!account || account.triggersSeededAt != null) return false;

  await prisma.account.update({
    where: { id: accountId },
    data: {
      triggers: accountSeedTriggers() as unknown as object,
      triggersSeededAt: new Date(),
    },
  });
  return true;
}

/**
 * Safety net for an account that was never seeded — a signup that raced
 * the seeding write, or a row created before this existed and missed the
 * backfill. Returns the code constants so its holdings keep their
 * protection rather than silently running bare.
 *
 * This is NOT a cascade level: it never renders as "app default" and a
 * seeded account never reaches it. If you see the warning, that account
 * needs seeding.
 */
export function unseededAccountFallback(accountId: string): Trigger[] {
  console.warn(
    `[trigger-levels] account=${accountId} has no seeded standing rules — ` +
      `falling back to the code constants. Run seedAccountTriggers().`,
  );
  return inheritableDefaultLadder("TARGET", "HELD");
}

// ── Analyst seeding from a strategy archetype ─────────────────────────

/**
 * The analyst-level rules and entry style a new seat starts with, derived
 * from its strategy archetype.
 *
 * Deliberately sparse: an archetype only overrides where it GENUINELY
 * differs from the house rule — a scalper trailing 4%, a deep-value seat
 * 15%. Everything else inherits the account, which is what makes the
 * cascade worth having. Seeding a full copy of the account rules onto
 * every analyst would give each seat a frozen snapshot and make the
 * account page powerless, which is the drift this whole model exists to
 * prevent.
 *
 * Unknown/absent archetype ⇒ no rules, BREAKOUT entry: the historic
 * behavior, so a seat built without an archetype is unchanged.
 */
export function analystSeedFromArchetype(archetypeId: string | null | undefined): {
  entryTriggerMode: "BREAKOUT" | "DIP";
  triggers: Trigger[];
} {
  const archetype = STRATEGY_ARCHETYPES.find((a) => a.id === archetypeId);
  if (!archetype) return { entryTriggerMode: "BREAKOUT", triggers: [] };

  return {
    entryTriggerMode: archetype.defaultEntryMode,
    triggers: archetype.defaultTriggers.map((t) => ({
      id: globalThis.crypto.randomUUID(),
      predicate: t.predicate,
      action: t.action,
      rationale: t.rationale,
      cooldownDays: defaultCooldownDaysForPredicate(t.predicate),
      fireMode: defaultFireModeForAction(t.action),
      source: "DEFAULT" as const,
    })),
  };
}
