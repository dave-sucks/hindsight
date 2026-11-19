/**
 * add — buy more of a stock we hold. Code sizes it by the analyst's rules
 * (half a new buy's risk, capped by the most in one stock); only your chat
 * names a dollar amount. The work is `changePosition` (manage-position.ts):
 * the exclusion list, a paused analyst, the approval switch.
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { changePosition } from "@/lib/agent/tools/manage-position";

const schema = z.object({
  ticker: z.string().describe("The stock to add to."),
  // Read by changePosition as the add's size; a run's add is sized by the analyst's rules (DAV-317).
  notional: z.number().positive().optional().describe("The dollar amount to add; left out, the analyst's rules size it."),
  // Read by changePosition as the add's reason (Order.rationale).
  note: z.string().optional().describe("Why you're adding, by How you write: what happened to the company and the stock, then the add; the owner reads it on the proposal and in the approval email."),
});

export const add = defineTool({
  description: "Buys more of a stock we hold, sized by the analyst's rules; with the approval switch on, the add waits for the owner.",
  schema,
  // A run never sizes a trade nor writes its reason here: its note on the stock is the reason (lib/proposals/auto-writeup.ts).
  schemaFor: (ctx) => (ctx.runMode === "PRINCIPAL_CHAT" ? schema : ctx.runStock ? schema.pick({}) : schema.pick({ ticker: true })),
  // A one-stock run adds to its own stock.
  fromRun: (ctx) => (ctx.runStock ? { ticker: ctx.runStock.ticker } : null),
  ui: "tool-ui" as const,
  gateLog: "add",
  groupId: "Executing",
  progressLabel: (args) => `Adding to ${args.ticker.toUpperCase()}`,
  execute: (args, ctx) =>
    changePosition({ symbol: args.ticker, action: "add_to_position", add_notional: args.notional, reason: args.note }, ctx),
});
