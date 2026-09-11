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
import { horizonStandingRules, reviewCadenceTrigger } from "./defaults";
import { triggerBucket } from "./bucket";
import type { Trigger } from "./types";

/**
 * Earnings is not opt-in. Anything the account holds or watches gets a look
 * three days before it reports and a look on the report — a standing WAKE,
 * not a clock: it costs nothing until the company actually reports, and
 * then a look is exactly what a watch is for. Overridable per name through
 * the ordinary cascade; deletable here like any account rule. A REVIEW
 * fire on a watch lands in the next morning's batch — no per-trigger AI.
 * See docs/plans/MARKET_DATA.md §3.
 */
export function earningsStandingTriggers(): Trigger[] {
  return [
    {
      id: "seed:earnings-within",
      predicate: { kind: "EARNINGS_WITHIN", days: 3 },
      action: "REVIEW",
      rationale:
        "Reports within 3 days — decide before the print: hold through it, trim, or wait to add. Size for the gap.",
      cooldownDays: 30,
      source: "DEFAULT",
    },
    {
      id: "seed:earnings-beat",
      predicate: { kind: "EARNINGS_BEAT" },
      action: "REVIEW",
      rationale:
        "Reported a beat — re-underwrite. A clean beat-and-raise earns a higher target; a beat the stock sold on means the market wanted more.",
      cooldownDays: 7,
      source: "DEFAULT",
    },
    {
      id: "seed:earnings-miss",
      predicate: { kind: "EARNINGS_MISS" },
      action: "REVIEW",
      rationale:
        "Reported a miss — is the thesis wrong, or early? Decide deliberately before the stop decides for us.",
      cooldownDays: 7,
      source: "DEFAULT",
    },
  ];
}

/**
 * Accounts seeded before this date never got the earnings rules. One-time
 * top-up: `ensureAccountStandingRules` adds them and bumps the seed stamp,
 * so a later deletion by the principal sticks.
 */
const EARNINGS_RULES_SINCE = new Date("2026-09-10T00:00:00Z");

export function accountSeedTriggers(): Trigger[] {
  return [
    // Review cadence is a standing account rule now, not a date column on
    // every thesis. 7 days is the TARGET-horizon default the old
    // HORIZON_REVIEW_DAYS table used; a CATALYST or TRADE thesis overrides
    // it with a tighter one through the ordinary cascade.
    reviewCadenceTrigger(7),
    // The sell rules, one set per horizon (DAV-250) — a trade's 8% trail
    // and a compounder's 25% catastrophe line live side by side, each
    // applying only to theses of its horizon.
    ...horizonStandingRules(),
    ...earningsStandingTriggers(),
  ].map((t) => ({
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
 * Bring an already-seeded account up to the current standing set — today,
 * the earnings rules. Runs at the top of every morning run and is a no-op
 * once the seed stamp is past `EARNINGS_RULES_SINCE`, which is what keeps
 * it from resurrecting a rule the principal deleted: added once, stamped,
 * never again. Unseeded accounts go through the normal seed. Returns how
 * many rules were added.
 */
export async function ensureAccountStandingRules(accountId: string): Promise<number> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { triggers: true, triggersSeededAt: true },
  });
  if (!account) return 0;
  if (account.triggersSeededAt == null) {
    return (await seedAccountTriggers(accountId)) ? accountSeedTriggers().length : 0;
  }
  if (account.triggersSeededAt >= EARNINGS_RULES_SINCE) return 0;

  const current = Array.isArray(account.triggers) ? (account.triggers as unknown as Trigger[]) : [];
  const have = new Set(current.map(triggerBucket));
  const missing = earningsStandingTriggers()
    .filter((t) => !have.has(triggerBucket(t)))
    .map((t) => ({ ...t, id: globalThis.crypto.randomUUID() }));

  await prisma.account.update({
    where: { id: accountId },
    data: {
      triggers: [...current, ...missing] as unknown as object,
      triggersSeededAt: new Date(),
    },
  });
  return missing.length;
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
  return horizonStandingRules();
}
