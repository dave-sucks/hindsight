/**
 * The analyst's note is the proposal's reason: whether one is still coming
 * for an order (the card and the approval email wait on this), how the run's
 * notes land on its proposals, and the email's steps. Shaped on PLTR's
 * Auto-sell of 2026-10-28 and GEV's proposed sale of 2026-10-29 (Secular
 * Compounder).
 */
import { prismaDouble, positionRow } from "@/lib/replay";

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const AT = new Date("2026-10-28T14:10:24Z");

function book(run: Record<string, unknown> | null, extra: Record<string, unknown[]> = {}) {
  return prismaDouble({
    position: [positionRow({ id: "pos_pltr", symbol: "PLTR", analystId: SECULAR })],
    // Rows carry their relations inline (lib/replay/rows.ts).
    order: [{ id: "ord_pltr", positionId: "pos_pltr", symbol: "PLTR", thesisId: "th_pltr", status: "AWAITING_APPROVAL", createdAt: AT, position: { id: "pos_pltr", analystId: SECULAR, symbol: "PLTR" } }],
    researchRun: run ? [{ id: "run_pltr", agentConfigId: SECULAR, mode: "INTRADAY_TACTICAL", status: "RUNNING", startedAt: new Date(AT.getTime() - 20_000), createdAt: new Date(AT.getTime() - 20_000), parameters: { ticker: "PLTR", autoTrade: true }, ...run }] : [],
    ...extra,
  });
}

async function withDb<T>(db: ReturnType<typeof prismaDouble>, fn: (m: typeof import("./auto-writeup")) => Promise<T>): Promise<T> {
  let out!: T;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { send: jest.fn() } }));
    out = await fn(await import("./auto-writeup"));
  });
  jest.dontMock("@/lib/prisma");
  jest.dontMock("@/lib/inngest/client");
  return out;
}

const coming = (db: ReturnType<typeof prismaDouble>, now: Date) => withDb(db, (m) => m.writeupComing("ord_pltr", now));

describe("is the analyst still writing up this order?", () => {
  const soon = new Date(AT.getTime() + 60_000);
  it("yes, while the trigger run on its stock that started before it is running (an Auto trade)", async () => {
    expect(await coming(book({}), soon)).toBe(true);
  });
  it("yes, for a run that decided the trade itself: its note is coming too", async () => {
    expect(await coming(book({ parameters: { ticker: "PLTR" } }), soon)).toBe(true);
  });
  it("yes, while the morning run that proposed it is running", async () => {
    expect(await coming(book({ mode: "MORNING_PLAN", parameters: {} }), soon)).toBe(true);
  });
  it("no, once that run has finished", async () => {
    expect(await coming(book({ status: "COMPLETE" }), soon)).toBe(false);
  });
  it("no, once the note is on the order", async () => {
    const db = book({}, { thesisUpdate: [{ id: "u1", thesisId: "th_pltr", type: "REVIEWED", tradeId: "ord_pltr", runId: "run_pltr", timestamp: soon }] });
    expect(await coming(db, soon)).toBe(false);
  });
  it("no, for a run on another stock, or your chat (its words are on the order already)", async () => {
    expect(await coming(book({ parameters: { ticker: "V", autoTrade: true } }), soon)).toBe(false);
    expect(await coming(book({ mode: "PRINCIPAL_CHAT", parameters: {} }), soon)).toBe(false);
  });
  it("no, twenty minutes after the order, whatever the run row says", async () => {
    expect(await coming(book({}), new Date(AT.getTime() + 21 * 60_000))).toBe(false);
  });
});

describe("the run's notes land on its proposals", () => {
  const since = new Date(AT.getTime() - 20_000);
  const NOTE = "Palantir fell 4% on Oct. 28 with software; I proposed selling the 50 shares, it waits for you.";

  it("the note written after the order becomes its reason, and the note row is stamped with the order", async () => {
    const db = book({}, {
      thesisUpdate: [
        { id: "u_before", thesisId: "th_pltr", type: "REVIEWED", runId: "run_pltr", rationale: "Earlier in the run.", timestamp: new Date(AT.getTime() - 10_000) },
        { id: "u_note", thesisId: "th_pltr", type: "REVIEWED", runId: "run_pltr", rationale: NOTE, timestamp: new Date(AT.getTime() + 6_000) },
      ],
    });
    const noted = await withDb(db, (m) => m.putNotesOnRunProposals({ runId: "run_pltr", analystId: SECULAR, since }));
    expect(noted).toEqual(["ord_pltr"]);
    expect((db.store.order as Array<{ id: string; rationale: string }>).find((o) => o.id === "ord_pltr")?.rationale).toBe(NOTE);
    expect((db.store.thesisUpdate as Array<{ id: string; tradeId?: string }>).find((u) => u.id === "u_note")?.tradeId).toBe("ord_pltr");
    expect((db.store.thesisUpdate as Array<{ id: string; tradeId?: string }>).find((u) => u.id === "u_before")?.tradeId ?? null).toBeNull();
  });

  it("an order the run wrote no note on, or another run's note, is left alone", async () => {
    const db = book({}, { thesisUpdate: [{ id: "u_other", thesisId: "th_pltr", type: "REVIEWED", runId: "run_other", rationale: "Not this run.", timestamp: new Date(AT.getTime() + 6_000) }] });
    expect(await withDb(db, (m) => m.putNotesOnRunProposals({ runId: "run_pltr", analystId: SECULAR, since }))).toEqual([]);
    expect((db.store.order as Array<{ id: string; rationale?: string | null }>).find((o) => o.id === "ord_pltr")?.rationale ?? null).toBeNull();
  });

  it("an order from before the run is not this run's", async () => {
    const db = book({}, { thesisUpdate: [{ id: "u_note", thesisId: "th_pltr", type: "REVIEWED", runId: "run_pltr", rationale: NOTE, timestamp: new Date(AT.getTime() + 6_000) }] });
    expect(await withDb(db, (m) => m.putNotesOnRunProposals({ runId: "run_pltr", analystId: SECULAR, since: new Date(AT.getTime() + 1_000) }))).toEqual([]);
  });
});

describe("the approval email", () => {
  async function steps(writing: boolean) {
    const order: string[] = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: () => ({}), send: jest.fn() } }));
      jest.doMock("@/lib/proposals/auto-writeup", () => ({ NOTE_WRITTEN: "app/proposal.note.written", writeupComing: async () => writing }));
      jest.doMock("@/lib/emails/proposal-pending", () => ({ sendProposalPendingEmail: async () => order.push("email") }));
      const { proposalEmailSteps } = await import("@/lib/inngest/functions/proposal-pending-email");
      await proposalEmailSteps("ord_pltr", {
        run: async (_id, fn) => fn(),
        waitForEvent: async (_id, opts) => (order.push(`wait ${opts.event} ${opts.if} ${opts.timeout}`), null),
      });
    });
    for (const m of ["@/lib/inngest/client", "@/lib/proposals/auto-writeup", "@/lib/emails/proposal-pending"]) jest.dontMock(m);
    return order;
  }
  it("a run's proposal waits for the analyst's note, then goes", async () => {
    expect(await steps(true)).toEqual(["wait app/proposal.note.written async.data.orderId == event.data.orderId 15m", "email"]);
  });
  it("your chat's proposal carries your chat's words already and goes at once", async () => {
    expect(await steps(false)).toEqual(["email"]);
  });
});
