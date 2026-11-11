/**
 * An urgent note starts a run now on each stock it names, through ONE
 * account rule every stock inherits: "Review if an urgent note names this
 * stock" (Send to Agent). Shaped on the LIVE book of Nov 10, 2026: NVDA held
 * by the PEAD Specialist and MU by the Secular Compounder, with the account's
 * rules as the seed writes them. Only the database and Inngest are doubled.
 */
import { prismaDouble, thesisRow, agentConfigRow, accountRow, REPLAY_USER_ID, type PrismaDouble } from "@/lib/replay";

let db: PrismaDouble;
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));
const sent: Array<{ id?: string; name: string; data: Record<string, unknown> }> = [];
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn(async (e: never) => void sent.push(e)) } }));

import { fireUrgentNote, urgentNoteRule } from "./urgent-note";
import { accountSeedTriggers, ensureAccountStandingRules, urgentNoteStandingTriggers } from "./seed-account";
import { sentenceOf, conditionProblem } from "./condition";
import { predicateInputSchema } from "./schema";
import type { Trigger } from "./types";
import { situationsFor, type SituationSources } from "@/lib/agent/situations";

const ACCOUNT = "34f5c589-e216-4afe-9ee8-613c13f300e7";
const PEAD = "cmnhxpjio000004jvox6kl6c7";
const SECULAR = "cmmqxola3000004lbj7c11bfn";
const AT = new Date("2026-11-10T12:40:00Z"); // 7:40 AM ET
const RULE = { ...urgentNoteStandingTriggers()[0], id: "acct-urgent" } as Trigger;

function book(account: Trigger[] = [RULE], extra: Record<string, unknown[]> = {}): PrismaDouble {
  return prismaDouble({
    account: [accountRow({ id: ACCOUNT, triggers: account, triggersSeededAt: new Date("2026-11-10T12:30:00Z") })],
    agentConfig: [agentConfigRow({ id: PEAD, accountId: ACCOUNT, triggers: [] }), agentConfigRow({ id: SECULAR, accountId: ACCOUNT, triggers: [] })],
    thesis: [
      thesisRow({ id: "t_nvda", ticker: "NVDA", status: "HOLDING", userId: REPLAY_USER_ID, analystId: PEAD, horizon: "TARGET", triggers: [] }),
      thesisRow({ id: "t_mu", ticker: "MU", status: "HOLDING", userId: REPLAY_USER_ID, analystId: SECULAR, horizon: "COMPOUNDER", triggers: [] }),
    ],
    ...extra,
  });
}
const NOTE = { id: "note_urgent", userId: REPLAY_USER_ID, tickers: ["NVDA", "MU", "AMD"], body: "Export rule tightened overnight.", createdAt: AT };

beforeEach(() => {
  sent.length = 0;
});

describe("the account rule", () => {
  it("reads as one sentence, on Send to Agent, in every new account's seed", () => {
    expect(sentenceOf(RULE)).toBe("Review if an urgent note names this stock");
    expect(RULE.fireMode).toBe("ASK_NOW");
    expect(accountSeedTriggers().filter((t) => urgentNoteRule([t])).map((t) => t.fireMode)).toEqual(["ASK_NOW"]);
  });

  it("is the one rule added to an account seeded before it: rules the owner deleted stay deleted", async () => {
    // Seeded Sep 18 like the LIVE book, and the owner has since deleted the earnings and filing wakes.
    const kept = { id: "acct-move", predicate: { watch: "move", is: "below", value: -20 }, action: "EXIT", fireMode: "ASK_NOW" } as unknown as Trigger;
    db = book([kept], {});
    (db.store.account as Array<Record<string, unknown>>)[0].triggersSeededAt = new Date("2026-09-18T00:00:00Z");
    expect(await ensureAccountStandingRules(ACCOUNT)).toBe(1);
    const after = (db.store.account as Array<{ triggers: Trigger[] }>)[0].triggers;
    expect(after[0]).toEqual(kept);
    expect(after.slice(1).map((t) => sentenceOf(t))).toEqual(["Review if an urgent note names this stock"]);
    // Deleted after that: never added again.
    (db.store.account as Array<{ triggers: Trigger[] }>)[0].triggers = [kept];
    expect(await ensureAccountStandingRules(ACCOUNT)).toBe(0);
    expect((db.store.account as Array<{ triggers: Trigger[] }>)[0].triggers).toEqual([kept]);
  });

  it("a fire of it puts the stock in \"note to answer\", never a review that came due", () => {
    const s: SituationSources = {
      needs: [{ kind: "TRIGGER_FIRED", triggerId: RULE.id, action: "REVIEW", summary: sentenceOf(RULE), firedAt: AT.toISOString() } as never],
      triggers: [RULE], status: "HOLDING", direction: "LONG", planSanity: null, actionability: null,
      progressToTarget: null, buyBlockedByFull: false, nameTheSetup: false, unansweredDecision: false, pinnedNote: false,
    };
    expect(situationsFor(s)).toEqual(["PINNED_NOTE"]);
  });

  it("is an account rule only: refused on a stock or an analyst, and not in what an agent can write", () => {
    expect(conditionProblem({ watch: "note" }, { level: "ACCOUNT", held: false })).toBeNull();
    expect(conditionProblem({ watch: "note" }, { level: "THESIS", held: true })).toMatch(/account rule/);
    expect(conditionProblem({ watch: "note" }, { level: "ANALYST", held: false })).toMatch(/account rule/);
    expect(predicateInputSchema().safeParse({ watch: "note" }).success).toBe(false);
  });
});

describe("an urgent note naming NVDA, MU and AMD", () => {
  it("starts a run on each stock we hold, through the inherited rule, once per note and stock", async () => {
    db = book();
    const out = await fireUrgentNote(NOTE);
    expect(out.map((o) => [o.ticker, o.outcome]).sort()).toEqual([["MU", "SENT"], ["NVDA", "SENT"]]);
    expect(sent.map((e) => [e.name, e.id, e.data.thesisId, e.data.triggerId, e.data.analystId, e.data.action]).sort()).toEqual([
      ["app/thesis.trigger.fired", "urgent-note-note_urgent-t_mu", "t_mu", "acct-urgent", SECULAR, "REVIEW"],
      ["app/thesis.trigger.fired", "urgent-note-note_urgent-t_nvda", "t_nvda", "acct-urgent", PEAD, "REVIEW"],
    ]);
    expect(String(sent[0].data.firedContext)).toContain("Export rule tightened overnight.");
  });

  it("skips a stock a run has written on since the note", async () => {
    db = book([RULE], { thesisUpdate: [{ id: "u1", thesisId: "t_mu", type: "REVIEWED", runId: "run_morning", timestamp: new Date(AT.getTime() + 60_000) }] });
    const out = await fireUrgentNote(NOTE);
    expect(out.find((o) => o.ticker === "MU")?.outcome).toBe("ANSWERED");
    expect(sent.map((e) => e.data.ticker)).toEqual(["NVDA"]);
  });

  it("set to Flag for Review, writes the fire down for the next run instead", async () => {
    db = book([{ ...RULE, fireMode: "NEXT_MORNING" }]);
    const out = await fireUrgentNote(NOTE);
    expect(out.every((o) => o.outcome === "FLAGGED")).toBe(true);
    expect(sent).toEqual([]);
    expect((db.store.thesisUpdate as Array<{ type: string; triggerId: string }>).map((u) => [u.type, u.triggerId])).toEqual([
      ["TRIGGER_FIRED", "acct-urgent"],
      ["TRIGGER_FIRED", "acct-urgent"],
    ]);
  });

  it("does nothing once the owner has deleted the rule", async () => {
    db = book([]);
    expect((await fireUrgentNote(NOTE)).map((o) => o.outcome)).toEqual(["NO_RULE", "NO_RULE"]);
    expect(sent).toEqual([]);
  });
});
