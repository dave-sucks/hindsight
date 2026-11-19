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
  instructions: ["the_analyst", "post-trade-writeup.md", "house-rules.md", "how-you-write.md"],
  context: ["market_numbers", "market_digest", "portfolio", "portfolio_digest", "the_stock", "message"],
  tools: (MODES["tactical"].toolAllowlist ?? []).filter((name) => !NOT_ITS_TOOLS.has(name)),
  output: "One update_thesis note on the stock, which becomes the reason on the trade, then complete_run.",
};
