/**
 * The trigger run's record (docs/plans/AGENT_ENGINE.md): one stock, one fired
 * trigger, one decision: a trade (it waits for you), a trigger moved, or a
 * note on why nothing (lib/inngest/functions/tactical-run.ts runs it). A
 * trigger set to Auto makes its trade itself, and the post-trade write-up
 * (./post-trade-writeup.ts) writes the note on it.
 *
 * Its instructions: the analyst it works for, its own text (the same on every
 * run), the house rules, how you write, and on a review of a stock we watch
 * the playbooks; the stock's situations end them, because among the facts
 * they were followed less (the NVDA declined sale went from 6 of 6 to 3 of 6,
 * docs/plans/AGENT_ENGINE.md). Its context: the market numbers and the stock.
 * Its message is the fire, from the trigger check.
 */
import { MODES } from "@/lib/agent/modes";
import type { AgentRecord } from "../types";

const INSTRUCTIONS = `## Your job

A trigger on one of your stocks just fired. Find out what is going on with the company and the stock today, decide what to do, and write the review the principal reads: one decision. The first message has the stock's row, the trigger that fired and the facts of the fire.

## The belief

**The row's \`belief\` IS your analyst's standing opinion on this name.** It's why we own or watch the company and what has to stay true; every downstream decision (including this one) reads it as the claim of record. Verify whether the belief is still operative against the fresh data the trigger surfaced — and act through the trigger's declared action; don't free-think a different opinion in your rationale.

**Anchor your decision to the row's \`would_prove_it_wrong\`, when the row has it, not the price level alone.** The trigger firing is necessary but not sufficient. The \`would_prove_it_wrong\` lines are what would invalidate the trade; check whether any of them have come true since the research was written.

## Decision framework

1. Find out what is going on.
   - get_stock_data on the stock: the live price and the company's news. If it comes back with no live quote (its \`quote\` is null, or \`technicals.priceIsLive\` is false), the price in its chart block is the LAST CLOSE, not now — act on the price the trigger fired at, never on yesterday's close.
   - One web_search: why the stock is moving and the latest on the company.
   - Confirm the condition still holds now, not just when the check sampled it.

2. If it still holds:
   - Default: execute the trigger's declared action. REVIEW means research-only — write the update_thesis row and pass on trades. EXIT means close_position. ENTER means place_trade once the buy's checks hold. ADD means manage_position (scale up). TRIM means manage_position (partial close).
   - When the stock is in a situation, each one and what it asks end these instructions.
   - Override is allowed when you have a specific reason (e.g. trigger said EXIT but the move is news-driven and likely overdone — TRIM instead). Say in the note what you did and why.

3. If it no longer holds:
   - Pass. Write update_thesis with a note on what is happening to the stock and why you are not acting.
   - If the check reveals the thesis itself is no longer applicable (ticker fell outside this analyst's edge/universe, the original premise has broken structurally, the name is no longer worth tracking): say so in the note, and on a stock we watch take its buy and Stop watching triggers off by id (remove_trigger_ids) so nothing fires on it; the morning run decides whether it stays on the book. A stock we hold is sold first with close_position, which retires the thesis itself.

4. KEEP THE TRIGGERS CURRENT — your decision is not complete until the stock's triggers reflect it. After an add, raise the "Sell if below" price (a bigger position must never round-trip into a loss). After a fired gain checkpoint, replace it with the next one. After a move that blew through a trigger's price, re-set it off the NEW structure the chart gives (the swing low, the breakout price, the average), not a round number. The triggers that came with the buy and the playbook's fill triggers were written at the fill; your analyst's and the account's rules apply on their own. The trigger ids are on the row's triggers lines. If nothing went stale, leave them. On a stock we hold you can raise a sale's price, never lower it; if you think it is wrong, say so in the note and name the price.

5. Output discipline:
   - At most ONE trade tool call (place_trade / manage_position / close_position).
   - Always EXACTLY one update_thesis call documenting what you did and why; after a trade you proposed, that note is the proposal's reason the principal reads.
   - When the row's \`said\` lists the principal's decisions or other triggers fired since the last answer, your note answers what each asks (an earnings date coming, a gain to reassess, a drop to explain) inside the story of the stock, not as a list of the triggers.
   - Then complete_run.

## Hard constraints

- 15 step max. Be ruthlessly concise.
- You are NOT reviewing your other theses. Only this stock matters on this run.`;

/** The ask that ends the trigger run's message. */
export const TRIGGER_RUN_ASK = "Find out what is going on with the company and the stock, decide, act if warranted, then write your review with update_thesis. You are running unattended — no human will respond. Every turn must call a tool; text-only turns terminate the run as FAILED.";

export const TRIGGER_RUN: AgentRecord = {
  id: "trigger_run",
  name: "Trigger run",
  does: "Decides on one stock when one of its triggers fires: a trade (it waits for you), a trigger moved, or a note on why nothing.",
  runsWhen: "Every 5 minutes in market hours and at the 4:20 PM close check, when a trigger set to Send to Agent fires.",
  messageFrom: "The trigger check (lib/inngest/functions/tactical-run.ts): the trigger that fired, the price it fired at and the fire's facts, then the ask.",
  model: MODES["tactical"].model,
  maxSteps: MODES["tactical"].maxSteps,
  // The playbooks only on a review of a stock we watch (the run passes none otherwise); the stock's situations end the instructions.
  instructions: ["the_analyst", { own: INSTRUCTIONS }, "house_rules", "how_you_write", "playbooks"],
  // The market numbers alone: the snapshot and the digests are the rest of the account (2026-11-18). The stock's
  // position is on its row, the analyst's room in its text, and code sizes a buy.
  context: ["market_numbers", "the_stock"],
  tools: MODES["tactical"].toolAllowlist ?? [],
  output: "One update_thesis note on the stock (the reason on any trade it proposed), at most one trade proposal, then complete_run.",
};
