/**
 * portfolio-manager-dry-run.ts — the Portfolio Manager on the real book, with nothing saved.
 *
 *   npx tsx --env-file=.env.local scripts/portfolio-manager-dry-run.ts [LIVE|PAPER] [--inputs-only]
 *
 * Its reads are real. Every other tool (a note, a trade, a trigger edit, a
 * research request) is recorded and printed instead of made, and no run row
 * is created. `--inputs-only` prints its first message and calls no model.
 */
import type { ToolSet } from "ai";
import { getOwnerUserId } from "@/lib/auth/account";
import { tradedBooks } from "@/lib/inngest/functions/market-reviewer";
import { managerArgs, runPortfolioManager } from "@/lib/agent/portfolio-manager/run";
import { buildAgentRequest } from "@/lib/agent/engine/build";
import { PORTFOLIO_MANAGER } from "@/lib/agent/engine/agents/portfolio-manager";

/** The tools that only read. Every other tool the run has is stood in for, so a tool added to its record later is never run for real here. */
const READS = ["get_theses", "get_stock_data"];
const isWrite = (name: string) => !READS.includes(name);

async function main() {
  const want = process.argv[2] === "PAPER" ? "PAPER" : "LIVE";
  const book = (await tradedBooks()).find((b) => b.environment === want);
  if (!book) throw new Error(`No ${want} book is traded.`);
  const userId = await getOwnerUserId(book.accountId);
  if (!userId) throw new Error("The account has no owner.");

  const dry = (real: ToolSet): ToolSet =>
    Object.fromEntries(
      Object.entries(real).map(([name, t]) => [
        name,
        isWrite(name)
          ? { ...t, execute: async () => ({ ok: true, ui: "tool-ui", summary: "Dry run: recorded, nothing saved or sent. Carry on as if it went through and now waits for the owner.", data: { items: [] }, sources: [] }) }
          : t,
      ]),
    ) as ToolSet;

  if (process.argv.includes("--inputs-only")) {
    const args = await managerArgs({ ...book, userId }, null);
    const request = await buildAgentRequest(PORTFOLIO_MANAGER, args.input, { subject: args.subject, now: args.input.now, agent: PORTFOLIO_MANAGER.id, toolset: args.toolset });
    console.log("===== INSTRUCTIONS =====\n" + request.instructions);
    console.log("\n===== FIRST MESSAGE =====\n" + request.message);
    console.log(`\nInstructions ${request.instructions.length.toLocaleString()} characters, first message ${request.message.length.toLocaleString()} characters. No model was called.`);
    return;
  }

  const out = await runPortfolioManager({ ...book, userId }, null, { tools: dry });
  console.log("===== FIRST MESSAGE =====\n" + out.firstMessage);
  console.log("\n===== TOOL CALLS =====");
  for (const c of out.toolCalls) console.log(`- ${c.tool} ${isWrite(c.tool) ? JSON.stringify(c.input, null, 2) : JSON.stringify(c.input)}`);
  console.log("\n===== WRITE-UP =====\n" + (out.writeup ?? `(none) ${out.error ?? ""}`));
  console.log("\n===== TOKENS =====\n" + JSON.stringify(out.usage));
  console.log(`Each request's input: ${out.requests.join(", ")} (largest ${Math.max(0, ...out.requests)})`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
