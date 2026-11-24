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
 * templates become the seed, not a runtime layer. The seed is the reviewed
 * rule set (expert review 1.1): the review clock, the trail off the high,
 * the big-day looks, and the earnings and filing wakes.
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
import { accountStandingRules, reviewCadenceTrigger } from "./defaults";
import { triggerSlot } from "./condition/slot";
import type { Trigger } from "./types";
import { withFireMode } from "./fire-mode";

/**
 * Earnings is not opt-in. Anything the account holds or watches gets a look
 * in the 5 days before it reports and a look the day after — a standing WAKE,
 * not a clock: it costs nothing until the company reports. 5 days, not 3, so
 * the morning run (which a Flag for Review waits for) always sees it before
 * the report, even on a Monday, Wednesday and Friday schedule. The look after
 * is sent to the agent at once: the first days after a report are when the
 * drift is decided (Bernard and Thomas 1989), and the next morning run can be
 * two days away. Overridable per name through the ordinary cascade; deletable
 * here like any account rule. Expert review 1.1 (docs/plans/EXPERT_REVIEW_1_1.md).
 */
export function earningsStandingTriggers(): Trigger[] {
  return [
    {
      id: "seed:earnings-within",
      predicate: { watch: "report", is: "before", value: 5 },
      action: "REVIEW",
      rationale: "A look before the report, while there is still time to size for the gap.",
      source: "DEFAULT",
    },
    // One look on every report, beat or miss: a stock's own after-report review shares its slot and replaces it.
    {
      id: "seed:earnings-after",
      predicate: { watch: "report", is: "after", value: 1 },
      action: "REVIEW",
      fireMode: "ASK_NOW",
      rationale:
        "A look the day after the report, while the market is still deciding what it means.",
      source: "DEFAULT",
    },
  ];
}

/**
 * SEC filings are not opt-in either (principal ruling 2026-09-15). One rule:
 * a material filing — or anything serious — on a held or watched name wakes
 * a review. A red filing on a stock we own goes to a tactical run the same
 * day; the evaluator decides that from the filing, so there is no second
 * rule to keep in step. Costs nothing until a company files.
 * See docs/plans/SEC_FILINGS.md §4.
 */
export function secFilingStandingTriggers(): Trigger[] {
  return [
    {
      id: "seed:sec-material",
      predicate: { watch: "filing", variable: "tier:MATERIAL" },
      action: "REVIEW",
      rationale:
        "Filed something material with the SEC — read the filing first; the code says what happened, not whether it's good. A restatement or bankruptcy breaks the numbers; an officer leaving or a deal can change the story.",
      source: "DEFAULT",
    },
  ];
}

/** The standing wakes every account carries: earnings and SEC filings. */
function standingWakeTriggers(): Trigger[] {
  return [...earningsStandingTriggers(), ...secFilingStandingTriggers()];
}

export function accountSeedTriggers(): Trigger[] {
  return [
    // The review clock for a stock with none of its own: a weekly look, as a
    // desk goes over its whole book each weekend. A playbook's own clock
    // (30 days on a compounder) replaces it through the ordinary cascade.
    reviewCadenceTrigger(7),
    // The trail on every holding and the big-day looks (defaults.ts).
    ...accountStandingRules(),
    ...standingWakeTriggers(),
  ].map((t) =>
    withFireMode({
      ...t,
      // Fresh ids: these are real stored rows now, not the synthetic
      // `default:*` handles the old runtime layer used for fire-state keying.
      id: globalThis.crypto.randomUUID(),
    }),
  );
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
 * This is NOT a cascade level: its rules resolve as ACCOUNT rules, and a
 * seeded account never reaches it. If you see the warning, that account
 * needs seeding. Its ids are the same on every read, so a rule that fired
 * keeps its fire state: a fresh id would make the trail fire on every check.
 */
export function unseededAccountFallback(accountId: string): Trigger[] {
  console.warn(
    `[trigger-levels] account=${accountId} has no seeded standing rules — ` +
      `falling back to the code constants. Run seedAccountTriggers().`,
  );
  return accountStandingRules().map((t) => ({ ...t, id: `fallback:${triggerSlot(t)}` }));
}
