/**
 * The morning run's record (docs/plans/AGENT_ENGINE.md): one analyst's book,
 * walked at 10 AM on its run days (lib/inngest/functions/morning-research.ts)
 * or from the Run button (app/api/agent/[mode]/route.ts).
 *
 * Its instructions: morning-run.md, the same on every run (the regime's
 * rules in it; it imports the rules); the analyst it works for is sent
 * before it. Its context, read for the analyst: the market and the
 * portfolio, its book, the book's earnings and filings this week, and the
 * calls refused last time that no run has redone. Its message
 * is the schedule's kickoff, with the watched stocks at their buy price.
 */
import { MODES } from "@/lib/agent/modes";
import type { AgentRecord } from "../types";

/**
 * The schedule's kickoff: the start of the day, the cash when the portfolio
 * snapshot couldn't be read (else the snapshot says it), and the watched
 * stocks at their buy price this morning.
 */
export function morningKickoff(atBuy: readonly string[], cashUnread: number | null = null): string {
  return [
    "It's the start of the trading day. Run your morning playbook unattended — there is no human to respond to questions. Every turn must call a tool; text-only turns terminate the run as FAILED. End with complete_run.",
    ...(cashUnread != null ? [`The portfolio snapshot couldn't be read: cash is $${Math.round(cashUnread).toLocaleString()}.`] : []),
    ...(atBuy.length ? [`Watched stocks at their buy price this morning: ${atBuy.join(", ")}.`] : []),
  ].join("\n\n");
}

export const MORNING_RUN: AgentRecord = {
  id: "morning_run",
  name: "Morning run",
  does: "Walks one analyst's book and answers each stock on its work list: a trade (it waits for you), a trigger moved, or a note; then the run summary.",
  runsWhen: "10:00 AM ET on each analyst's run days, or when you press Run.",
  messageFrom: "The schedule's kickoff (lib/inngest/functions/morning-research.ts, or the Run button): the start of the day, and the watched stocks at their buy price.",
  subject: "analyst",
  model: MODES["research-run"].model,
  maxSteps: MODES["research-run"].maxSteps,
  // The analyst opens the instructions: in the first message, MU's review stopped lowering its conviction (3 of 3 runs to 0 of 3).
  instructions: ["the_analyst", "morning-run.md"],
  context: ["market_numbers", "market_digest", "portfolio", "portfolio_digest", "the_book", "earnings_this_week", "filings_this_week", "refused_calls", "message"],
  tools: MODES["research-run"].toolAllowlist ?? [],
  output: "A note or a trade proposal on each stock on its work list, then record_run_summary and complete_run.",
};
