/**
 * The Portfolio Manager's record (docs/plans/AGENT_ENGINE.md): the one agent
 * that looks at the whole account at once. Twice a week, one run per traded
 * book (run by lib/agent/portfolio-manager/run.ts), and once more when the
 * account's market trigger fires (lib/agent/triggers/market.ts). Its
 * instructions: portfolio-manager.md, which imports the rules. Its context:
 * the market and the portfolio, the stock table, and its own last write-up.
 * The schedule writes it no message: the date line is its start. A market
 * trigger writes it one line: the S&P's move and the trigger it fired.
 */
import { MODES } from "@/lib/agent/modes";
import type { RunnableRecord } from "../types";

export const PORTFOLIO_MANAGER: RunnableRecord = {
  id: "portfolio_manager",
  name: "Portfolio Manager",
  does: "Looks across the whole account and may propose up to three trades, each waiting for you.",
  runsWhen: "Also when the account's market trigger fires (Settings → Triggers).",
  messageFrom: "The schedule, which writes it no message: the date line is its start. The account's market trigger, when it fires: one line with the S&P's move today and the trigger.",
  subject: "account",
  // The morning runs' model.
  model: MODES["research-run"].model,
  maxSteps: 40,
  // 30 seconds inside the 800 the function it runs in may take (app/api/inngest/route.ts).
  timeoutMs: 770_000,
  instructions: ["portfolio-manager.md"],
  context: ["market_numbers", "market_digest", "portfolio", "stock_table", "last_output", "message"],
  // get_theses by ticker, a limited number of stocks a run (lib/agent/portfolio-manager/limits.ts); a note goes with its trade, research request or trigger edit.
  tools: ["get_theses", "get_stock_data", "write_note", "edit_triggers", "place_trade", "add", "sell", "dispatch_thesis_research"],
  output: "Its write-up: where the money is, its ranking, what it did, its open questions and what the account needs. Its next run reads it first.",
};
