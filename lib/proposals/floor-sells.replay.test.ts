/**
 * The floor on the chart sells automatically (the owner's ruling, 2026-10-16).
 *
 * A held stock's floor stored as "ask the analyst first" woke its analyst, who
 * could hold without proposing anything:
 *   ASML $1,835 (8e790d37), run cmv8fwn4j000i06jyrdc7x6ph, 2026-10-14 14:25 ET: held, no order.
 *   PLTR $196 (21976408), run cmvb0ywun000006l2i8phr39j, 2026-10-16 09:50 ET: held, no order.
 *   NVDA $236 (6306936b), 2026-10-15 14:30 ET: its run proposed the sale.
 * Rows from lib/agent/__fixtures__/book-2026-10-16.ts; the trigger run's real
 * handler, its model and broker doubled.
 */
import { prismaDouble, replayTool, REPLAY_ACCOUNT_ID, type PrismaDouble } from "@/lib/replay";
import { bookSeed, checkPass, stockOf, triggerRun } from "@/lib/replay/book";
import { PEAD, SECULAR } from "@/lib/agent/__fixtures__/book-2026-10-16";

type R = Record<string, unknown>;
const orders = (db: PrismaDouble) => (db.store.order ?? []) as R[];
const day = (only: string, floorSalesAtOnce: boolean, orders: R[] = []) => prismaDouble(bookSeed({ only: [only], account: { floorSalesAtOnce }, orders }));
const fire = (ticker: string, triggerId: string, analystId: string, firedPrice: number) => ({ thesisId: stockOf(ticker).thesisId, triggerId, analystId, ticker, action: "EXIT", firedPrice });

const ASML = { fire: fire("ASML", "8e790d37", SECULAR, 1685.16), at: new Date("2026-10-14T18:25:09Z"), fill: 1684.52 };
const PLTR = { fire: fire("PLTR", "21976408", SECULAR, 195.435), at: new Date("2026-10-16T13:50:19Z"), fill: 195.19 };

describe.each([
  ["ASML 2026-10-14 14:25", "ASML", ASML, 5],
  ["PLTR 2026-10-16 09:50", "PLTR", PLTR, 38],
])("%s — a floor stored as 'ask the analyst first'", (_name, ticker, c, shares) => {
  it("sells with no model call: proposed while sales wait for approval", async () => {
    const db = day(ticker, false);
    const run = await triggerRun(db, c.fire, { at: c.at, fill: c.fill });
    expect(run.modelCalls).toBe(0);
    expect(run.returned).toMatchObject({ fireMode: "DIRECT", direct: { kind: "proposed", reason: "STOP" } });
    expect(orders(db)).toEqual([expect.objectContaining({ symbol: ticker, intent: "CLOSE", status: "AWAITING_APPROVAL", quantity: shares, closeReason: "STOP", closeSource: "price_monitor" })]);
    expect(run.sent).toEqual([]);
  });

  it("sent at once with floor sales at once on", async () => {
    const db = day(ticker, true);
    const run = await triggerRun(db, c.fire, { at: c.at, fill: c.fill });
    expect(run.modelCalls).toBe(0);
    expect(run.sent).toEqual([expect.objectContaining({ symbol: ticker, qty: shares, side: "sell" })]);
    expect(orders(db).map((o) => o.status)).toEqual(["FILLED"]);
  });
});

describe("NVDA 2026-10-15 14:30 — a floor sale already waiting", () => {
  const waiting = {
    id: "cmv9vjk3h000d06ju6k1y9w3n", positionId: stockOf("NVDA").positionId, symbol: "NVDA", side: "SELL", intent: "CLOSE", status: "AWAITING_APPROVAL", quantity: 33,
    closeReason: "STOP", closeSource: "agent", environment: "LIVE", expiresAt: new Date("2026-10-16T18:30:46Z"), createdAt: new Date("2026-10-15T18:30:46Z"),
  };
  const nvda = { fire: fire("NVDA", "6306936b", PEAD, 217.01), at: new Date("2026-10-15T18:35:00Z"), fill: 217.08 };

  it("switch off: the next pass adds nothing", async () => {
    const db = day("NVDA", false, [waiting]);
    const run = await triggerRun(db, nvda.fire, { at: nvda.at, fill: nvda.fill });
    expect(run.returned).toMatchObject({ skipped: "close-already-queued", reason: "AWAITING_APPROVAL" });
    expect(orders(db).map((o) => o.status)).toEqual(["AWAITING_APPROVAL"]);
  });

  it("switch on: the next pass sends the sale and cancels the waiting one — one sale, never two", async () => {
    const db = day("NVDA", true, [waiting]);
    const run = await triggerRun(db, nvda.fire, { at: nvda.at, fill: nvda.fill });
    expect(run.sent).toHaveLength(1);
    expect(Object.fromEntries(orders(db).map((o) => [o.id === waiting.id ? "waiting" : "sent", o.status]))).toEqual({ waiting: "CANCELLED", sent: "FILLED" });
  });
});

describe("every other sell trigger keeps its mode", () => {
  it("the PEAD Specialist's 12% give-back (TACTICAL) still wakes the analyst", async () => {
    const db = day("NVDA", true);
    const run = await triggerRun(db, fire("NVDA", "f552414c", PEAD, 213), { at: new Date("2026-10-16T17:36:15Z"), fill: 213 });
    expect(run.modelCalls).toBe(1);
    expect(run.returned).not.toHaveProperty("direct");
    expect(orders(db)).toEqual([]);
  });
});

describe("the trigger check", () => {
  it("asks a held floor every pass: ASML's, fired yesterday and stored as once a day, fires again", async () => {
    const pass = await checkPass(day("ASML", false));
    expect(pass.sent.map((e) => e.data.triggerId)).toEqual(["8e790d37"]);
  });

  it("puts the floor first when a give-back fires with it, even one listed ahead of it, so the sale leads", async () => {
    // A give-back of the stock's own, listed before its floor (constructed).
    const giveBack = { id: "give_back_5", action: "EXIT", predicate: { watch: "move", is: "below", value: 5, variable: "peak" }, rationale: "-", fireMode: "TACTICAL", cooldownDays: 0 };
    const db = prismaDouble(bookSeed({ only: ["NVDA"], account: { floorSalesAtOnce: false }, thesis: (st) => ({ triggers: [giveBack, ...st.triggers] }) }));
    const pass = await checkPass(db, { prices: { NVDA: { price: 213, prevClose: stockOf("NVDA").prevClose } } });
    expect(pass.sent.map((e) => [e.data.triggerId, (e.data.coFired as R[] | undefined)?.map((c) => c.triggerId)])).toEqual([["6306936b", ["give_back_5"]]]);
  });
});

describe("a save writes the floor DIRECT, whoever saves", () => {
  it("an analyst raising PLTR's floor through update_thesis stores it DIRECT; its other triggers keep their modes", async () => {
    const before = stockOf("PLTR").triggers;
    const { db, refused } = await replayTool("update-thesis", "updateThesis", {
      seed: bookSeed({ only: ["PLTR"] }),
      ctx: { runMode: "MORNING_PLAN", runEnvironment: "LIVE", analystId: SECULAR },
      args: { thesis_id: stockOf("PLTR").thesisId, stop_loss: 197, rationale: "Holding PLTR at $198. Raising the floor to $197, just under the 20-day average." },
      quotes: { PLTR: 198 },
    });
    expect(refused).toBe(false);
    const after = (db.store.thesis as R[])[0].triggers as R[];
    expect(after.find((t) => t.id === "21976408")).toMatchObject({ fireMode: "DIRECT", predicate: { watch: "price", is: "below", value: 197 } });
    for (const t of after.filter((x) => x.id !== "21976408")) expect(t.fireMode).toBe(before.find((b) => b.id === t.id)?.fireMode);
  });
});

describe("the one check — approvalRequired", () => {
  async function required(account: R | null, args: R) {
    const db = prismaDouble({ account: account ? [{ id: REPLAY_ACCOUNT_ID, triggers: [], ...account }] : [] });
    let out: boolean | Error = false;
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      const { approvalRequired } = await import("@/lib/proposals/maybe-await-approval");
      out = await approvalRequired({ accountId: REPLAY_ACCOUNT_ID, environment: "LIVE", ...args } as Parameters<typeof approvalRequired>[0]).catch((e: Error) => e);
    });
    return out;
  }
  const on = { requireApprovalBuysLive: true, requireApprovalSellsLive: true, floorSalesAtOnce: true };

  it("skips the wait only for a floor's full sale with the switch on", async () => {
    expect(await required(on, { intent: "CLOSE", floorSale: true })).toBe(false);
    expect(await required(on, { intent: "CLOSE" })).toBe(true);
    expect(await required(on, { intent: "PARTIAL_CLOSE", floorSale: true })).toBe(true);
    expect(await required(on, { intent: "OPEN", floorSale: true })).toBe(true);
    expect(await required(on, { intent: "ADD", floorSale: true })).toBe(true);
    expect(await required({ ...on, floorSalesAtOnce: false }, { intent: "CLOSE", floorSale: true })).toBe(true);
  });

  it("an unresolved LIVE account still fails closed", async () => {
    expect(await required(null, { intent: "CLOSE", floorSale: true })).toBeInstanceOf(Error);
  });
});
