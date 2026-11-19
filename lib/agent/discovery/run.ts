/**
 * The Discovery agent's run: what its record (lib/agent/engine/agents/discovery.ts)
 * is given for one analyst. The agent runner (runAgentAsRun,
 * lib/agent/engine/run.ts) opens the run, runs it and keeps its books; the
 * scheduler runs it on its line in the schedule, which writes its kickoff.
 * The analyst is its brief, with its free slots; its context is the
 * analyst's book and the earnings calendar outside the book, read by the
 * same tool it may call. Its tools act for the analyst, inside its fence.
 */
import type { ToolSet } from "ai";
import { prisma } from "@/lib/prisma";
import { createResearchTools } from "@/lib/agent/tools";
import { analystScope } from "@/lib/agent/analyst-scope";
import type { AgentToRun, RunAgentArgs, RunFor } from "@/lib/agent/engine/run";
import { DISCOVERY, SENDS_A_RUN } from "@/lib/agent/engine/agents/discovery";

export const DISCOVERY_RUN_MODE = "DISCOVERY";

type Exec = (input: Record<string, unknown>, options: unknown) => Promise<unknown>;

/** The run's tools with its send limit: SENDS_A_RUN stocks to the Writer a run. */
export function withSendLimit(real: ToolSet): ToolSet {
  const t = real.dispatch_thesis_research as unknown as { execute?: Exec } | undefined;
  if (!t?.execute) return real;
  const run = t.execute;
  const sent: string[] = [];
  const dispatch = {
    ...t,
    execute: async (input: Record<string, unknown>, options: unknown) => {
      if (sent.length >= SENDS_A_RUN)
        return { ok: false, error: `You have sent your ${SENDS_A_RUN} stocks for this run (${sent.join(", ")}). Name the rest in your write-up.`, retryable: false, sources: [] };
      const out = await run(input, options);
      if ((out as { ok?: boolean } | null)?.ok === true) sent.push(String(input.ticker ?? "").toUpperCase());
      return out;
    },
  };
  return { ...real, dispatch_thesis_research: dispatch } as unknown as ToolSet;
}

/**
 * What its run is given for one analyst: the blocks' reads and its tools,
 * acting for the analyst in the run's book. `tools` lets a dry run swap the
 * Writer's dispatch for one that sends nothing.
 */
export async function discoveryArgs(
  target: RunFor,
  runId: string | null,
  opts: { now?: Date; tools?: (real: ToolSet) => ToolSet } = {},
): Promise<Omit<RunAgentArgs, "runId">> {
  if (!target.analystId) throw new Error("Discovery works for one analyst, and its run names none.");
  const ac = await prisma.agentConfig.findFirst({ where: { id: target.analystId, accountId: target.accountId } });
  if (!ac) throw new Error(`Analyst ${target.analystId} is not in this account.`);
  const scope = await analystScope(ac, target.userId, target.environment);
  const toolset = createResearchTools({ runId: runId ?? "", userId: target.userId, accountId: target.accountId, runMode: DISCOVERY_RUN_MODE, ...scope }) as ToolSet;
  return {
    input: { now: opts.now ?? new Date(), environment: target.environment },
    subject: { kind: "analyst", userId: target.userId, accountId: target.accountId, environment: target.environment, analystId: ac.id },
    toolset,
    // A dry run's stand-in dispatch goes under the limit, so its sends are counted as a real run's.
    wrapTools: (mine) => withSendLimit(opts.tools ? opts.tools(mine) : mine),
    source: "discovery",
  };
}

/** Discovery as the runner runs it on its own: one saved run per analyst. */
export const DISCOVERY_RUN: AgentToRun = {
  record: DISCOVERY,
  mode: DISCOVERY_RUN_MODE,
  args: (target, runId) => discoveryArgs(target, runId),
};
