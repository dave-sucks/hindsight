/**
 * portfolio-digest-dry-run.ts — the evening summary on the real book, with nothing saved.
 *
 *   npx tsx --env-file=.env.local scripts/portfolio-digest-dry-run.ts [LIVE|PAPER] [--inputs-only]
 *
 * It reads the portfolio snapshot and the Portfolio Manager's write-up as the
 * 8 PM job would, and its web searches are real. No run row is created and
 * the summary is printed, never saved: the home page keeps the one it has.
 * `--inputs-only` prints its instructions, first message and tools, and calls no model.
 */
import { getOwnerUserId } from "@/lib/auth/account";
import { tradedBooks } from "@/lib/inngest/functions/market-reviewer";
import { loadPortfolioSnapshot } from "@/lib/portfolio/load-snapshot";
import { digestArgs, writeDigestNarrative } from "@/lib/agent/digest-writer";
import { buildAgentRequest } from "@/lib/agent/engine/build";
import { PORTFOLIO_DIGEST } from "@/lib/agent/engine/agents/portfolio-digest";

async function main() {
  const want = process.argv[2] === "PAPER" ? "PAPER" : "LIVE";
  const book = (await tradedBooks()).find((b) => b.environment === want);
  if (!book) throw new Error(`No ${want} book is traded.`);
  const userId = await getOwnerUserId(book.accountId);
  if (!userId) throw new Error("The account has no owner.");
  const snapshot = await loadPortfolioSnapshot({ accountId: book.accountId, environment: want });
  if (!snapshot) throw new Error("The snapshot couldn't be read.");
  const target = { userId, accountId: book.accountId, environment: want } as const;

  if (process.argv.includes("--inputs-only")) {
    const args = digestArgs(snapshot, target);
    const request = await buildAgentRequest(PORTFOLIO_DIGEST, args.input, { subject: args.subject, now: args.input.now, agent: PORTFOLIO_DIGEST.id, toolset: args.toolset, given: args.given });
    console.log("===== INSTRUCTIONS =====\n" + request.instructions);
    console.log("\n===== FIRST MESSAGE =====\n" + request.message);
    console.log("\n===== TOOLS =====\n" + request.tools.map((name) => `- ${name}`).join("\n"));
    console.log(`\nInstructions ${request.instructions.length.toLocaleString()} characters, first message ${request.message.length.toLocaleString()} characters. No model was called.`);
    return;
  }

  const out = await writeDigestNarrative(snapshot, null, target);
  console.log("===== FIRST MESSAGE =====\n" + out.run.request.message);
  console.log("\n===== TOOL CALLS =====");
  for (const c of out.run.toolCalls) console.log(`- ${c.tool} ${JSON.stringify(c.input)}`);
  console.log(`\n===== THE SUMMARY (${out.model}) =====\n` + out.narrative);
  if (out.run.error) console.log("\nERROR: " + out.run.error);
  console.log("\n===== TOKENS =====\n" + JSON.stringify(out.run.usage));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
