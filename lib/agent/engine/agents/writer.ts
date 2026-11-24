/**
 * The Writer's record (docs/plans/AGENT_ENGINE.md): it researches a new stock
 * or a stock we watch and writes its thesis and its watch triggers
 * (lib/agent/run-thesis-writer.ts runs it). A stock we own is refreshed by
 * its own agent, the Holding refresh (./holding-refresh.ts); the research
 * rules both follow are one file each imports (./research-rules.md).
 *
 * Its instructions: writer.md, which imports the rules and the research
 * rules; the analyst (before it) and the analyst's playbooks (after it) are
 * context sent with them. Its message, the sender's
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

/** What the Writer is given after its save: the stock's triggers, one at a time (writerTailorPhase, run-thesis-writer.ts). */
export const WRITER_AFTER_SAVE = ["edit_triggers"] as const;

export const WRITER: AgentRecord = {
  id: "writer",
  name: "Writer",
  does: "Researches a new stock or one we watch and writes its thesis: the view, the playbook (whose watch triggers the save writes at prices from the chart), and the claim every other agent reads; then tailors the triggers.",
  runsWhen: "When a stock is sent to it: from the chat, a run or the Portfolio Manager.",
  messageFrom: "The sender's brief (dispatch_thesis_research, from the chat, a run or the Portfolio Manager): why it was sent, what the sender found, whose idea it was.",
  subject: "thesis",
  model: MODES["thesis-writer"].model,
  maxSteps: MODES["thesis-writer"].maxSteps,
  // The analyst's playbooks follow its document, as the trigger run's playbook does (moved there when the rules became its import; scored in PR 2).
  instructions: ["the_analyst", "writer.md", "playbooks"],
  context: WRITER_CONTEXT,
  // submit_thesis is the Writer's own tool (makeSubmitThesisTool, lib/agent/run-thesis-writer.ts).
  // get_sec_filings reads the release and the 10-Q itself (`read`), so the thesis starts from the company's own numbers.
  tools: ["submit_thesis", "get_sec_filings"],
  providerTools: ["web_search"],
  searchesPerCall: WEB_SEARCH_MAX_USES,
  // The run ends once its save goes through; then it tailors the stock's triggers.
  endsWith: "submit_thesis",
  afterSave: WRITER_AFTER_SAVE,
  output: "Research (the latest earnings release and filings first), then one submit_thesis call with every field: the company, the belief, the opinion, the KPIs, the bull and bear cases and the playbook; the save writes the thesis and the playbook's watch triggers, and edit_triggers tailors them.",
};
