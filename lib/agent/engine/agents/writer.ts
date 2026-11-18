/**
 * The Writer's record (docs/plans/AGENT_ENGINE.md): it researches a new stock
 * or a stock we watch, writes its thesis and names its playbook; the save
 * writes the playbook's watch triggers (lib/agent/thesis-research/writer-triggers.ts;
 * lib/agent/run-thesis-writer.ts runs it). A stock we own is refreshed by
 * its own agent, the Holding refresh (./holding-refresh.ts); the research
 * rules both follow are one shared text (lib/agent/thesis-research/writer-rules.ts).
 *
 * Its instructions: the analyst, the house rules, how you write, the
 * playbooks, the research rules and its own text. Its message, the sender's
 * brief (why it was sent, what the sender found, whose idea it was), comes
 * right after the date line; then its context: the market numbers, the stock
 * (on a refresh), the analyst's record by playbook and the stock's data.
 */
import { MODES } from "@/lib/agent/modes";
import { WEB_SEARCH_MAX_USES } from "@/lib/agent/thesis-research/writer-rules";
import type { AgentRecord, FirstMessagePart } from "../types";

export { WEB_SEARCH_MAX_USES };

const JOB = `## Your job

You are writing one deep-research thesis on the stock the first message names. A new stock is saved as WATCHING (entry-gated); a refresh starts from the existing thesis (the stock's row in the first message), not from scratch, and where new evidence contradicts or supersedes the existing view, flag the change explicitly in the note. Entering a position is a separate, later decision by the orchestrator — you are writing the research.

One research note, then one submit_thesis call.`;

const DECISION = `## Step 2: submit_thesis

Call submit_thesis ONCE with your decision. The schema documents every field; the judgment rules:

- direction: LONG / SHORT / PASS. The research decides it, never the chart. PASS is a valid, gradeable outcome — use it when the research doesn't support a directional edge from YOUR strategy's angle. On a refresh of a stock with no view yet, your direction commits it, and PASS retires it as researched and declined; on a refresh of a stock with a view, a PASS view is flagged for the orchestrator and the stored direction doesn't change.
- THE PLAYBOOK WRITES THE TRIGGERS. Once the research gives you a view, name the playbook that fits (setup_id). If no playbook fits, name none: the view stays with no buy (NO PRICE WORTH WAITING FOR YET, below) — not a PASS, and not a buy at an invented price.
- A PLAYBOOK HAS A WINDOW AND PRECONDITIONS (its Needs). A stock past its post-earnings window in an uptrend is written on MA_PULLBACK. A look_again_price at the price you would buy is a buy you did not name: name its playbook, or PASS and say why the stock isn't buyable there.
- NO PRICE WORTH WAITING FOR YET (the buying window opens later, the chart hasn't formed, you want to price it after the report) → name no playbook. The thesis stays LONG/SHORT and WATCHING and gets its buy when the time comes. It MUST carry the review that brings it back: the price you'd look again (look_again_price) or a day (look_again_date), with look_again_why. A watch has no review clock unless you give it one, so a view saved with no playbook and no review can never come back. "I want to buy the pullback rather than buy here" IS a playbook: name MA_PULLBACK. Put the when ("price this after the January readout") in the rationale. PASS is for a view the research does not support — not for a view that isn't ready to price. A PASS stores no review: if you would look again at a price or a date, the view is this, not a PASS.

## When the first message has…

- A recent sale (you exited this name in the last 14 days): if your buy is AT OR ABOVE that exit price, submit_thesis REQUIRES \`prior_exit_acknowledgment\`: one line that genuinely engages with the sale — why this is a NEW setup and not a re-buy of the dip you just sold (e.g. "stopped out at $66.53; re-entering only on a confirmed reclaim of the 20-day — different structure"). Below the exit price no acknowledgment is needed, but underwrite with the sale in view, not from amnesia.
- Whose idea it was: their thesis is evidence, not your view. List the claims it rests on (a number, the reason the market is wrong, what they watch) and check each against the GROUND-TRUTH DATA. In the rationale say which held, which didn't and which you couldn't check. What they watch becomes a dated check in key_assumptions where the data supports it. A claim that fails can still leave a view; say so.
- A promotion (the row's paper_record: this refresh is part of a PAPER→LIVE promotion): the paper position was force-closed at promotion. You do NOT decide re-entry: status stays PROMOTED, and the next daily run reads your refreshed research and decides RE-ENTER (place_trade, conviction intact at current prices) / DEFER (downgrade to WATCHING, conviction softened — wait for a cleaner entry) / KILL (a key assumption broke). State which one you'd make, and why, in the submit_thesis rationale; frame the note so that decision is easy.`;

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
  does: "Researches a new stock or one we watch and writes its thesis: the view, the playbook and the claim every other agent reads. The save writes the playbook's watch triggers at prices from the chart.",
  runsWhen: "When a stock is sent to it: from the chat, a run or the Portfolio Manager.",
  messageFrom: "The sender's brief (dispatch_thesis_research, from the chat, a run or the Portfolio Manager): why it was sent, what the sender found, whose idea it was.",
  model: MODES["thesis-writer"].model,
  maxSteps: MODES["thesis-writer"].maxSteps,
  instructions: ["the_analyst", "house_rules", "how_you_write", "playbooks", "research_rules", { own: `${JOB}\n\n${DECISION}` }],
  context: WRITER_CONTEXT,
  // submit_thesis is the Writer's own tool (makeSubmitThesisTool, lib/agent/run-thesis-writer.ts).
  tools: ["submit_thesis"],
  providerTools: [`Anthropic's web search, up to ${WEB_SEARCH_MAX_USES} searches`],
  output: "A research note (Company, Bull Case, Bear Case), then one submit_thesis call with its view, playbook and the claim; the save writes the thesis and the playbook's watch triggers.",
};
