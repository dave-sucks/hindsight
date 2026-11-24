/** What a failed trigger run leaves to do: never a second trade, and a sale with no card reaches the owner. */
import { prismaDouble, agentConfigRow, REPLAY_USER_ID, REPLAY_ACCOUNT_ID, type PrismaDouble, type Row } from "@/lib/replay";

let db: PrismaDouble;
const mockEmail = jest.fn(async (_args: { subject: string; body: string }) => true);
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));
jest.mock("@/lib/emails/run-lost", () => ({ sendRunLostEmail: (a: { subject: string; body: string }) => mockEmail(a) }));

import { fireLeft, tellFire, type FailedFire } from "./lost-fire";

const TRIED = new Date("2026-11-24T15:05:00Z");
const later = new Date(TRIED.getTime() + 60_000);
const fire = (over: Partial<FailedFire> = {}): FailedFire => ({ thesisId: "t1", triggerId: "g1", analystId: "a1", ticker: "NVDA", action: "EXIT", sentence: "Sell if below $236", ...over });
const run = (status: string) => ({ id: "r1", mode: "INTRADAY_TACTICAL", status, startedAt: later, parameters: { thesisId: "t1", triggerId: "g1" } });

function book(rows: { order?: Row[]; researchRun?: Row[] } = {}) {
  db = prismaDouble({
    agentConfig: [agentConfigRow({ id: "a1", accountId: REPLAY_ACCOUNT_ID, userId: REPLAY_USER_ID } as Partial<Row>)],
    order: rows.order ?? [],
    researchRun: rows.researchRun ?? [],
  });
}

beforeEach(() => mockEmail.mockClear());

describe("fireLeft", () => {
  it("a try that left nothing is tried again", async () => {
    book();
    expect(await fireLeft(fire(), TRIED)).toBe("retry");
  });

  it("a run that failed counts as nothing done", async () => {
    book({ researchRun: [run("FAILED")] });
    expect(await fireLeft(fire({ action: "REVIEW" }), TRIED)).toBe("retry");
  });

  it.each(["ENTER", "ADD", "EXIT", "TRIM"])("never repeats a %s whose try left an order", async (action) => {
    book({ order: [{ id: "o1", thesisId: "t1", createdAt: later }] });
    expect(await fireLeft(fire({ action }), TRIED)).toBe("done");
  });

  it("an order from before the try doesn't stop it", async () => {
    book({ order: [{ id: "o0", thesisId: "t1", createdAt: new Date(TRIED.getTime() - 60_000) }] });
    expect(await fireLeft(fire(), TRIED)).toBe("retry");
  });

  it("a review the analyst answered needs nothing more; a sale it answered with no card reaches the owner", async () => {
    book({ researchRun: [run("COMPLETE")] });
    expect(await fireLeft(fire({ action: "REVIEW" }), TRIED)).toBe("done");
    expect(await fireLeft(fire(), TRIED)).toBe("tell");
  });

  it("with no time for the try, nothing can be checked, so the owner is told", async () => {
    book();
    expect(await fireLeft(fire(), new Date(0))).toBe("tell");
  });
});

describe("tellFire", () => {
  it("names the trigger and the stock", async () => {
    book();
    await tellFire(fire());
    expect(mockEmail.mock.calls[0][0].subject).toBe("NVDA: a trigger fired and its run failed");
    expect(mockEmail.mock.calls[0][0].body).toContain('"Sell if below $236" fired on NVDA');
  });
});
