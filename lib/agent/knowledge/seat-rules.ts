/**
 * seat-rules.ts — each seat's standing rules, from the playbook (DAV-280,
 * stage 8 of the rebuild).
 *
 * The rules an analyst carries on its Triggers tab, from its signature
 * setup — the first of `AgentConfig.setupIds` — and the playbook's E6 (the
 * time limit) and Part F (selling), as ruled on DAV-279 (2026-09-17). No seat
 * carries a sale or an add on a down day: the account's own sale rules govern
 * every holding. A new analyst starts with these instead of a blank tab; an
 * existing one can be re-seeded from them, shown as a diff first. Nothing here stamps onto a stock — this is
 * the analyst level of the cascade only. The stock's own exits from its
 * setup (the partial, the beat-that-sold review, the time limit from the
 * buy) are written at the fill by lib/agent/triggers/setup-exits.ts.
 *
 * The account keeps only what every seat shares (the review clock, the
 * earnings and filing wakes, the up-7% add).
 */

import type { Trigger, TriggerAction } from "@/lib/agent/triggers/types";
import { withFireMode, type FireMode } from "@/lib/agent/triggers/fire-mode";
import { COMPOUNDER_GIVEBACK_REVIEW_PCT, isNamedSetup, type SetupId } from "./setups";
import type { When } from "@/lib/agent/triggers/condition";

export interface SeatRule {
  action: TriggerAction;
  predicate: When;
  rationale: string;
  fireMode?: FireMode;
  cooldownDays?: number;
}

/** PEAD (TARGET): the ±10/12 attention lines. */
const PEAD_RULES: SeatRule[] = [
  {
    action: "REVIEW",
    predicate: { watch: "move", is: "above", value: 10, variable: "entry" },
    rationale: "Up 10% from our buy: look again, move the stop up under the gain, and set the next level to watch.",
    cooldownDays: 7,
  },
  {
    action: "REVIEW",
    predicate: { watch: "move", is: "below", value: 12, variable: "entry" },
    rationale: "Down 12% from our buy: decide on purpose whether to hold or sell, before the stop decides for us.",
    cooldownDays: 7,
  },
];

/** Catalyst (CATALYST): the event is the exit — sell into the run-up before it, or be out by T+30 (D8, E6). */
const CATALYST_RULES: SeatRule[] = [
  {
    action: "REVIEW",
    predicate: { watch: "from_date", is: "before", value: 10, variable: "event" },
    rationale: "10 days before the company's event: if we own it for the run-up, this is when to sell, one to two weeks before the decision; if we're holding through it, check the position could take a 50% drop on bad news.",
    cooldownDays: 10,
  },
  {
    action: "REVIEW",
    predicate: { watch: "from_date", is: "after", value: 30, variable: "event" },
    rationale: "30 days after the company's event: if we still own it, sell, or say why we're keeping it.",
    cooldownDays: 30,
  },
  {
    // DAV-268 (Dave, 2026-09-15): FDA outcomes are usually filed as "other
    // events" or a press release, which the account's material-tier wake
    // treats as routine. A catalyst seat wakes on them; other seats would drown.
    action: "REVIEW",
    predicate: { match: "any", conditions: [{ watch: "filing", variable: "item:8.01" }, { watch: "filing", variable: "item:7.01" }] },
    rationale: "The company filed an 'other events' report or a press release, which is where FDA decisions and trial results show up. Read it before the market finishes reacting.",
    cooldownDays: 1,
  },
];

/** Compounder (COMPOUNDER): only a named invalidation sells; price alarms are reviews (D11, F). */
const COMPOUNDER_RULES: SeatRule[] = [
  {
    action: "REVIEW",
    predicate: { watch: "move", is: "below", value: COMPOUNDER_GIVEBACK_REVIEW_PCT, variable: "peak" },
    rationale: `Down ${COMPOUNDER_GIVEBACK_REVIEW_PCT}% from its high. A question, not a sale: is the reason we bought still true? If it is, hold, and move the stop up under the gain.`,
    cooldownDays: 7,
  },
  {
    action: "REVIEW",
    predicate: { watch: "price", is: "below", variable: "sma200" },
    rationale: "Below its 200-day average: the long-term trend is in doubt. Look at the business, not just the chart.",
    cooldownDays: 7,
  },
  {
    action: "REVIEW",
    predicate: { watch: "move", is: "above", value: 15, variable: "entry" },
    rationale: "Up 15% from our buy: is the business doing what we bought it for? If so, it may be time to buy the second half, with the stop moved up under the gain.",
    cooldownDays: 7,
  },
  {
    action: "REVIEW",
    predicate: { watch: "move", is: "below", value: 15, variable: "entry" },
    rationale: "Down 15% from our buy: is the reason we bought still true? For a long-term holding, a drop like this means a closer look, never an automatic sale.",
    cooldownDays: 7,
  },
];

/** By signature setup. A setup not listed (a breakout, a pullback) carries no seat rules of its own. */
export const SETUP_STANDING_RULES: Partial<Record<SetupId, SeatRule[]>> = {
  PEAD: PEAD_RULES,
  PRE_CATALYST: CATALYST_RULES,
  COMPOUNDER_ACCUMULATION: COMPOUNDER_RULES,
};

/** These rules' earlier words, which the analysts' rows still carry, most stored as set by hand. */
const EARLIER_WORDS = [
  "Up 10% from entry — re-underwrite: raise the floor under real structure and arm the next milestone.",
  "Down 12% from entry — decide hold-vs-cut deliberately, before the floor decides for us.",
  "10 days before the event date on the thesis: decide the size into the event — hold, trim, or step aside (DAV-279 ruling).",
  "30 days after the event date on the thesis: the catalyst has played; is there a reason to still own it? (DAV-279 ruling)",
  "An 'other events' or press-release filing — where FDA outcomes and trial readouts land. Read it before the market finishes pricing it.",
  "Gave back 15% from the high. This is a question, not a sale: is the reason we bought still true? If yes, hold and raise the floor under real structure (the 20-day low, the breakout level). If partly, trim. Sell only if you can name what broke in the business.",
  "Below the 200-day — the long trend is in question. Review the business, not the chart.",
  "Up 15% from entry — re-underwrite at the new price and raise the floor under real structure (DAV-279 ruling).",
  "Down 15% from entry — decide hold-vs-cut deliberately, before the stop decides (DAV-279 ruling).",
];

/** Every note a seat rule writes or once wrote: a template's, never an analyst's (lib/agent/triggers/note.ts). */
export const SEAT_RULE_NOTES: readonly string[] = [...Object.values(SETUP_STANDING_RULES).flatMap((rules) => (rules ?? []).map((r) => r.rationale)), ...EARLIER_WORDS];

/** The analyst's signature setup: the first of its setups. */
export function signatureSetup(setupIds: readonly string[] | null | undefined): SetupId | null {
  const first = (setupIds ?? []).find(isNamedSetup);
  return first ?? null;
}

/** The analyst's rules as triggers with fresh ids, stamped DEFAULT (a template minted them). */
export function analystStandingTriggers(setupIds: readonly string[] | null | undefined, mintId: () => string): Trigger[] {
  const sig = signatureSetup(setupIds);
  return ((sig && SETUP_STANDING_RULES[sig]) ?? []).map((r) =>
    withFireMode({
      id: mintId(),
      action: r.action,
      predicate: r.predicate,
      rationale: r.rationale,
      ...(r.fireMode ? { fireMode: r.fireMode } : {}),
      ...(r.cooldownDays != null ? { cooldownDays: r.cooldownDays } : {}),
      source: "DEFAULT" as const,
    }),
  );
}
