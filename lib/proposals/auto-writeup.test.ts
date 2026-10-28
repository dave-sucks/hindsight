/**
 * The write-up of an Auto trade: whether one is still coming for an order
 * (the card and the approval email wait on this), and the email's steps.
 * Shaped on PLTR's Auto-sell of 2026-10-28 (Secular Compounder).
 */
import { prismaDouble, positionRow } from "@/lib/replay";

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const AT = new Date("2026-10-28T14:10:24Z");

function book(run: Record<string, unknown> | null) {
  return prismaDouble({
    position: [positionRow({ id: "pos_pltr", symbol: "PLTR", analystId: SECULAR })],
    // Rows carry their relations inline (lib/replay/rows.ts).
    order: [{ id: "ord_pltr", positionId: "pos_pltr", symbol: "PLTR", status: "AWAITING_APPROVAL", createdAt: AT, position: { id: "pos_pltr", analystId: SECULAR, symbol: "PLTR" } }],
    researchRun: run ? [{ id: "run_pltr", agentConfigId: SECULAR, mode: "INTRADAY_TACTICAL", status: "RUNNING", createdAt: new Date(AT.getTime() - 20_000), parameters: { ticker: "PLTR", autoTrade: true }, ...run }] : [],
  });
}

async function coming(db: ReturnType<typeof prismaDouble>, now: Date) {
  let out = false;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { send: jest.fn() } }));
    const { writeupComing } = await import("./auto-writeup");
    out = await writeupComing("ord_pltr", now);
  });
  jest.dontMock("@/lib/prisma");
  jest.dontMock("@/lib/inngest/client");
  return out;
}

describe("is the analyst still writing up this order?", () => {
  const soon = new Date(AT.getTime() + 60_000);
  it("yes, while the Auto trigger run that made it is running", async () => {
    expect(await coming(book({}), soon)).toBe(true);
  });
  it("no, once that run has finished", async () => {
    expect(await coming(book({ status: "COMPLETE" }), soon)).toBe(false);
  });
  it("no, for a run that decided the trade itself (not an Auto write-up)", async () => {
    expect(await coming(book({ parameters: { ticker: "PLTR" } }), soon)).toBe(false);
  });
  it("no, for a run on another stock", async () => {
    expect(await coming(book({ parameters: { ticker: "V", autoTrade: true } }), soon)).toBe(false);
  });
  it("no, a quarter of an hour after the order, whatever the run row says", async () => {
    expect(await coming(book({}), new Date(AT.getTime() + 16 * 60_000))).toBe(false);
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
        waitForEvent: async (_id, opts) => (order.push(`wait ${opts.event} ${opts.match} ${opts.timeout}`), null),
      });
    });
    for (const m of ["@/lib/inngest/client", "@/lib/proposals/auto-writeup", "@/lib/emails/proposal-pending"]) jest.dontMock(m);
    return order;
  }
  it("an Auto trade's waits for the analyst's note, then goes", async () => {
    expect(await steps(true)).toEqual(["wait app/proposal.note.written data.orderId 6m", "email"]);
  });
  it("an analyst's proposal carries its note already and goes at once", async () => {
    expect(await steps(false)).toEqual(["email"]);
  });
});
