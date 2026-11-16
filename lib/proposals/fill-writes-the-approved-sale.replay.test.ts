/**
 * At the fill, the watch's lines come off and the holding's sale goes on at
 * the approved price (2026-11-16): the buy and the Stop watching line are
 * removed, and "Sell if below $X" is written from the order's stop through
 * the FLOOR level op, with the analyst's reason as its note. A watch's line
 * never becomes the sale.
 *
 * WST, watched, as production stored it on 2026-11-16, its line as the
 * migration stores it; the approval of its 11-13 buy proposal ($415.14),
 * through the path every live buy takes (promoteThesisOnApproval →
 * armHeldLadderOnFill). Only the database is doubled; stop when buying is off,
 * so the sale is the one approved.
 */

import { statSync } from "fs";
import raw from "@/lib/agent/__fixtures__/wst-fill-2026-11-13.json";
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_ANALYST_ID, type PrismaDouble } from "@/lib/replay";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import type { Trigger } from "@/lib/agent/triggers/types";

let db: PrismaDouble;
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));

import { promoteThesisOnApproval } from "./thesis-flips";

const FIXTURE = "lib/agent/__fixtures__/wst-fill-2026-11-13.json";
const fx = raw as unknown as { thesis: Record<string, unknown> & { triggers: Array<Record<string, unknown> & { id: string; action: string; predicate: Record<string, unknown> }> }; proposal: { positionId: string; avgCost: number; stopLoss: number; targetPrice: number } };
const BUY = "1d09278f-b9cd-4601-97e1-e00c8e64a010";
const LINE = "b48ef278-106b-4da5-8f6a-f2013904eda1";
/** The proposal's sale: a price the trigger run named, not the watch's $392 line. */
const SALE = 401.2;
const REASON = "Under the post-earnings base at $402: below it the reclaim has failed.";

/** WST's row with its line as the migration stores it (STOP_WATCHING, on the close). */
const migrated = fx.thesis.triggers.map((t) => (t.id === LINE ? { ...t, action: "STOP_WATCHING", predicate: { ...t.predicate, settings: { close: true } } } : t));

async function approve(order: { stopLoss: number | null; stopReason?: string | null }) {
  db = prismaDouble({
    account: [accountRow({ autoStopOnBuy: false, setupOverrides: {} })],
    agentConfig: [agentConfigRow({ autoStopOnBuy: null, autoStopPct: null })],
    thesis: [thesisRow({ ...fx.thesis, triggers: migrated })],
    position: [positionRow({ id: fx.proposal.positionId, symbol: "WST", status: "PENDING_APPROVAL", avgCost: fx.proposal.avgCost, stopLoss: order.stopLoss, stopReason: order.stopReason ?? null })],
  });
  await promoteThesisOnApproval({
    analystId: REPLAY_ANALYST_ID,
    ticker: "WST",
    positionId: fx.proposal.positionId,
    entryPrice: fx.proposal.avgCost,
    targetPrice: null,
    stopLoss: order.stopLoss,
    stopReason: order.stopReason,
  });
}

const thesis = () => (db.store.thesis as Array<Record<string, unknown>>)[0];
const triggers = () => thesis().triggers as Trigger[];
const activity = () =>
  ((db.store.thesisUpdate as Array<{ fieldChanges: { triggerOps?: { to: Array<{ text: string }> } } }>)[0].fieldChanges.triggerOps?.to ?? []).map((o) => o.text);

describe("WST's buy approved: the watch's lines come off, the approved sale goes on", () => {
  it("before the fill it is a watch: a buy and a Stop watching line on the close", () => {
    const said = migrated.map((t) => sentenceOf(t as never));
    expect(said).toContain("Buy if below $415.14");
    expect(said).toContain("Stop watching if below $392 · only on the close");
  });

  it("approved as proposed: the buy and the Stop watching line come off; Sell if below $401.20 goes on, the analyst's, with its reason", async () => {
    await approve({ stopLoss: SALE, stopReason: REASON });
    expect(thesis()).toMatchObject({ status: "HOLDING", stopLoss: SALE });
    const ids = triggers().map((t) => t.id);
    expect(ids).not.toContain(BUY);
    expect(ids).not.toContain(LINE);
    expect(triggers().filter((t) => t.action === "STOP_WATCHING" || t.action === "ENTER")).toEqual([]);
    const sales = triggers().filter((t) => t.action === "EXIT");
    expect(sales).toEqual([expect.objectContaining({ predicate: { watch: "price", is: "below", value: SALE }, rationale: REASON, source: "AGENT" })]);
    expect(sentenceOf(sales[0])).toBe("Sell if below $401.20");
    expect(activity()).toEqual(expect.arrayContaining(["Removed: Buy if below $415.14", "Removed: Stop watching if below $392 · only on the close", "Stop set: $401.20"]));
  });

  it("the watch's $392 is not read: a sale you change in Edit & Approve to $398 is written at $398, with no reason written for another price", async () => {
    await approve({ stopLoss: 398, stopReason: null });
    const sales = triggers().filter((t) => t.action === "EXIT");
    expect(sales).toEqual([expect.objectContaining({ predicate: { watch: "price", is: "below", value: 398 } })]);
    expect(sales[0].rationale).not.toBe(REASON);
    expect(triggers().some((t) => t.id === LINE)).toBe(false);
  });

  it("the rest of the stock's lines are left as they were", async () => {
    await approve({ stopLoss: SALE, stopReason: REASON });
    const kept = fx.thesis.triggers.filter((t) => t.id !== BUY && t.id !== LINE).map((t) => t.id);
    expect(triggers().map((t) => t.id)).toEqual(expect.arrayContaining(kept));
  });

  it("the fixture is small", () => {
    expect(statSync(FIXTURE).size).toBeLessThan(8 * 1024);
  });
});
