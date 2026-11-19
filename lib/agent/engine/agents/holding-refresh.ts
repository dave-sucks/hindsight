/**
 * The Holding refresh's record (docs/plans/AGENT_ENGINE.md): it re-researches
 * a stock we own and rewrites its thesis, keeping the holding's sale, trim
 * and add triggers current (lib/agent/run-thesis-writer.ts runs it on a
 * HOLDING thesis). A new stock or a watch goes to the Writer (./writer.ts);
 * the research rules both follow are one file each imports
 * (./research-rules.md).
 *
 * Its instructions: holding-refresh.md, which imports the rules and the
 * research rules; the analyst is sent before it. Its context
 * and its message are the Writer's.
 */
import { MODES } from "@/lib/agent/modes";
import { WEB_SEARCH_MAX_USES } from "./writer";
import { WRITER_CONTEXT } from "./writer";
import type { AgentRecord } from "../types";

export const HOLDING_REFRESH: AgentRecord = {
  id: "holding_refresh",
  name: "Holding refresh",
  does: "Re-researches a stock we own and rewrites its thesis: the belief, what would prove it wrong, and its sale, trim and add triggers, edited by id.",
  runsWhen: "When a stock we own is sent for a refresh: from the chat, a run or the Portfolio Manager.",
  messageFrom: "The sender's brief (dispatch_thesis_research, from the chat, a run or the Portfolio Manager): why it was sent, what the sender found, whose idea it was.",
  subject: "thesis",
  model: MODES["thesis-writer"].model,
  maxSteps: MODES["thesis-writer"].maxSteps,
  instructions: ["the_analyst", "holding-refresh.md"],
  context: WRITER_CONTEXT,
  tools: ["submit_thesis"],
  providerTools: ["web_search"],
  searchesPerCall: WEB_SEARCH_MAX_USES,
  // The run ends once its save goes through.
  endsWith: "submit_thesis",
  output: "A research note (Company, Bull Case, Bear Case), then one submit_thesis call with its view, the claim and any trigger edits; the save writes the thesis.",
};
