/**
 * portfolio-manager-dry-run.ts — the Portfolio Manager on the real book, with nothing saved.
 *
 *   npx tsx --env-file=.env.local scripts/portfolio-manager-dry-run.ts [LIVE|PAPER]
 *
 * Its reads are real. Every write (a note, a trade, a research request) is
 * recorded and printed instead of made, and no run row is created.
 */
import type { ToolSet } from "ai";
import { getOwnerUserId } from "@/lib/auth/account";
import { tradedBooks } from "@/lib/inngest/functions/market-reviewer";
import { runPortfolioManager } from "@/lib/agent/portfolio-manager/run";

const WRITES = ["update_thesis", "place_trade", "manage_position", "close_position", "dispatch_thesis_research"];

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
        WRITES.includes(name)
          ? { ...t, execute: async () => ({ ok: true, ui: "tool-ui", summary: "Dry run: recorded, nothing saved or sent. Carry on as if it went through and now waits for the owner.", data: { items: [] }, sources: [] }) }
          : t,
      ]),
    ) as ToolSet;

  const out = await runPortfolioManager({ ...book, userId }, null, { tools: dry });
  console.log("===== FIRST MESSAGE =====\n" + out.firstMessage);
  console.log("\n===== TOOL CALLS =====");
  for (const c of out.toolCalls) console.log(`- ${c.tool} ${WRITES.includes(c.tool) ? JSON.stringify(c.input, null, 2) : JSON.stringify(c.input)}`);
  console.log("\n===== WRITE-UP =====\n" + (out.writeup ?? `(none) ${out.error ?? ""}`));
  console.log("\n===== TOKENS =====\n" + JSON.stringify(out.usage));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
