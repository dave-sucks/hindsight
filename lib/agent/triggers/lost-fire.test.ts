/** A fire whose trigger run failed: tried again, never traded twice, and the owner told at the end. */
import { prismaDouble, agentConfigRow, REPLAY_USER_ID, REPLAY_ACCOUNT_ID, type PrismaDouble, type Row } from "@/lib/replay";

let db: PrismaDouble;
const mockEmail = jest.fn(async (_args: { subject: string; body: string }) => true);
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));
jest.mock("@/lib/emails/run-lost", () => ({ sendRunLostEmail: (a: { subject: string; body: string }) => mockEmail(a) }));

import { recoverFire, FIRE_TRIES, type FailedFire } from "./lost-fire";

const TRIED = new Date("2026-11-24T15:05:00Z");
const fire = (over: Partial<FailedFire> = {}): FailedFire => ({ thesisId: "t1", triggerId: "g1", analystId: "a1", ticker: "NVDA", action: "EXIT", sentence: "Sell if below $236", ...over });
const later = new Date(TRIED.getTime() + 60_000);

function book(rows: { order?: Row[]; researchRun?: Row[] } = {}) {
  db = prismaDouble({
    agentConfig: [agentConfigRow({ id: "a1", accountId: REPLAY_ACCOUNT_ID, userId: REPLAY_USER_ID } as Partial<Row>)],
    order: rows.order ?? [],
    researchRun: rows.researchRun ?? [],
  });
}

function fakeStep() {
  const events: Array<{ name: string; data: Record<string, unknown> }> = [];
  const sleeps: string[] = [];
  return {
    events,
    sleeps,
    run: async <T,>(_id: string, fn: () => Promise<T>) => fn(),
    sleep: async (_id: string, time: string) => void sleeps.push(time),
    sendEvent: async (_id: string, e: { name: string; data: unknown }) => void events.push(e as { name: string; data: Record<string, unknown> }),
  };
}

const answered = (status = "COMPLETE") => ({ id: "r1", mode: "INTRADAY_TACTICAL", status, startedAt: later, parameters: { thesisId: "t1", triggerId: "g1" } });

beforeEach(() => mockEmail.mockClear());

describe("recoverFire", () => {
  it("tries a fire that left nothing again in five minutes, keeping when it first fired", async () => {
    book();
    const step = fakeStep();
    expect(await recoverFire({ data: fire(), ts: TRIED.getTime() }, step)).toEqual({ next: "retry" });
    expect(step.sleeps).toEqual(["5m"]);
    expect(step.events).toEqual([{ name: "app/thesis.trigger.fired", data: { ...fire(), recoveryTry: 1, firstFiredAt: TRIED.toISOString() } }]);
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it("a run that failed counts as nothing done", async () => {
    book({ researchRun: [answered("FAILED")] });
    expect((await recoverFire({ data: fire({ action: "REVIEW" }), ts: TRIED.getTime() }, fakeStep())).next).toBe("retry");
  });

  it("stops at its last try and tells the owner which trigger and stock", async () => {
    book();
    const step = fakeStep();
    expect(await recoverFire({ data: fire({ recoveryTry: FIRE_TRIES - 1 }), ts: TRIED.getTime() }, step)).toEqual({ next: "tell" });
    expect(step.events).toEqual([]);
    expect(mockEmail).toHaveBeenCalledTimes(1);
    expect(mockEmail.mock.calls[0][0].subject).toBe("NVDA: a trigger fired and its run failed");
    expect(mockEmail.mock.calls[0][0].body).toContain('"Sell if below $236" fired on NVDA');
  });

  it.each(["ENTER", "ADD", "EXIT", "TRIM"])("never repeats a %s whose try left an order", async (action) => {
    book({ order: [{ id: "o1", thesisId: "t1", createdAt: later }] });
    const step = fakeStep();
    expect(await recoverFire({ data: fire({ action }), ts: TRIED.getTime() }, step)).toEqual({ next: "nothing" });
    expect(step.events).toEqual([]);
  });

  it("an order from before this try doesn't stop it", async () => {
    book({ order: [{ id: "o0", thesisId: "t1", createdAt: new Date(TRIED.getTime() - 60_000) }] });
    expect((await recoverFire({ data: fire(), ts: TRIED.getTime() }, fakeStep())).next).toBe("retry");
  });

  it("a review the analyst answered needs nothing more", async () => {
    book({ researchRun: [answered()] });
    expect((await recoverFire({ data: fire({ action: "REVIEW" }), ts: TRIED.getTime() }, fakeStep())).next).toBe("nothing");
  });

  it("a sale the analyst answered with no card reaches the owner, with no second run", async () => {
    book({ researchRun: [answered()] });
    const step = fakeStep();
    expect((await recoverFire({ data: fire(), ts: TRIED.getTime() }, step)).next).toBe("tell");
    expect(step.events).toEqual([]);
    expect(mockEmail).toHaveBeenCalledTimes(1);
  });
});
