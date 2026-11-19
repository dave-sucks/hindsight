/**
 * The Discovery agent's record (docs/plans/AGENT_ENGINE.md): one analyst's
 * search for stocks it doesn't cover yet, sent to the Writer with a brief.
 * Its instructions: the analyst, then its own text. Its context: the
 * analyst's book and the earnings calendar outside it. Its tools: the lists
 * and the reads, and the Writer's dispatch. Its message is the schedule's
 * kickoff (its line in lib/agent/engine/schedule.ts, off until the owner
 * turns it on); lib/agent/discovery/run.ts reads its context and makes its
 * tools.
 *
 * DRAFT: its own text is drafted from docs/prompts/DISCOVERY_SESSION.md and
 * docs/DISCOVERY_PLAYBOOK.md for the owner to rewrite.
 */
import { MODES } from "@/lib/agent/modes";
import type { RunnableRecord } from "../types";

/** The most stocks one run sends to the Writer; the tool refuses the next. */
export const SENDS_A_RUN = 3;

export const DISCOVERY: RunnableRecord = {
  id: "discovery",
  name: "Discovery",
  does: "Finds stocks one analyst doesn't cover yet that fit its playbooks, and sends the best to the Writer with a brief. Its own text is a draft for you to rewrite.",
  messageFrom: "The schedule (lib/agent/engine/schedule.ts): its kickoff.",
  // The morning runs' model.
  model: MODES["research-run"].model,
  maxSteps: 30,
  // 30 seconds inside the 800 the function it runs in may take (app/api/inngest/route.ts).
  timeoutMs: 770_000,
  instructions: ["the_analyst", "discovery.md"],
  context: ["the_book", "earnings_calendar", "message"],
  tools: ["get_earnings_calendar", "run_screen", "get_market_movers", "get_stock_data", "web_search", "dispatch_thesis_research"],
  output: "Its write-up: each stock it sent to the Writer and why, the best it passed on and why, and what its lists lacked.",
};
