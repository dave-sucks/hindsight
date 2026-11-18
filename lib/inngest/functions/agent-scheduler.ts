/**
 * agent-scheduler — the one scheduler. Its triggers are the times of the
 * agents that are on in the schedule (lib/agent/engine/schedule.ts). When one
 * fires, it runs each agent due at that time, once per traded book or once
 * per enabled analyst, through the agent runner (runAgentAsRun), which opens
 * the run and keeps its books. An agent that skips market holidays runs
 * nothing on one. A change to the schedule's times needs an Inngest sync
 * after the deploy.
 */
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { getOwnerUserId } from "@/lib/auth/account";
import { isTradingDay } from "@/lib/market-hours";
import { tradedBooks } from "@/lib/inngest/functions/market-reviewer";
import { runAgentAsRun, type AgentToRun, type RunFor } from "@/lib/agent/engine/run";
import { dueAt, scheduleTriggers, type ScheduledAgent } from "@/lib/agent/engine/schedule";
import type { AgentId } from "@/lib/agent/engine/types";
import { PORTFOLIO_MANAGER_RUN } from "@/lib/agent/portfolio-manager/run";
import { DISCOVERY_RUN } from "@/lib/agent/discovery/run";

/** How each scheduled agent runs on its own: its record, its run's mode, its reads and tools, its own save. */
export const SCHEDULED_RUNS: Partial<Record<AgentId, AgentToRun>> = {
  portfolio_manager: PORTFOLIO_MANAGER_RUN,
  discovery: DISCOVERY_RUN,
};

/** Who each run is for: every traded book with an owner, or every enabled analyst in its own book. */
export async function targetsFor(per: ScheduledAgent["per"]): Promise<RunFor[]> {
  if (per === "analyst") {
    const analysts = await prisma.agentConfig.findMany({ where: { enabled: true }, select: { id: true, userId: true, accountId: true, tradingEnvironment: true }, orderBy: { createdAt: "asc" } });
    return analysts.map((a) => ({ userId: a.userId, accountId: a.accountId, environment: a.tradingEnvironment === "LIVE" ? "LIVE" : "PAPER", analystId: a.id }));
  }
  const out: RunFor[] = [];
  for (const b of await tradedBooks()) {
    const userId = await getOwnerUserId(b.accountId);
    if (userId) out.push({ ...b, userId });
  }
  return out;
}

export const agentScheduler = inngest.createFunction(
  { id: "agent-scheduler", name: "Agent scheduler", retries: 0, concurrency: { limit: 1 } },
  scheduleTriggers(),
  async ({ event, step }) => {
    const due = dueAt(String((event.data as { cron?: string })?.cron ?? ""));
    const done: Array<{ agent: string; for: string; run: string; status: string }> = [];
    for (const s of due) {
      const id = s.agent;
      const agent = SCHEDULED_RUNS[id];
      if (!agent) {
        console.error(`[agent-scheduler] ${id} is on the schedule with no way to run it`);
        continue;
      }
      if (s.marketDaysOnly && !isTradingDay(new Date())) {
        console.log(`[agent-scheduler] ${id}: the market is closed today`);
        continue;
      }
      const targets = await step.run(`targets-${id}`, () => targetsFor(s.per));
      for (const t of targets) {
        const key = t.analystId ?? `${t.accountId}-${t.environment}`;
        // One step a run: a retry would start a second run and could propose its trades twice.
        const out = await step.run(`${id}-${key}`, async () => {
          const run = await runAgentAsRun(agent, t, s.message);
          return { runId: run.runId, status: run.status };
        });
        done.push({ agent: id, for: key, run: out.runId, status: out.status });
      }
    }
    console.log(`[agent-scheduler] ${done.map((d) => `${d.agent} ${d.for} ${d.status}`).join("; ") || "nothing due"}`);
    return { done };
  },
);
