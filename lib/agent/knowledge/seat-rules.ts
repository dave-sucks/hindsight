/**
 * seat-rules.ts — each seat's standing rules, from the playbook (DAV-280,
 * stage 8 of the rebuild).
 *
 * The rules an analyst carries on its Triggers tab, from its signature
 * setup — the first of `AgentConfig.setupIds` — and the playbook's E5 (the
 * trail), E6 (the time limit) and Part F (selling), as ruled on DAV-279
 * (2026-09-17). A new analyst starts with these instead of a blank tab; an
 * existing one can be re-seeded from them, shown as a diff first. Nothing here stamps onto a stock — this is
 * the analyst level of the cascade only. The stock's own exits from its
 * setup (the partial, the beat-that-sold review, the time limit from the
 * buy) are written at the fill by lib/agent/triggers/setup-exits.ts.
 *
 * The account keeps only what every seat shares (the review clock, the
 * earnings and filing wakes, the up-7% add).
 */

import type { Trigger, TriggerAction, TriggerPredicate } from "@/lib/agent/triggers/types";
import { COMPOUNDER_CATASTROPHE_PCT, COMPOUNDER_GIVEBACK_REVIEW_PCT, TRAIL_ATR_MULTIPLE, isNamedSetup, type SetupId } from "./setups";

export interface SeatRule {
  action: TriggerAction;
  predicate: TriggerPredicate;
  rationale: string;
  fireMode?: "TACTICAL" | "DIRECT";
  cooldownDays?: number;
}

/** PEAD (TARGET): E5 — a trail that arms once the drift has paid; the ±10/12 attention lines. */
const PEAD_RULES: SeatRule[] = [
  {
    action: "EXIT",
    predicate: { kind: "TRAILING_FROM_HIGH", pct: 12, armAtGainPct: 10, atrMultiple: TRAIL_ATR_MULTIPLE },
    rationale: `Gave back 12% from the high — or ${TRAIL_ATR_MULTIPLE}× this stock's average daily range if that is wider — once the position had been up 10%. Bank the drift without being shaken out by a volatile name (E5, TARGET).`,
    fireMode: "DIRECT",
    cooldownDays: 0,
  },
  {
    action: "REVIEW",
    predicate: { kind: "GAIN_FROM_ENTRY", pct: 10, direction: "UP" },
    rationale: "Up 10% from entry — re-underwrite: raise the floor under real structure and arm the next milestone.",
    cooldownDays: 7,
  },
  {
    action: "REVIEW",
    predicate: { kind: "GAIN_FROM_ENTRY", pct: 12, direction: "DOWN" },
    rationale: "Down 12% from entry — decide hold-vs-cut deliberately, before the floor decides for us.",
    cooldownDays: 7,
  },
];

/** Catalyst (CATALYST): the event is the exit — sell into the run-up before it, or be out by T+30 (D8, E6). */
const CATALYST_RULES: SeatRule[] = [
  {
    action: "REVIEW",
    predicate: { kind: "REVIEW_CADENCE", days: 10, from: "EVENT", side: "BEFORE" },
    rationale: "10 days before the event date on the thesis — the run-up version sells 1–2 weeks before the decision; the hold-through version checks its size can survive a −50% gap.",
    cooldownDays: 10,
  },
  {
    action: "REVIEW",
    predicate: { kind: "REVIEW_CADENCE", days: 30, from: "EVENT", side: "AFTER" },
    rationale: "30 days after the event date on the thesis — the hold-through exit (T+30). If it's still held, say why.",
    cooldownDays: 30,
  },
  {
    // DAV-268 (Dave, 2026-09-15): FDA outcomes are usually filed as "other
    // events" or a press release, which the account's material-tier wake
    // treats as routine. A catalyst seat wakes on them; other seats would drown.
    action: "REVIEW",
    predicate: { kind: "SEC_EVENT", items: ["8.01", "7.01"] },
    rationale: "An 'other events' or press-release filing — where FDA outcomes and trial readouts land. Read it before the market finishes pricing it.",
    cooldownDays: 1,
  },
];

/** Compounder (COMPOUNDER): only a named invalidation sells; price alarms are reviews; one catastrophe line (D11, F). */
const COMPOUNDER_RULES: SeatRule[] = [
  {
    action: "REVIEW",
    predicate: { kind: "TRAILING_FROM_HIGH", pct: COMPOUNDER_GIVEBACK_REVIEW_PCT },
    rationale: `Gave back ${COMPOUNDER_GIVEBACK_REVIEW_PCT}% from the high. This is a question, not a sale: is the reason we bought still true? If yes, hold and raise the floor under structure.`,
    cooldownDays: 7,
  },
  {
    action: "EXIT",
    predicate: { kind: "TRAILING_FROM_HIGH", pct: COMPOUNDER_CATASTROPHE_PCT, atrMultiple: TRAIL_ATR_MULTIPLE },
    rationale: `Gave back ${COMPOUNDER_CATASTROPHE_PCT}% from the high — or ${TRAIL_ATR_MULTIPLE}× this stock's average daily range if that is wider — the catastrophe line for a multi-year hold, and the only automatic sale.`,
    fireMode: "DIRECT",
    cooldownDays: 0,
  },
  {
    action: "REVIEW",
    predicate: { kind: "VS_SMA", period: 200, direction: "BELOW" },
    rationale: "Below the 200-day — the long trend is in question. Review the business, not the chart.",
    cooldownDays: 7,
  },
  {
    action: "REVIEW",
    predicate: { kind: "GAIN_FROM_ENTRY", pct: 15, direction: "UP" },
    rationale: "Up 15% from entry — the second tranche question: is the thesis playing out, and is the floor under the earned gain?",
    cooldownDays: 7,
  },
  {
    action: "REVIEW",
    predicate: { kind: "GAIN_FROM_ENTRY", pct: 15, direction: "DOWN" },
    rationale: "Down 15% from entry — is the reason we bought still true? A price alarm on a compounder opens a review, never a sale.",
    cooldownDays: 7,
  },
  {
    action: "ADD",
    predicate: { kind: "PRICE_MOVE_PCT", pct: 7, direction: "DOWN", window: "1D" },
    rationale: "Down 7% in a day — the second tranche on a held 50-day pullback in a market-wide dip with the thesis intact. Never into company-specific bad news. This seat's rule, not the account's: trades never average down.",
    cooldownDays: 3,
  },
];

/** By signature setup. A setup not listed (a breakout, a pullback) carries no seat rules of its own. */
export const SETUP_STANDING_RULES: Partial<Record<SetupId, SeatRule[]>> = {
  PEAD: PEAD_RULES,
  PRE_CATALYST: CATALYST_RULES,
  COMPOUNDER_ACCUMULATION: COMPOUNDER_RULES,
};

/** The analyst's signature setup: the first of its setups. */
export function signatureSetup(setupIds: readonly string[] | null | undefined): SetupId | null {
  const first = (setupIds ?? []).find(isNamedSetup);
  return first ?? null;
}

/** The analyst's rules as triggers with fresh ids, stamped DEFAULT (a template minted them). */
export function analystStandingTriggers(setupIds: readonly string[] | null | undefined, mintId: () => string): Trigger[] {
  const sig = signatureSetup(setupIds);
  return ((sig && SETUP_STANDING_RULES[sig]) ?? []).map((r) => ({
    id: mintId(),
    action: r.action,
    predicate: r.predicate,
    rationale: r.rationale,
    ...(r.fireMode ? { fireMode: r.fireMode } : {}),
    ...(r.cooldownDays != null ? { cooldownDays: r.cooldownDays } : {}),
    source: "DEFAULT" as const,
  }));
}
