/** What a failed trigger run leaves to do: never a second trade, and a sale with no card reaches the owner. */
import { prismaDouble, agentConfigRow, thesisRow, REPLAY_USER_ID, REPLAY_ACCOUNT_ID, type PrismaDouble, type Row } from "@/lib/replay";

let db: PrismaDouble;
const mockEmail = jest.fn(async (_args: { subject: string; body: string }) => true);
const mockHolds = jest.fn(async () => new Set<string>(["g1"]));
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));
jest.mock("@/lib/emails/run-lost", () => ({ sendRunLostEmail: (a: { subject: string; body: string }) => mockEmail(a) }));
// What holds at today's price needs the live quote; it is doubled here.
jest.mock("./true-now", () => ({ trueNowIds: () => mockHolds() }));

import { fireLeft, tellFire, type FailedFire } from "./lost-fire";

const TRIED = new Date("2026-11-24T15:05:00Z");
const later = new Date(TRIED.getTime() + 60_000);
const fire = (over: Partial<FailedFire> = {}): FailedFire => ({ thesisId: "t1", triggerId: "g1", analystId: "a1", ticker: "NVDA", action: "EXIT", sentence: "Sell if below $236", ...over });
const run = (status: string, id = "r1") => ({ id, mode: "INTRADAY_TACTICAL", status, startedAt: later, parameters: { thesisId: "t1", triggerId: "g1" } });
const order = (status: string, createdAt = later) => ({ id: `o_${status}`, thesisId: "t1", status, createdAt });
const SALE = { id: "g1", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 236 }, rationale: "The floor." };

function book(rows: { order?: Row[]; researchRun?: Row[]; thesisUpdate?: Row[]; trigger?: Record<string, unknown> } = {}) {
  db = prismaDouble({
    agentConfig: [agentConfigRow({ id: "a1", accountId: REPLAY_ACCOUNT_ID, userId: REPLAY_USER_ID } as Partial<Row>)],
    thesis: [thesisRow({ id: "t1", ticker: "NVDA", status: "HOLDING", userId: REPLAY_USER_ID, triggers: [rows.trigger ?? SALE] } as Partial<Row>)],
    order: rows.order ?? [],
    researchRun: rows.researchRun ?? [],
    thesisUpdate: rows.thesisUpdate ?? [],
  });
}

beforeEach(() => {
  mockEmail.mockClear();
  mockEmail.mockResolvedValue(true);
  mockHolds.mockResolvedValue(new Set(["g1"]));
});

describe("fireLeft", () => {
  it("a try that left nothing is tried again, and so is a run that failed having written nothing", async () => {
    book();
    expect(await fireLeft(fire(), TRIED)).toBe("retry");
    book({ researchRun: [run("FAILED")], thesisUpdate: [{ id: "f1", thesisId: "t1", runId: "r1", type: "TRIGGER_FIRED", timestamp: later }] });
    expect(await fireLeft(fire({ action: "REVIEW" }), TRIED)).toBe("retry");
  });

  it.each(["AWAITING_APPROVAL", "PENDING", "FILLED"])("never repeats a try that left an order %s", async (status) => {
    book({ order: [order(status)] });
    expect(await fireLeft(fire({ action: "ENTER" }), TRIED)).toBe("done");
  });

  it("a rejected order, or one from before the try, is no trade", async () => {
    book({ order: [order("REJECTED"), order("FILLED", new Date(TRIED.getTime() - 60_000))] });
    expect(await fireLeft(fire(), TRIED)).toBe("retry");
  });

  it("a run that wrote its note answered the fire, even if it then failed: no second run", async () => {
    book({ researchRun: [run("FAILED")], thesisUpdate: [{ id: "n1", thesisId: "t1", runId: "r1", type: "REVIEWED", timestamp: later }] });
    expect(await fireLeft(fire({ action: "REVIEW" }), TRIED)).toBe("done");
    // A sale it answered whose card didn't open reaches the owner.
    expect(await fireLeft(fire(), TRIED)).toBe("tell");
  });

  it("a finished run on a review is done", async () => {
    book({ researchRun: [run("COMPLETE")] });
    expect(await fireLeft(fire({ action: "REVIEW" }), TRIED)).toBe("done");
  });

  it("an Auto trade goes again only while its trigger holds; otherwise the owner is told", async () => {
    book({ trigger: { ...SALE, fireMode: "DO_IT" } });
    expect(await fireLeft(fire(), TRIED)).toBe("retry");
    mockHolds.mockResolvedValue(new Set());
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

  it("an email that didn't send fails the step, so it is tried again", async () => {
    book();
    mockEmail.mockResolvedValue(false);
    await expect(tellFire(fire())).rejects.toThrow("didn't send");
  });
});
