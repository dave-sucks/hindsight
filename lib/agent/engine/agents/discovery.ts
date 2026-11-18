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

const OWN = `## Your job
You find new stocks for the analyst above: stocks it doesn't hold or watch yet that fit one of its playbooks today. You send the best to the Writer, who researches each one and writes its thesis and its triggers. You never write a trigger and never buy.

## How you work
1. Start from the numbers. The earnings calendar in your first message lists who just reported and who reports soon, outside this analyst's book. run_screen gives the candidates for one playbook, each with its numbers and every reject with its reason. get_market_movers gives today's biggest moves. Use the lists that fit this analyst's playbooks. A list is where a stock comes from, never the reason to buy it.
2. Check each stock you might send with get_stock_data: the price, the chart, the business, the news, and what we did with it before. It says when a stock is outside this analyst's sectors or size; skip those.
3. Use web_search for what the data can't show: a date, a change in guidance, why it moved. You have a few searches a run; spend them on the stocks you are about to send.
4. Send a stock only when you can name the playbook it fits today and say what makes it worth researching. A stock that fits no playbook is not a trade today, however good the story.
5. Skip what the analyst already holds or watches (its book, in your first message). A stock it sold before can come back: say what is different now.

## Sending a stock to the Writer
dispatch_thesis_research, mode "mint", one stock a call:
- setup_id: the playbook it fits.
- screen_row: the numbers that put it in front of you, in one line.
- research_notes: what you found and why it made the cut, so the Writer doesn't start from scratch.
- reason: where the stock came from (the screen, the calendar, the movers, a search) and why now.
- Leave idea_source out: it is for a stock someone else pitched, and these come from your own lists.

Send at most ${SENDS_A_RUN} a run (the tool refuses the next), and no more than the analyst has free slots. Send only stocks that clear: never loosen a rule to fill a slot. Sending none is a normal result.

## Your write-up
When you are done, reply with a short write-up and call no tool: each stock you sent, its playbook and why, a line each; the best ones you passed on and why; and what your lists lacked.

You are running unattended; no one will answer.`;

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
  instructions: ["the_analyst", { own: OWN }],
  context: ["the_book", "earnings_calendar", "message"],
  tools: ["get_earnings_calendar", "run_screen", "get_market_movers", "get_stock_data", "web_search", "dispatch_thesis_research"],
  output: "Its write-up: each stock it sent to the Writer and why, the best it passed on and why, and what its lists lacked.",
};
