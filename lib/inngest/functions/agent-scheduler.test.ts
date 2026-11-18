/**
 * The one scheduler: its triggers are the times of the agents that are on,
 * and when one fires it runs each agent due then, once per book or analyst,
 * through the runner. Through the job's own handler; the runner, the
 * database and the books are stood in for.
 */
import type { AgentToRun, RunFor } from "@/lib/agent/engine/run";
import type { ScheduledAgent } from "@/lib/agent/engine/schedule";
import type { AgentId } from "@/lib/agent/engine/types";

type Handler = (ctx: { event: { data: { cron?: string } }; step: { run: (name: string, fn: () => unknown) => Promise<unknown> } }) => Promise<unknown>;

const agentOf = (id: string): AgentToRun => ({ record: { id } as AgentToRun["record"], mode: id.toUpperCase(), args: () => Promise.reject(new Error("not run")) });

async function load(schedule: ScheduledAgent[], opts: { tradingDay?: boolean; standIns?: boolean } = {}) {
  const runs: Array<{ agent: string; target: RunFor; message?: string | null }> = [];
  let handler: Handler | null = null;
  let triggers: unknown = null;
  let scheduled: Partial<Record<AgentId, AgentToRun>> = {};
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, t: unknown, h: Handler) => ((triggers = t), (handler = h), {}) } }));
    jest.doMock("@/lib/agent/engine/schedule", () => {
      const real = jest.requireActual("@/lib/agent/engine/schedule");
      return { ...real, SCHEDULE: schedule, scheduleTriggers: () => real.scheduleTriggers(schedule), dueAt: (c: string) => real.dueAt(c, schedule) };
    });
    jest.doMock("@/lib/agent/engine/run", () => ({
      runAgentAsRun: async (agent: AgentToRun, target: RunFor, message?: string | null) => (
        runs.push({ agent: agent.record.id, target, ...(message ? { message } : {}) }), { runId: `run_${runs.length}`, status: "COMPLETE" }
      ),
    }));
    jest.doMock("@/lib/prisma", () => ({
      prisma: { agentConfig: { findMany: async () => [{ id: "analyst_a", userId: "user_1", accountId: "acct_1", tradingEnvironment: "PAPER" }, { id: "analyst_b", userId: "user_1", accountId: "acct_1", tradingEnvironment: "LIVE" }] } },
    }));
    jest.doMock("@/lib/inngest/functions/market-reviewer", () => ({
      tradedBooks: async () => [
        { accountId: "acct_1", environment: "PAPER" },
        { accountId: "acct_1", environment: "LIVE" },
        { accountId: "acct_orphan", environment: "PAPER" },
      ],
    }));
    jest.doMock("@/lib/auth/account", () => ({ getOwnerUserId: async (a: string) => (a === "acct_orphan" ? null : "user_1") }));
    jest.doMock("@/lib/market-hours", () => ({ isTradingDay: () => opts.tradingDay ?? true }));
    jest.doMock("@/lib/agent/portfolio-manager/run", () => ({ PORTFOLIO_MANAGER_RUN: agentOf("portfolio_manager") }));
    jest.doMock("@/lib/agent/discovery/run", () => ({ DISCOVERY_RUN: agentOf("discovery") }));
    const mod = await import("./agent-scheduler");
    scheduled = mod.SCHEDULED_RUNS;
    // Each line's agent, stood in, unless the test is of the real list.
    if (opts.standIns !== false) for (const line of schedule) mod.SCHEDULED_RUNS[line.agent] = agentOf(line.agent);
  });
  jest.spyOn(console, "log").mockImplementation(() => {});
  const fire = (cron: string) => handler!({ event: { data: { cron } }, step: { run: async (_n, fn) => fn() } });
  return { runs, triggers, fire, scheduled };
}

afterEach(() => jest.restoreAllMocks());

const PM: ScheduledAgent = { agent: "portfolio_manager", cron: "0 10 * * 2,4", per: "book", marketDaysOnly: true, on: true };
// A per-analyst agent that runs on a closed market too, stood in by an agent id the schedule doesn't use.
const SCOUT: ScheduledAgent = { agent: "morning_run", cron: "0 10 * * 2,4", per: "analyst", marketDaysOnly: false, on: true };
const OFF: ScheduledAgent = { agent: "morning_run", cron: "30 9 * * 0", per: "analyst", marketDaysOnly: false, on: false };

it("is triggered at each time an agent that is on runs, once, in New York", async () => {
  const { triggers } = await load([PM, SCOUT, OFF]);
  expect(triggers).toEqual([{ cron: "TZ=America/New_York 0 10 * * 2,4" }]);
});

it("runs each agent due once per traded book with an owner, or per enabled analyst in its own book", async () => {
  const { runs, fire } = await load([PM, SCOUT, OFF]);
  await fire("TZ=America/New_York 0 10 * * 2,4");
  expect(runs).toEqual([
    { agent: "portfolio_manager", target: { accountId: "acct_1", environment: "PAPER", userId: "user_1" } },
    { agent: "portfolio_manager", target: { accountId: "acct_1", environment: "LIVE", userId: "user_1" } },
    { agent: "morning_run", target: { accountId: "acct_1", environment: "PAPER", userId: "user_1", analystId: "analyst_a" } },
    { agent: "morning_run", target: { accountId: "acct_1", environment: "LIVE", userId: "user_1", analystId: "analyst_b" } },
  ]);
});

it("hands each run its line's kickoff, when the line writes one", async () => {
  const { runs, fire } = await load([{ ...SCOUT, message: "Find this analyst's next stocks." }]);
  await fire("TZ=America/New_York 0 10 * * 2,4");
  expect(runs.map((r) => r.message)).toEqual(["Find this analyst's next stocks.", "Find this analyst's next stocks."]);
});

it("matches the time that fired with or without its time zone", async () => {
  const { runs, fire } = await load([PM]);
  await fire("0 10 * * 2,4");
  expect(runs).toHaveLength(2);
});

it("runs nothing that is off, or at another time", async () => {
  const { runs, fire } = await load([PM, OFF]);
  await fire("TZ=America/New_York 30 9 * * 0");
  expect(runs).toEqual([]);
});

it("on a market holiday, runs only the agents that run when the market is closed", async () => {
  const { runs, fire } = await load([PM, SCOUT], { tradingDay: false });
  await fire("TZ=America/New_York 0 10 * * 2,4");
  expect(runs.map((r) => r.agent)).toEqual(["morning_run", "morning_run"]);
});

describe("the schedule", () => {
  it("has the Portfolio Manager on, Tue and Thu at 10:00 AM, per book, on market days", () => {
    const { SCHEDULE } = jest.requireActual("@/lib/agent/engine/schedule") as typeof import("@/lib/agent/engine/schedule");
    expect(SCHEDULE).toContainEqual({
      agent: "portfolio_manager",
      cron: "0 10 * * 2,4",
      per: "book",
      marketDaysOnly: true,
      on: true,
    });
  });

  it("has a way to run each agent on it", async () => {
    const { SCHEDULE } = jest.requireActual("@/lib/agent/engine/schedule") as typeof import("@/lib/agent/engine/schedule");
    const { scheduled } = await load([...SCHEDULE], { standIns: false });
    for (const line of SCHEDULE) expect([line.agent, Boolean(scheduled[line.agent])]).toEqual([line.agent, true]);
  });

  it("says when each agent runs, from its line: the record keeps no second copy", () => {
    const { whenItRuns, cronInWords } = jest.requireActual("@/lib/agent/engine/schedule") as typeof import("@/lib/agent/engine/schedule");
    const { PORTFOLIO_MANAGER } = jest.requireActual("@/lib/agent/engine/agents/portfolio-manager") as typeof import("@/lib/agent/engine/agents/portfolio-manager");
    expect(PORTFOLIO_MANAGER.runsWhen).toBeUndefined();
    expect(whenItRuns(PORTFOLIO_MANAGER)).toBe("Tuesday and Thursday at 10:00 AM ET, one run per traded book.");
    expect(whenItRuns({ id: "morning_run" }, [OFF])).toBe("Sunday at 9:30 AM ET, one run per analyst. Off until you turn it on.");
    expect(whenItRuns({ id: "chat", runsWhen: "When you write to it." })).toBe("When you write to it.");
    expect(cronInWords("30 7 * * 1-5")).toBe("Weekdays at 7:30 AM ET");
    expect(cronInWords("0 20 * * *")).toBe("Every day at 8:00 PM ET");
    expect(cronInWords("15 16 * * 1,3,5")).toBe("Monday, Wednesday and Friday at 4:15 PM ET");
  });

  it("has Discovery per analyst, off, its kickoff its message", () => {
    const { SCHEDULE, whenItRuns } = jest.requireActual("@/lib/agent/engine/schedule") as typeof import("@/lib/agent/engine/schedule");
    expect(SCHEDULE.filter((s) => s.agent === "discovery")).toEqual([
      { agent: "discovery", cron: "0 9 * * 2,4", per: "analyst", marketDaysOnly: true, on: false, message: "Find this analyst's next stocks." },
    ]);
    expect(whenItRuns({ id: "discovery" })).toBe("Tuesday and Thursday at 9:00 AM ET, one run per analyst. Off until you turn it on.");
  });

  it("runs every scheduled agent as a run that takes no messages, so its page never starts a second agent on it", () => {
    const { SCHEDULE } = jest.requireActual("@/lib/agent/engine/schedule") as typeof import("@/lib/agent/engine/schedule");
    const { READ_ONLY_RUN_MODES } = jest.requireActual("@/lib/runs/modes") as typeof import("@/lib/runs/modes");
    const MODES: Record<string, string> = { portfolio_manager: "PORTFOLIO_MANAGER", discovery: "DISCOVERY" };
    for (const s of SCHEDULE) expect([s.agent, READ_ONLY_RUN_MODES.has(MODES[s.agent])]).toEqual([s.agent, true]);
  });

  it("fits Inngest: one to ten distinct times", () => {
    const { scheduleTriggers } = jest.requireActual("@/lib/agent/engine/schedule") as typeof import("@/lib/agent/engine/schedule");
    const n = scheduleTriggers().length;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(10);
  });
});
