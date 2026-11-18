/**
 * The Holding refresh's record (docs/plans/AGENT_ENGINE.md): it re-researches
 * a stock we own and rewrites its thesis, keeping the holding's sale, trim
 * and add triggers current (lib/agent/run-thesis-writer.ts runs it on a
 * HOLDING thesis). A new stock or a watch goes to the Writer (./writer.ts);
 * the rules both follow are shared blocks
 * (lib/agent/thesis-research/writer-rules.ts).
 *
 * Its instructions are the same on every run. The stock's facts come in its
 * first message, the same blocks as the Writer's.
 */
import { MODES } from "@/lib/agent/modes";
import { WEB_SEARCH_MAX_USES } from "@/lib/agent/thesis-research/writer-rules";
import { WRITER_FACTS } from "./writer";
import type { AgentRecord } from "../types";

const JOB = `## Your job

You are refreshing the thesis on a stock we own (an open position): one deep-research note on the stock the first message names, then one submit_thesis call. The refresh starts from the existing thesis in the first message, not from scratch: where new evidence contradicts or supersedes the existing view, flag the change explicitly in the note.`;

const DECISION = `## Step 2: submit_thesis

Call submit_thesis ONCE with your decision. The schema documents every field; the judgment rules:

- direction: LONG / SHORT / PASS. The research decides it, never the chart. PASS is a valid, gradeable outcome — use it when the research doesn't support a directional edge from YOUR strategy's angle (on a refresh, a PASS view is flagged for the orchestrator; the stored direction doesn't change).
- WE OWN THIS STOCK. A playbook's watch triggers are a watch's: write none of them, and name no new playbook (setup_id). The holding's triggers came with the buy and at the fill; edit them by id only where the research changed one.

## Triggers on a stock we hold

- Legal actions: EXIT, REVIEW, TRIM, ADD. NEVER ENTER — we already own it.
- It carries its "Sell if below" trigger already. Most refreshes need no trigger ops at all.
- A SALE'S PRICE ONLY TIGHTENS on a stock we own. Move the "Sell if below" trigger (edit_triggers, by its id in the existing thesis) up, never down. A looser one is refused by itself — the rest of the refresh still lands. If you believe its price is wrong, keep it and say so in the rationale with the price you'd suggest — that reaches the principal; you cannot move it.`;

export const HOLDING_REFRESH: AgentRecord = {
  id: "holding_refresh",
  name: "Holding refresh",
  does: "Re-researches a stock we own and rewrites its thesis: the belief, what would prove it wrong, and its sale, trim and add triggers, edited by id.",
  runsWhen: "When a stock we own is sent for a refresh: from the chat, a run or the Portfolio Manager.",
  model: MODES["thesis-writer"].model,
  maxSteps: MODES["thesis-writer"].maxSteps,
  instructions: [
    { block: "analyst_brief" },
    { block: "house_rules" },
    { block: "market_block_rule" },
    { block: "how_you_write" },
    { own: "job", title: "Its job", text: JOB },
    { block: "date_awareness" },
    { block: "research_note" },
    { own: "decision", title: "Its decision and triggers", text: DECISION },
    { block: "thesis_claim" },
    { block: "earnings_triggers" },
    { block: "what_the_owner_reads" },
  ],
  message: WRITER_FACTS,
  tools: ["submit_thesis"],
  providerTools: [`Anthropic's web search, up to ${WEB_SEARCH_MAX_USES} searches`],
  output: "A research note (Company, Bull Case, Bear Case), then one submit_thesis call with its view, the claim and any trigger edits; the save writes the thesis.",
};
