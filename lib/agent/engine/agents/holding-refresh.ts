/**
 * The Holding refresh's record (docs/plans/AGENT_ENGINE.md): it re-researches
 * a stock we own and rewrites its thesis, keeping the holding's sale, trim
 * and add triggers current (lib/agent/run-thesis-writer.ts runs it on a
 * HOLDING thesis). A new stock or a watch goes to the Writer (./writer.ts);
 * the research rules both follow are one shared text
 * (lib/agent/thesis-research/writer-rules.ts).
 *
 * Its instructions: the analyst, the house rules, how you write, the research
 * rules and its own text. Its context and its message are the Writer's.
 */
import { MODES } from "@/lib/agent/modes";
import { WEB_SEARCH_MAX_USES } from "@/lib/agent/thesis-research/writer-rules";
import { WRITER_CONTEXT } from "./writer";
import type { AgentRecord } from "../types";

const JOB = `## Your job

You are refreshing the thesis on a stock we own (an open position): one deep-research note on the stock the first message names, then one submit_thesis call. The refresh starts from the existing thesis (the stock's row in the first message), not from scratch: where new evidence contradicts or supersedes the existing view, flag the change explicitly in the note.`;

const DECISION = `## Step 2: submit_thesis

Call submit_thesis ONCE with your decision. The schema documents every field; the judgment rules:

- direction: LONG / SHORT / PASS. The research decides it, never the chart. PASS is a valid, gradeable outcome — use it when the research doesn't support a directional edge from YOUR strategy's angle (on a refresh, a PASS view is flagged for the orchestrator; the stored direction doesn't change).
- WE OWN THIS STOCK. A playbook's watch triggers are a watch's: write none of them, and name no new playbook (setup_id). The holding's triggers came with the buy and at the fill; edit them by id only where the research changed one.

## Triggers on a stock we hold

- Legal actions: EXIT, REVIEW, TRIM, ADD. NEVER ENTER — we already own it.
- It carries its "Sell if below" trigger already. Most refreshes need no trigger ops at all.
- A SALE'S PRICE ONLY TIGHTENS on a stock we own. Move the "Sell if below" trigger (edit_triggers, by its id on the stock's row) up, never down. A looser one is refused by itself — the rest of the refresh still lands. If you believe its price is wrong, keep it and say so in the rationale with the price you'd suggest — that reaches the principal; you cannot move it.`;

export const HOLDING_REFRESH: AgentRecord = {
  id: "holding_refresh",
  name: "Holding refresh",
  does: "Re-researches a stock we own and rewrites its thesis: the belief, what would prove it wrong, and its sale, trim and add triggers, edited by id.",
  runsWhen: "When a stock we own is sent for a refresh: from the chat, a run or the Portfolio Manager.",
  messageFrom: "The sender's brief (dispatch_thesis_research, from the chat, a run or the Portfolio Manager): why it was sent, what the sender found, whose idea it was.",
  model: MODES["thesis-writer"].model,
  maxSteps: MODES["thesis-writer"].maxSteps,
  instructions: ["the_analyst", "house_rules", "how_you_write", "research_rules", { own: `${JOB}\n\n${DECISION}` }],
  context: WRITER_CONTEXT,
  tools: ["submit_thesis"],
  providerTools: ["web_search"],
  searchesPerCall: WEB_SEARCH_MAX_USES,
  // The run ends once its save goes through.
  endsWith: "submit_thesis",
  output: "A research note (Company, Bull Case, Bear Case), then one submit_thesis call with its view, the claim and any trigger edits; the save writes the thesis.",
};
