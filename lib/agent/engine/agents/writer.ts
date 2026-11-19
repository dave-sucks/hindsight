/**
 * The Writer's record (docs/plans/AGENT_ENGINE.md): it researches a new stock
 * or a stock we watch and writes its thesis and its watch triggers
 * (lib/agent/run-thesis-writer.ts runs it). A stock we own is refreshed by
 * its own agent, the Holding refresh (./holding-refresh.ts); the research
 * rules both follow are one shared file (./research-rules.md).
 *
 * Its instructions: the analyst, the house rules, how you write, the
 * playbooks, the research rules and its own text. Its message, the sender's
 * brief (why it was sent, what the sender found, whose idea it was), comes
 * right after the date line; then its context: the market numbers, the stock
 * (on a refresh), the analyst's record by playbook and the stock's data.
 */
import { MODES } from "@/lib/agent/modes";

import type { AgentRecord, FirstMessagePart } from "../types";

/** How many web searches one research call may make (research-rules.md says the same number; a test checks it). */
export const WEB_SEARCH_MAX_USES = 4;

/**
 * The first message, the same for both Writer agents: the sender's brief right
 * after the date line, then the reads. Measured on sndk-writer-watch (10 runs
 * each): the brief before the stock's data kept the view 9 times of 10, as the
 * old message did; the brief last, 3 times.
 */
export const WRITER_CONTEXT: readonly FirstMessagePart[] = ["message", "market_numbers", "the_stock", "playbook_record", "stock_data"];

/** The last line of the sender's brief. */
export const WRITER_GO = "Write the research note now, then call submit_thesis.";

export const WRITER: AgentRecord = {
  id: "writer",
  name: "Writer",
  does: "Researches a new stock or one we watch and writes its thesis: the view, the playbook, the watch triggers at prices from the chart, and the claim every other agent reads.",
  runsWhen: "When a stock is sent to it: from the chat, a run or the Portfolio Manager.",
  messageFrom: "The sender's brief (dispatch_thesis_research, from the chat, a run or the Portfolio Manager): why it was sent, what the sender found, whose idea it was.",
  subject: "thesis",
  model: MODES["thesis-writer"].model,
  maxSteps: MODES["thesis-writer"].maxSteps,
  instructions: ["the_analyst", "house-rules.md", "how-you-write.md", "playbooks", "research-rules.md", "writer.md"],
  context: WRITER_CONTEXT,
  // submit_thesis is the Writer's own tool (makeSubmitThesisTool, lib/agent/run-thesis-writer.ts).
  tools: ["submit_thesis"],
  providerTools: ["web_search"],
  searchesPerCall: WEB_SEARCH_MAX_USES,
  // The run ends once its save goes through.
  endsWith: "submit_thesis",
  output: "A research note (Company, Bull Case, Bear Case), then one submit_thesis call with its view, playbook, watch triggers and the claim; the save writes the thesis.",
};
