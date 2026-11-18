/**
 * discovery-dry-run.ts — the Discovery agent for one analyst, run once by
 * hand as a saved run, with nothing sent to the Writer.
 *
 *   npx tsx --env-file=.env.local scripts/discovery-dry-run.ts "PEAD Specialist" [PAPER|LIVE]
 *
 * The run is real: the runner opens a DISCOVERY run (/runs/<id>), runs the
 * agent with its schedule line's kickoff and keeps its books, as the
 * scheduler would. Its reads are real.
 * Only the Writer's dispatch is stood in for: each brief is printed and kept
 * in the run's thread, and nothing is sent. The book defaults to PAPER.
 */
import type { ToolSet } from "ai";
import { prisma } from "@/lib/prisma";
import { runAgentAsRun } from "@/lib/agent/engine/run";
import { DISCOVERY_RUN, discoveryArgs } from "@/lib/agent/discovery/run";
import { SCHEDULE } from "@/lib/agent/engine/schedule";

const dry = (real: ToolSet): ToolSet => ({
  ...real,
  dispatch_thesis_research: {
    ...real.dispatch_thesis_research,
    execute: async (input: { ticker?: string }) => {
      const ticker = String(input.ticker ?? "").toUpperCase();
      return {
        ok: true,
        ui: "tool-ui",
        summary: `Dry run: the brief on $${ticker} was recorded; nothing was sent to the Writer.`,
        data: { items: [{ kind: "ticker", ticker, text: "Dry run: the brief was recorded; nothing was sent to the Writer." }] },
        sources: [],
      };
    },
  },
} as ToolSet);

async function main() {
  const name = process.argv[2];
  const environment = process.argv[3] === "LIVE" ? "LIVE" : "PAPER";
  if (!name) throw new Error('Name the analyst: scripts/discovery-dry-run.ts "PEAD Specialist"');
  const ac = await prisma.agentConfig.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true, userId: true, accountId: true } });
  if (!ac) throw new Error(`No analyst named ${name}.`);

  const run = await runAgentAsRun(
    { ...DISCOVERY_RUN, args: (target, runId) => discoveryArgs(target, runId, { tools: dry }) },
    { userId: ac.userId, accountId: ac.accountId, environment, analystId: ac.id },
    // The kickoff its schedule line writes.
    SCHEDULE.find((s) => s.agent === "discovery")?.message,
  );
  console.log(`===== RUN ${run.runId}: ${run.status}${run.error ? ` (${run.error})` : ""} =====`);
  console.log("\n===== FIRST MESSAGE =====\n" + run.request.message);
  console.log("\n===== TOOL CALLS =====");
  for (const c of run.toolCalls) console.log(`- ${c.tool} ${c.tool === "dispatch_thesis_research" ? JSON.stringify(c.input, null, 2) : JSON.stringify(c.input)}`);
  console.log("\n===== WRITE-UP =====\n" + (run.text ?? "(none)"));
  console.log("\n===== TOKENS =====\n" + JSON.stringify(run.usage));
  console.log(`Each request's input: ${run.requests.join(", ")} (largest ${Math.max(0, ...run.requests)})`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
