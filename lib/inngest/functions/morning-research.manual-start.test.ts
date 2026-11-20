/**
 * A manual start of the morning run is for the account that asked.
 *
 * `/api/research/trigger` sends its caller's account with the event, but the
 * job loaded every enabled analyst on every account (or any analyst by id).
 * The 8 AM schedule names no account and still runs them all.
 * The job's own handler, with the database, Inngest and the clock doubled; a
 * Thursday with analysts scheduled for Mondays, so it stops after loading.
 */
import { prismaDouble, agentConfigRow, REPLAY_ACCOUNT_ID } from "@/lib/replay";

const THURSDAY_8AM = new Date("2026-11-19T13:00:05Z");

async function start(data: Record<string, unknown>): Promise<{ loaded: string[]; result: Record<string, unknown> }> {
  const db = prismaDouble({
    agentConfig: [
      agentConfigRow({ id: "mine", name: "Mine", runDaysOfWeek: [1] }),
      agentConfigRow({ id: "theirs", name: "Theirs", accountId: "account_other", runDaysOfWeek: [1] }),
    ],
  });
  let loaded: string[] = [];
  let result: Record<string, unknown> = {};
  jest.useFakeTimers({ now: THURSDAY_8AM, doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  try {
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<Record<string, unknown>>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: async () => undefined } }));
      await import("@/lib/inngest/functions/morning-research");
      result = await handler!({
        event: { name: data.accountId ? "app/research.run.manual" : "inngest/scheduled.timer", data },
        step: {
          run: async (id: string, fn: () => Promise<unknown>) => {
            const out = await fn();
            if (id === "load-agent-configs") loaded = (out as Array<{ id: string }>).map((a) => a.id);
            return out;
          },
        },
      });
    });
  } finally {
    jest.useRealTimers();
  }
  return { loaded, result };
}

describe("the morning run, started by hand", () => {
  it("runs only the analysts of the account that asked", async () => {
    expect((await start({ accountId: REPLAY_ACCOUNT_ID })).loaded).toEqual(["mine"]);
  });

  it("another account's analyst, named by id, is not loaded", async () => {
    const { loaded, result } = await start({ accountId: REPLAY_ACCOUNT_ID, agentConfigId: "theirs" });
    expect(loaded).toEqual([]);
    expect(result).toMatchObject({ ran: 0, reason: "no-enabled-configs" });
  });

  it("the 8 AM schedule names no account and loads every enabled analyst", async () => {
    expect((await start({})).loaded.sort()).toEqual(["mine", "theirs"]);
  });
});
