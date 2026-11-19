/**
 * After the buy's record (docs/plans/AGENT_ENGINE.md): a buy or an add
 * filled, and this agent puts the holding's triggers on the stock, the
 * playbook's by reference, tailored to the thesis, and writes the trade's
 * note when nobody has (lib/proposals/after-buy.ts; lib/inngest/functions/after-buy-run.ts
 * runs it). It cannot trade.
 *
 * Its instructions: after-buy.md, the same on every run (it imports the
 * rules); the analyst is sent before it. Its context: the stock, its data
 * and chart, its playbook's holding triggers, the market numbers. Its message
 * is the trade, from the fill.
 */
import { MODES } from "@/lib/agent/modes";
import type { RunnableRecord } from "../types";

/** The ask that ends its message. */
export const AFTER_BUY_ASK =
  "Put the holding's triggers on with edit_triggers. If no one has written this trade's note, write it with write_note. Then end with one line on what you put on and why. You can't trade on this run. You are running unattended — no human will respond.";

export const AFTER_BUY: RunnableRecord = {
  id: "after_buy",
  name: "After the buy",
  does: "Puts a new holding's triggers on right after a buy or an add fills: the playbook's holding triggers by reference, each fitted to the thesis with its reason, and the trade's note when nobody wrote one.",
  runsWhen: "Right after every buy or add fills: an approved proposal, a buy with approvals off, an Auto buy or add, and a buy from the Trade ticket.",
  messageFrom: "The fill (lib/proposals/after-buy.ts): what filled and at what price, the floor, the trigger that led to it and the trade's note, then the ask.",
  subject: "thesis",
  model: MODES["tactical"].model,
  maxSteps: MODES["tactical"].maxSteps,
  timeoutMs: (MODES["tactical"].maxDuration - 30) * 1000,
  instructions: ["the_analyst", "after-buy.md"],
  context: ["the_stock", "stock_data", "holding_triggers", "market_numbers", "message"],
  // write_note is given only when the trade has no note (after-buy-run.ts).
  tools: ["get_stock_data", "get_earnings_data", "get_sec_filings", "get_catalyst_calendar", "web_search", "get_theses", "edit_triggers", "write_note"],
  output: "The holding's triggers, through edit_triggers; the trade's note when it had none; then one closing line.",
};
