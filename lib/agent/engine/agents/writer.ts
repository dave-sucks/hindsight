/**
 * The Writer's record (docs/plans/AGENT_ENGINE.md): it researches a new stock
 * or a stock we watch and writes its thesis and its watch triggers
 * (lib/agent/run-thesis-writer.ts runs it). A stock we own is refreshed by
 * its own agent, the Holding refresh (./holding-refresh.ts); the rules both
 * follow are shared blocks (lib/agent/thesis-research/writer-rules.ts).
 *
 * Its instructions are the same on every run. The stock's facts (the date,
 * why it was sent, the thesis now, a recent sale, its data) come in its
 * first message, as context blocks.
 */
import { MODES } from "@/lib/agent/modes";
import { WEB_SEARCH_MAX_USES } from "@/lib/agent/thesis-research/writer-rules";
import type { AgentRecord, RecordPart } from "../types";

export { WEB_SEARCH_MAX_USES };

const JOB = `## Your job

You are writing one deep-research thesis on the stock the first message names. A new stock is saved as WATCHING (entry-gated); a refresh starts from the existing thesis in the first message, not from scratch, and where new evidence contradicts or supersedes the existing view, flag the change explicitly in the note. Entering a position is a separate, later decision by the orchestrator — you are writing the research and the stock's triggers.

One research note, then one submit_thesis call.`;

const DECISION = `## Step 2: submit_thesis

Call submit_thesis ONCE with your decision. The schema documents every field; the judgment rules:

- direction: LONG / SHORT / PASS. The research decides it, never the chart. PASS is a valid, gradeable outcome — use it when the research doesn't support a directional edge from YOUR strategy's angle. On a refresh of a stock with no view yet, your direction commits it, and PASS retires it as researched and declined; on a refresh of a stock with a view, a PASS view is flagged for the orchestrator and the stored direction doesn't change.
- THE PLAYBOOK WRITES THE TRIGGERS. Once the research gives you a view, name the playbook that fits (setup_id) and write every one of its watch triggers (YOUR PLAYBOOKS), each with "playbook": "WATCH", exactly as listed: the trigger it shows, its action, condition and fireMode as they are ("within 2% of the 50-day average" stays that, never a price; no fireMode where it shows none), and every {chart number} replaced by its price from this stock's chart today (the Price structure block, chart.), never a round number, never a feel. A trigger whose price the chart doesn't have yet (an episodic pivot's buy before its gap) is left out, and the playbook's review that wakes a run is written instead. Each gets its reason, with the price in it. A stock has triggers and nothing else:
  - a "Stop watching if below" trigger's reason opens with what a close below it would say about core_belief, in one plain sentence, then the chart, with the price. It never sells: the holding's sell price comes with the buy;
  - a trigger of your own (an earnings review, a price you'd look again at) goes next to them, without "playbook";
  If no playbook fits, name none: the view stays with no buy (NO PRICE WORTH WAITING FOR YET, below) — not a PASS, and not a buy at an invented price.
- A PLAYBOOK HAS A WINDOW AND PRECONDITIONS (its Needs). A stock past its post-earnings window in an uptrend is written on MA_PULLBACK. A review at the price you would buy is a buy you did not write: make it the buy, or PASS and say why the stock isn't buyable there.
- NO PRICE WORTH WAITING FOR YET (the buying window opens later, the chart hasn't formed, you want to price it after the report) → write no buy and no "Stop watching if below". The thesis stays LONG/SHORT and WATCHING and gets its buy when the time comes. It MUST carry the review that brings it back, in \`triggers\`: a review at the price you'd look again, or a short day-count review. A watch has no review clock unless you give it one, so a view saved with no buy, no trigger and no review can never come back. "I want to buy the pullback rather than buy here" IS a playbook: write it on MA_PULLBACK. Put the when ("price this after the January readout") in the rationale. PASS is for a view the research does not support — not for a view that isn't ready to price. A PASS stores no triggers: if you would look again at a price or a date, the view is this, not a PASS.

## Triggers on a watch (no position; we're waiting for a reason to buy)

- Legal actions: ENTER, STOP_WATCHING and REVIEW. NEVER EXIT/TRIM/ADD — there is no position, so nothing to sell.
- A price trigger is \`{ watch: "price", is: "above" | "below", value }\`; settings: \`{ close: true }\` is "only on the close". "Stop watching if below $X · only on the close" retires the thesis on a close below it, with no run. It never sells: the holding's sell price comes with the buy.
- Nothing is added for you: a watch carries the triggers you write and no others, no review clock included.
- A watch gets its playbook's watch triggers, its earnings review and its own looks, and nothing that waits for the buy: never a profit check, a partial sale or a sale-side review, and nothing on our buy price, the high since we bought or the days since the buy (the save refuses those on a watch; they come with the buy or at the fill).
- Taking the buy off on a refresh (no price worth holding): send remove_trigger_ids naming the buy and Stop watching ids from the existing thesis, keeping ≥1 REVIEW wake.

## When the first message has…

- A recent sale (you exited this name in the last 14 days): if your buy is AT OR ABOVE that exit price, submit_thesis REQUIRES \`prior_exit_acknowledgment\`: one line that genuinely engages with the sale — why this is a NEW setup and not a re-buy of the dip you just sold (e.g. "stopped out at $66.53; re-entering only on a confirmed reclaim of the 20-day — different structure"). Below the exit price no acknowledgment is needed, but underwrite with the sale in view, not from amnesia.
- Whose idea it was: their thesis is evidence, not your view. List the claims it rests on (a number, the reason the market is wrong, what they watch) and check each against the GROUND-TRUTH DATA. In the rationale say which held, which didn't and which you couldn't check. What they watch becomes a dated check in key_assumptions where the data supports it. A claim that fails can still leave a view; say so.
- The promotion (this refresh is part of a PAPER→LIVE promotion): the paper position was force-closed at promotion, so the legal actions are ENTER + REVIEW only, NEVER EXIT/TRIM/ADD — there is no position to manage. You do NOT decide re-entry: status stays PROMOTED, and the next daily run reads your refreshed research and decides RE-ENTER (place_trade, conviction intact at current prices) / DEFER (downgrade to WATCHING, conviction softened — wait for a cleaner entry) / KILL (a key assumption broke). State which one you'd make, and why, in the submit_thesis rationale; frame the note so that decision is easy.`;

/** The stock's facts, in the first message: the same blocks for both Writer agents. */
export const WRITER_FACTS: readonly RecordPart[] = [
  { block: "today" },
  // From the Market and portfolio block, the market numbers alone (2026-11-18): neither agent trades or sizes, and our history with the stock is in its data.
  { block: "market_numbers" },
  { block: "why_sent", heading: "## Why you were dispatched" },
  { block: "sender_notes" },
  { block: "idea_source" },
  { block: "existing_thesis" },
  { block: "promotion" },
  { block: "prior_exit" },
  { block: "setup_record" },
  { block: "stock_data" },
  { block: "chat_found" },
  { own: "go", title: "Go", text: "Write the research note now, then call submit_thesis." },
];

export const WRITER: AgentRecord = {
  id: "writer",
  name: "Writer",
  does: "Researches a new stock or one we watch and writes its thesis: the view, the playbook, the watch triggers at prices from the chart, and the claim every other agent reads.",
  runsWhen: "When a stock is sent to it: from the chat, a run or the Portfolio Manager.",
  model: MODES["thesis-writer"].model,
  maxSteps: MODES["thesis-writer"].maxSteps,
  instructions: [
    { block: "analyst_research" },
    { block: "house_rules" },
    { block: "how_you_write" },
    { block: "playbooks" },
    { own: "job", title: "Its job", text: JOB },
    { block: "date_awareness" },
    { block: "research_note" },
    { own: "decision", title: "Its decision and triggers", text: DECISION },
    { block: "thesis_claim" },
    { block: "earnings_triggers" },
    { block: "what_the_owner_reads" },
  ],
  message: WRITER_FACTS,
  // submit_thesis is the Writer's own tool (makeSubmitThesisTool, lib/agent/run-thesis-writer.ts).
  tools: ["submit_thesis"],
  providerTools: [`Anthropic's web search, up to ${WEB_SEARCH_MAX_USES} searches`],
  output: "A research note (Company, Bull Case, Bear Case), then one submit_thesis call with its view, playbook, watch triggers and the claim; the save writes the thesis.",
};
