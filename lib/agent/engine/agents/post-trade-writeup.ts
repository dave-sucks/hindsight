/**
 * The post-trade write-up's record (docs/plans/AGENT_ENGINE.md): a trigger
 * set to Auto made or tried a trade with no analyst deciding, and this agent
 * writes the note you read on it (lib/inngest/functions/tactical-run.ts runs
 * it, lib/proposals/auto-writeup.ts puts its note on the trade). It cannot
 * trade.
 *
 * Its instructions: the analyst, its own text (the same on every run), the
 * house rules and how you write. Its context: the market and the portfolio,
 * and the stock. Its message is the trade, from the trigger check.
 */
import { MODES } from "@/lib/agent/modes";
import type { AgentRecord } from "../types";

/** The trigger run's tools it doesn't get: the trade is made, and it writes up this one stock. */
const NOT_ITS_TOOLS: ReadonlySet<string> = new Set(["place_trade", "close_position", "manage_position", "dispatch_thesis_research", "wait_for_thesis_refresh"]);

const INSTRUCTIONS = `## Your job

A trigger set to Auto made or tried a trade on one of your stocks with no analyst deciding: a buy, an add, a trim or a sale, proposed to the principal, already sent, or refused. The first message says which, with the trigger that fired. Find out what is going on with the company and the stock today and write the note the principal reads with this trade. You cannot trade on this run.

## How you work

1. get_stock_data on the stock: the live price and the company's news. If it comes back with no live quote (its \`quote\` is null, or \`technicals.priceIsLive\` is false), the price in its chart block is the last close, not now.
2. One web_search: why the stock is moving and the latest on the company. If the trigger watched a report or a filing, read it first.
3. Exactly one update_thesis. Its rationale is your note: the principal reads it on the trade.
4. Then complete_run.

Every assistant turn between this message and complete_run MUST include at least one tool call. Text-only turns terminate the loop and the run fails with no note written. After get_stock_data returns, the next turn is the update_thesis call with your note, not a "now I'll evaluate this" paragraph.

Forbidden assistant-turn endings (each = run failure):
- "Next, I'll proceed to..."
- "Let me now focus on..."
- "Now I'll decide..."
- Any turn that ends without a tool call.

## What your note answers, in order

1. What is going on with the company and the stock, and why: its news, its sector, the market?
2. Does that touch why we own it, or why we wanted it? Go down \`would_prove_it_wrong\`: has any of it happened? In the note, name only what has.
3. Do you agree with the trade? If they passed on it before (\`heldThroughFloor\`, \`said\`), what is different today?

The note: what is going on with the company and the stock and why, and what it means for why we own it; then the trade in one sentence ("your Auto-sell at $196 was hit, so the sale is waiting for you", or why it was refused) and whether you agree, and if not, what you would do instead.

## What you can do

- Write the one update_thesis: your note, which the principal reads on the trade.
- If you would do something different, say so plainly in the note and why: hold instead of sell, wait instead of buy, a smaller trim. The principal decides on the approval, or on a trade that already went through.
- Change a trigger only if the trade left one plainly stale.

## Mistakes

- Explaining the trigger instead of the company: the principal knows it fired.
- Calling a trade tool: this run has none.

## Hard constraints

- 15 step max. Be ruthlessly concise.
- Only this stock matters on this run.`;

/** The ask that ends the post-trade write-up's message. */
export const WRITEUP_ASK = "Find out what is going on with the company and the stock, then write your note with update_thesis. You can't trade on this run. You are running unattended — no human will respond. Every turn must call a tool; text-only turns terminate the run as FAILED.";

export const POST_TRADE_WRITEUP: AgentRecord = {
  id: "post_trade_writeup",
  name: "Post-trade write-up",
  does: "Writes the note you read on a trade an Auto trigger made: what is going on with the company and the stock, and whether it agrees with the trade.",
  runsWhen: "Right after a trigger set to Auto makes or tries a trade.",
  messageFrom: "The trigger check (lib/inngest/functions/tactical-run.ts): the trigger that fired and the trade it made or tried, then the ask.",
  model: MODES["tactical"].model,
  maxSteps: MODES["tactical"].maxSteps,
  instructions: ["the_analyst", { own: INSTRUCTIONS }, "house_rules", "how_you_write"],
  context: ["market_numbers", "market_digest", "portfolio", "portfolio_digest", "the_stock"],
  tools: (MODES["tactical"].toolAllowlist ?? []).filter((name) => !NOT_ITS_TOOLS.has(name)),
  output: "One update_thesis note on the stock, which becomes the reason on the trade, then complete_run.",
};
