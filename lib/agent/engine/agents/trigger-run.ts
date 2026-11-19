/**
 * The trigger run's record (docs/plans/AGENT_ENGINE.md): one stock, one fired
 * trigger, one decision: a trade (it waits for you), a trigger moved, or a
 * note on why nothing (lib/inngest/functions/tactical-run.ts runs it). A
 * trigger set to Auto makes its trade itself, and the post-trade write-up
 * (./post-trade-writeup.ts) writes the note on it.
 *
 * Its instructions: trigger-run.md, the same on every run (it imports the
 * rules). Sent with them: the analyst it works for before, the stock's
 * playbook after, and the stock's situations last, because among the facts
 * they were followed less (the NVDA declined sale went from 6 of 6 to 3 of 6,
 * docs/plans/AGENT_ENGINE.md). Its context: the market numbers and the stock.
 * Its message is the fire, from the trigger check.
 */
import { MODES } from "@/lib/agent/modes";
import type { AgentRecord } from "../types";

/** The ask that ends the trigger run's message. */
export const TRIGGER_RUN_ASK = "Find out what is going on with the company and the stock, decide, act if warranted, then write your review with update_thesis. You are running unattended — no human will respond. Every turn must call a tool; text-only turns terminate the run as FAILED.";

export const TRIGGER_RUN: AgentRecord = {
  id: "trigger_run",
  name: "Trigger run",
  does: "Decides on one stock when one of its triggers fires: a trade (it waits for you), a trigger moved, or a note on why nothing.",
  runsWhen: "Every 5 minutes in market hours and at the 4:20 PM close check, when a trigger set to Send to Agent fires.",
  messageFrom: "The trigger check (lib/inngest/functions/tactical-run.ts): the trigger that fired, the price it fired at and the fire's facts, then the ask.",
  subject: "thesis",
  model: MODES["tactical"].model,
  maxSteps: MODES["tactical"].maxSteps,
  // The playbooks only on a review of a stock we watch (the run passes none otherwise); the stock's situations end the instructions.
  instructions: ["the_analyst", "trigger-run.md", "the_playbook", "situations"],
  // The market numbers alone: the snapshot and the digests are the rest of the account (2026-11-18). The stock's
  // position is on its row, the analyst's room in its text, and code sizes a buy.
  context: ["market_numbers", "the_stock", "message"],
  tools: MODES["tactical"].toolAllowlist ?? [],
  output: "One update_thesis note on the stock (the reason on any trade it proposed), at most one trade proposal, then complete_run.",
};
