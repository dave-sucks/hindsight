/**
 * horizon-rules.replay.test.ts — DAV-250 replayed from production rows
 * (__fixtures__/book-2026-09-13.json, verbatim).
 *
 * The motivating failure, as the data shows it: ASML is a compounder whose
 * seat says the only automatic sale is 25% off the high, and the seat even
 * carries that rule — but the fill stamped an 8% trail sell onto the thesis,
 * and a thesis rule beats the seat's. On main this resolves to an 8%
 * automatic sale; after the one-time move it resolves to 25%, and SRRK —
 * which only inherited its 8% — keeps it.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import book from "./__fixtures__/book-2026-09-13.json";
import { resolveThesisLadder } from "./load-levels";
import { planHorizonRules } from "./horizon-rules-migration";
import type { Trigger } from "./types";

const account = book.account as unknown as Trigger[];
const seat = book.secularCompounder as unknown as Trigger[];
const asml = { ...book.asml, triggers: book.asml.triggers as unknown as Trigger[] };
const srrk = { ...book.srrk, triggers: book.srrk.triggers as unknown as Trigger[] };

const trailSells = (row: { triggers: Trigger[]; horizon: string; direction: string }, analyst: Trigger[], acct: Trigger[]) =>
  resolveThesisLadder({ ...row, status: "HOLDING" }, { analyst, account: acct })
    .filter((t) => t.action === "EXIT" && t.predicate.kind === "TRAILING_FROM_HIGH")
    .map((t) => (t.predicate.kind === "TRAILING_FROM_HIGH" ? t.predicate.pct : null));

describe("ASML and SRRK, as they sit in production today", () => {
  it("today ASML — a compounder — carries an automatic 8% sale, overriding its seat's 25%", () => {
    expect(trailSells(asml, seat, account)).toEqual([8]);
  });

  const plan = planHorizonRules({
    account,
    held: [
      { id: "asml", ticker: "ASML", ...asml, analystRules: seat },
      { id: "srrk", ticker: "SRRK", ...srrk, analystRules: [] },
    ],
    loosen: ["ASML", "CEG", "WST"],
    mintId: () => "new",
  });
  const after = (id: string, row: typeof asml) => ({ ...row, triggers: plan.theses.find((c) => c.thesisId === id)?.nextTriggers ?? row.triggers });

  it("after the move ASML's only automatic trail sale is 25%", () => {
    expect(trailSells(after("asml", asml), seat, plan.account!.next)).toEqual([25]);
  });

  it("after the move SRRK still sells on an 8% give-back — copied onto the stock, not lost", () => {
    expect(trailSells(srrk, [], account)).toEqual([8]);
    expect(trailSells(after("srrk", srrk), [], plan.account!.next)).toEqual([8]);
  });

  it("every other protective sell on both stocks is unchanged (the hard stops)", () => {
    for (const [id, row, analyst] of [["asml", asml, seat], ["srrk", srrk, []]] as const) {
      const stops = (r: typeof asml, a: Trigger[]) =>
        resolveThesisLadder({ ...r, status: "HOLDING" }, { analyst: analyst as Trigger[], account: a })
          .filter((t) => t.action === "EXIT" && t.predicate.kind === "PRICE_BELOW")
          .map((t) => t.id);
      expect(stops(after(id, row), plan.account!.next)).toEqual(stops(row, account));
    }
  });
});
