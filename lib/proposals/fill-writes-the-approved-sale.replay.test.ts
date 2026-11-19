/**
 * At the fill, the watch's lines come off and the holding's sale goes on at
 * the approved price (2026-11-16): the buy and the Stop watching line are
 * removed, and "Sell if below $X" is written from the order's stop through
 * the FLOOR level op. A watch's line never becomes the sale. Approved as
 * proposed, the sale is the analyst's, with its reason as its note; a price
 * you change in Edit & Approve is yours ("You set this"), as a Trade-ticket
 * price is. A promoted stock's fill takes its watch lines off the same way.
 *
 * WST, watched, as production stored it on 2026-11-16, its line as the
 * migration stores it; its 11-13 buy proposal ($415.14), approved through
 * approveProposal, the path every live buy takes. Only the database, the
 * broker and the clock are doubled; stop when buying is off, so the sale is
 * the one approved. No stock is PROMOTED in production today, so that case is
 * WST's row with its status set to PROMOTED.
 */

import { statSync } from "fs";
import raw from "@/lib/agent/__fixtures__/wst-fill-2026-11-13.json";
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_ANALYST_ID, REPLAY_USER_ID, type PrismaDouble } from "@/lib/replay";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import type { Trigger } from "@/lib/agent/triggers/types";

const FIXTURE = "lib/agent/__fixtures__/wst-fill-2026-11-13.json";
const fx = raw as unknown as { thesis: Record<string, unknown> & { triggers: Array<Record<string, unknown> & { id: string; action: string; predicate: Record<string, unknown> }> }; proposal: { positionId: string; avgCost: number; stopLoss: number; targetPrice: number } };
const AT = new Date("2026-11-16T15:00:00Z");
const BUY = "1d09278f-b9cd-4601-97e1-e00c8e64a010";
const LINE = "b48ef278-106b-4da5-8f6a-f2013904eda1";
/** The proposal's sale: a price the trigger run named, not the watch's $392 line. */
const SALE = 401.2;
const REASON = "Under the post-earnings base at $402: below it the reclaim has failed.";

/** WST's row with its line as the migration stores it (STOP_WATCHING, on the close). */
const migrated = fx.thesis.triggers.map((t) => (t.id === LINE ? { ...t, action: "STOP_WATCHING", predicate: { ...t.predicate, settings: { close: true } } } : t));

/** WST's buy proposal, staged with the analyst's sale and reason, approved through approveProposal; `edits` is Edit & Approve. */
async function approve(opts: { edits?: { stopLoss: number }; status?: "WATCHING" | "PROMOTED"; triggers?: unknown[]; setupId?: string | null; account?: Record<string, unknown>; playbookReadFails?: boolean } = {}): Promise<PrismaDouble> {
  const position = positionRow({ id: fx.proposal.positionId, symbol: "WST", status: "PENDING_APPROVAL", environment: "LIVE", userId: REPLAY_USER_ID, avgCost: fx.proposal.avgCost, quantity: 10, stopLoss: SALE, stopReason: REASON, targetPrice: null });
  const db = prismaDouble({
    account: [accountRow({ autoStopOnBuy: false, setupOverrides: {}, ...opts.account })],
    agentConfig: [agentConfigRow({ autoStopOnBuy: null, autoStopPct: null, tradingEnvironment: "LIVE" })],
    thesis: [thesisRow({ ...fx.thesis, status: opts.status ?? "WATCHING", triggers: opts.triggers ?? migrated, ...(opts.setupId !== undefined ? { setupId: opts.setupId } : {}) })],
    position: [position],
    // The double joins nothing: an order carries its position inline, as the approval reads it.
    order: [{ id: "order_WST", positionId: position.id, position, userId: REPLAY_USER_ID, environment: "LIVE", symbol: "WST", side: "BUY", orderType: "MARKET", quantity: 10, status: "AWAITING_APPROVAL", intent: "OPEN", idempotencyKey: "idem-wst-1113", thesisId: fx.thesis.id, triggerIds: [], expiresAt: null, createdAt: new Date("2026-11-13T23:30:32Z") }],
  });
  if (opts.playbookReadFails) {
    // Only the playbook read fails; every other account read still answers.
    const account = db.account as { findUnique: (a?: { select?: { playbooks?: boolean } }) => Promise<unknown> };
    const read = account.findUnique;
    account.findUnique = async (a = {}) => {
      if (a.select?.playbooks) throw new Error("connection reset");
      return read(a);
    };
  }
  jest.useFakeTimers({ now: AT, doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  try {
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => ({ keyId: "PKTEST", secretKey: "s", baseUrl: "https://api.alpaca.markets" }) }));
      jest.doMock("@/lib/alpaca", () => ({
        placeMarketOrder: async () => ({ id: "alpaca_order_1", status: "accepted" }),
        closePositionPartial: async () => null,
        getLatestPrice: async () => fx.proposal.avgCost,
      }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: () => ({}), send: jest.fn() } }));
      const { approveProposal } = await import("./execute");
      await approveProposal("order_WST", REPLAY_USER_ID, opts.edits);
    });
  } finally {
    jest.useRealTimers();
  }
  return db;
}

const thesisOf = (db: PrismaDouble) => (db.store.thesis as Array<Record<string, unknown>>)[0];
const triggersOf = (db: PrismaDouble) => thesisOf(db).triggers as Trigger[];
const salesOf = (db: PrismaDouble) => triggersOf(db).filter((t) => t.action === "EXIT");
const activity = (db: PrismaDouble) =>
  ((db.store.thesisUpdate as Array<{ fieldChanges: { triggerOps?: { to: Array<{ text: string }> } } }>)[0].fieldChanges.triggerOps?.to ?? []).map((o) => o.text);

describe("WST's buy approved: the watch's lines come off, the approved sale goes on", () => {
  it("before the fill it is a watch: a buy and a Stop watching line on the close", () => {
    const said = migrated.map((t) => sentenceOf(t as never));
    expect(said).toContain("Buy if below $415.14");
    expect(said).toContain("Stop watching if below $392 · only on the close");
  });

  it("approved as proposed: the buy and the Stop watching line come off; Sell if below $401.20 goes on, the analyst's, with its reason", async () => {
    const db = await approve();
    expect(thesisOf(db)).toMatchObject({ status: "HOLDING" });
    expect(triggersOf(db).filter((t) => t.id === BUY || t.id === LINE || t.action === "STOP_WATCHING" || t.action === "ENTER")).toEqual([]);
    expect(salesOf(db)).toEqual([expect.objectContaining({ predicate: { watch: "price", is: "below", value: SALE }, rationale: REASON, source: "AGENT" })]);
    expect(sentenceOf(salesOf(db)[0])).toBe("Sell if below $401.20");
    expect(activity(db)).toEqual(expect.arrayContaining(["Removed: Buy if below $415.14", "Removed: Stop watching if below $392 · only on the close", "Stop set: $401.20"]));
  });

  it("a price you change in Edit & Approve is your sale: Sell if below $398, yours (You set this), not the analyst's reason for another price", async () => {
    const db = await approve({ edits: { stopLoss: 398 } });
    expect(salesOf(db)).toEqual([expect.objectContaining({ predicate: { watch: "price", is: "below", value: 398 }, source: "PRINCIPAL", rationale: "Sell if below $398. You set this." })]);
    expect(triggersOf(db).some((t) => t.id === LINE)).toBe(false);
  });

  it("the rest of the stock's lines are left as they were", async () => {
    const db = await approve();
    const kept = fx.thesis.triggers.filter((t) => t.id !== BUY && t.id !== LINE).map((t) => t.id);
    expect(triggersOf(db).map((t) => t.id)).toEqual(expect.arrayContaining(kept));
  });

  it("a promoted stock's fill takes its buy and Stop watching lines off too, and it is a holding", async () => {
    const db = await approve({ status: "PROMOTED" });
    expect(thesisOf(db)).toMatchObject({ status: "HOLDING", promotedAt: null });
    expect(triggersOf(db).filter((t) => t.action === "STOP_WATCHING" || t.action === "ENTER")).toEqual([]);
    expect(salesOf(db)).toEqual([expect.objectContaining({ predicate: { watch: "price", is: "below", value: SALE }, rationale: REASON })]);
  });
});

/**
 * The fill writes the approved sale and nothing else (2026-11-19): the
 * playbook's other holding triggers are put on by the run after the fill,
 * tailored to the stock (lib/proposals/after-buy.ts). WST is a Compounder,
 * whose playbook lists "Review 60 days after the buy", "Add if above 7% from
 * our entry" and "Review every 30 days" for a holding; none is stamped here.
 */
describe("WST's fill writes the approved sale, and no playbook trigger", () => {
  const added = (db: PrismaDouble, before: Array<{ id: string }>) =>
    triggersOf(db).filter((t) => !before.some((b) => b.id === t.id)).map((t) => sentenceOf(t)).sort();
  const watchOnly = migrated.filter((t) => t.id === BUY || t.id === LINE);

  it("as stored: the sale goes on, the stock's own clock and review stay, and nothing is added from the playbook", async () => {
    const db = await approve();
    expect(added(db, migrated)).toEqual(["Sell if below $401.20"]);
    expect(activity(db).filter((l) => /^Kept|^Added|playbook/.test(l))).toEqual([]);
  });

  it("a watch with only its buy and Stop watching line: the sale and nothing else", async () => {
    const db = await approve({ triggers: watchOnly });
    expect(added(db, watchOnly)).toEqual(["Sell if below $401.20"]);
    expect(triggersOf(db).filter((t) => t.source === "DEFAULT")).toEqual([]);
  });

  it("the fill reads no playbook: one it can't read changes nothing, and a holding with no playbook is the same", async () => {
    const owners = { COMPOUNDER_ACCUMULATION: [{ action: "REVIEW", predicate: { watch: "repeat", value: 14 }, rationale: "Every two weeks.", writtenOn: "FILL" }] };
    const unread = await approve({ triggers: watchOnly, account: { playbooks: owners, playbooksSeededAt: new Date("2026-11-17T00:00:00Z") }, playbookReadFails: true });
    expect(added(unread, watchOnly)).toEqual(["Sell if below $401.20"]);
    expect(activity(unread)).not.toContain("The playbook couldn't be read, so none of its triggers were written");
    const none = await approve({ triggers: watchOnly, setupId: null });
    expect(added(none, watchOnly)).toEqual(["Sell if below $401.20"]);
  });
});

it("the fixture is small", () => {
  expect(statSync(FIXTURE).size).toBeLessThan(8 * 1024);
});
