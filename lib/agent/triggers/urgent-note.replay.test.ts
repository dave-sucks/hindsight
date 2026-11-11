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

import { citedIn, fireUrgentNote, tradingDaysBefore, urgentNoteRule } from "./urgent-note";
import { accountSeedTriggers, ensureAccountStandingRules, urgentNoteStandingTriggers } from "./seed-account";
import { ACCOUNT_ONLY_ALONE, refusalOf } from "./condition/valid";
import { whenProblem } from "./condition/check";
import { sentenceOf, conditionProblem } from "./condition";
import { predicateInputSchema } from "./schema";
import type { Trigger } from "./types";
import { situationsFor, type SituationSources } from "@/lib/agent/situations";

const ACCOUNT = "34f5c589-e216-4afe-9ee8-613c13f300e7";
const PEAD = "cmnhxpjio000004jvox6kl6c7";
const SECULAR = "cmmqxola3000004lbj7c11bfn";
const AT = new Date("2026-11-10T12:40:00Z"); // 7:40 AM ET
const RULE = { ...urgentNoteStandingTriggers()[0], id: "acct-urgent" } as Trigger;
/** The LIVE book's analysts, as the theses' runs name them. */
const inLive = (analystId: string) => ({ agentConfigId: analystId, agentConfig: { name: "Analyst", setupIds: [], accountId: ACCOUNT, tradingEnvironment: "LIVE" } });

function book(account: Trigger[] = [RULE], extra: Record<string, unknown[]> = {}): PrismaDouble {
  return prismaDouble({
    account: [accountRow({ id: ACCOUNT, triggers: account, triggersSeededAt: new Date("2026-11-10T12:30:00Z") })],
    agentConfig: [agentConfigRow({ id: PEAD, accountId: ACCOUNT, triggers: [] }), agentConfigRow({ id: SECULAR, accountId: ACCOUNT, triggers: [] })],
    thesis: [
      thesisRow({ id: "t_nvda", ticker: "NVDA", status: "HOLDING", userId: REPLAY_USER_ID, analystId: PEAD, horizon: "TARGET", triggers: [], researchRun: inLive(PEAD) }),
      thesisRow({ id: "t_mu", ticker: "MU", status: "HOLDING", userId: REPLAY_USER_ID, analystId: SECULAR, horizon: "COMPOUNDER", triggers: [], researchRun: inLive(SECULAR) }),
    ],
    ...extra,
  });
}
const NOTE = {
  id: "note_urgent", userId: REPLAY_USER_ID, tickers: ["NVDA", "MU", "AMD"], createdAt: AT,
  body: 'Export rule tightened overnight\nNVDA · urgent · condition 2 ("Exports to China cut off"): The rule names its top chip.\nMU · urgent · condition 1 ("HBM sales to China barred"): The rule names HBM.\nThe Commerce Department widened the rule. (Reuters, 2026-11-10)',
};

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
    // The deploy is the rule's migration finishing; nothing is added before it can be read.
    const DEPLOY = { urgentRuleSince: new Date("2026-11-10T15:00:00Z") };
    expect(await ensureAccountStandingRules(ACCOUNT, { urgentRuleSince: null })).toBe(0);
    expect(await ensureAccountStandingRules(ACCOUNT, DEPLOY)).toBe(1);
    const after = (db.store.account as Array<{ triggers: Trigger[] }>)[0].triggers;
    expect(after[0]).toEqual(kept);
    expect(after.slice(1).map((t) => sentenceOf(t))).toEqual(["Review if an urgent note names this stock"]);
    // Deleted after that: never added again.
    (db.store.account as Array<{ triggers: Trigger[] }>)[0].triggers = [kept];
    expect(await ensureAccountStandingRules(ACCOUNT, DEPLOY)).toBe(0);
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
    // It stands alone: never one of two conditions, in the form or in the save.
    const grouped = { match: "all", conditions: [{ watch: "note" }, { watch: "price", is: "below", value: 100 }] };
    expect(refusalOf(grouped)).toBe(ACCOUNT_ONLY_ALONE);
    expect(whenProblem(grouped as never, { level: "ACCOUNT", held: false })).toBe(ACCOUNT_ONLY_ALONE);
  });
});

describe("an urgent note naming NVDA, MU and AMD", () => {
  it("starts a run on each stock we hold, through the inherited rule, one per stock per day", async () => {
    db = book();
    const out = await fireUrgentNote(NOTE, AT);
    expect(out.map((o) => [o.ticker, o.outcome]).sort()).toEqual([["MU", "SENT"], ["NVDA", "SENT"]]);
    expect(sent.map((e) => [e.name, e.id, e.data.thesisId, e.data.triggerId, e.data.analystId, e.data.action]).sort()).toEqual([
      ["app/thesis.trigger.fired", "urgent-t_mu-2026-11-10", "t_mu", "acct-urgent", SECULAR, "REVIEW"],
      ["app/thesis.trigger.fired", "urgent-t_nvda-2026-11-10", "t_nvda", "acct-urgent", PEAD, "REVIEW"],
    ]);
    // The fire's line names the note and its title; the note's text reaches the run once, in its notes block.
    expect(sent[0].data.firedContext).toBe("Urgent note [note note_urgent]: Export rule tightened overnight");
  });

  it("skips a stock whose last urgent note cited the same condition and was answered within 5 trading days", async () => {
    const earlier = {
      id: "note_fri", userId: REPLAY_USER_ID, author: "MARKET_REVIEWER", audience: "STOCKS", tickers: ["NVDA", "MU"], levels: { NVDA: "URGENT", MU: "URGENT" },
      body: 'Export rule proposed\nNVDA · urgent · condition 2 ("Exports to China cut off"): Proposed.\nMU · urgent · condition 3 ("Guidance cut"): Another line.',
      createdAt: new Date("2026-11-06T12:40:00Z"), runId: "run_fri", analystId: null, eventDate: null, pinnedUntil: null,
    };
    const answer = { id: "u_nvda", thesisId: "t_nvda", type: "REVIEWED", runId: "run_trigger", timestamp: new Date("2026-11-06T14:00:00Z") };
    const answerMu = { id: "u_mu", thesisId: "t_mu", type: "REVIEWED", runId: "run_trigger", timestamp: new Date("2026-11-06T14:00:00Z") };
    db = book([RULE], { sharedNote: [earlier], thesisUpdate: [answer, answerMu] });
    const out = await fireUrgentNote(NOTE, AT);
    // NVDA: condition 2 again, answered Friday. MU: a different condition this time, so it runs.
    expect(out.map((o) => [o.ticker, o.outcome]).sort()).toEqual([["MU", "SENT"], ["NVDA", "REPEAT"]]);
    expect(sent.map((e) => e.data.ticker)).toEqual(["MU"]);
  });

  it("a condition rewritten since, or a note from the other book, is not a repeat", async () => {
    const earlier = (body: string, runId = "run_fri") => ({
      id: "note_fri", userId: REPLAY_USER_ID, author: "MARKET_REVIEWER", audience: "STOCKS", tickers: ["NVDA"], levels: { NVDA: "URGENT" },
      body, createdAt: new Date("2026-11-06T12:40:00Z"), runId, analystId: null, eventDate: null, pinnedUntil: null,
    });
    const answer = { id: "u_nvda", thesisId: "t_nvda", type: "REVIEWED", runId: "run_trigger", timestamp: new Date("2026-11-06T14:00:00Z") };
    // Same number, other words: the thesis's condition 2 was rewritten since.
    db = book([RULE], { sharedNote: [earlier('Export rule proposed\nNVDA · urgent · condition 2 ("Exports to China capped"): Proposed.')], thesisUpdate: [answer] });
    expect((await fireUrgentNote(NOTE, AT)).find((o) => o.ticker === "NVDA")?.outcome).toBe("SENT");
    // The same line, but from the PAPER book's run: not this book's urgent note.
    sent.length = 0;
    db = book([RULE], {
      sharedNote: [earlier('Export rule proposed\nNVDA · urgent · condition 2 ("Exports to China cut off"): Proposed.', "run_paper")],
      researchRun: [{ id: "run_paper", accountId: ACCOUNT, environment: "PAPER", mode: "MARKET_REVIEWER", startedAt: new Date("2026-11-06T12:30:00Z") }],
      thesisUpdate: [answer],
    });
    expect((await fireUrgentNote({ ...NOTE, accountId: ACCOUNT, environment: "LIVE" }, AT)).find((o) => o.ticker === "NVDA")?.outcome).toBe("SENT");
  });

  it("fires only in the note's book", async () => {
    db = book();
    expect(await fireUrgentNote({ ...NOTE, accountId: ACCOUNT, environment: "PAPER" }, AT)).toEqual([]);
    expect(sent).toEqual([]);
    expect((await fireUrgentNote({ ...NOTE, accountId: ACCOUNT, environment: "LIVE" }, AT)).map((o) => o.outcome)).toEqual(["SENT", "SENT"]);
  });

  it("reads what a stock's line cites, and counts back trading days", () => {
    // The line's number and the words the note quoted from the thesis.
    expect(citedIn(NOTE.body, "nvda")).toBe('condition 2 ("Exports to China cut off")');
    expect(citedIn(NOTE.body, "AMD")).toBeNull();
    // Five trading days before Tue Nov 10: Tue Nov 3 (Nov 7 and 8 are a weekend).
    expect(tradingDaysBefore(AT, 5).toISOString()).toBe("2026-11-03T05:00:00.000Z");
  });

  it("skips a stock a run has written on since the note", async () => {
    db = book([RULE], { thesisUpdate: [{ id: "u1", thesisId: "t_mu", type: "REVIEWED", runId: "run_morning", timestamp: new Date(AT.getTime() + 60_000) }] });
    const out = await fireUrgentNote(NOTE, AT);
    expect(out.find((o) => o.ticker === "MU")?.outcome).toBe("ANSWERED");
    expect(sent.map((e) => e.data.ticker)).toEqual(["NVDA"]);
  });

  it("set to Flag for Review, writes the fire down for the next run instead", async () => {
    db = book([{ ...RULE, fireMode: "NEXT_MORNING" }]);
    const out = await fireUrgentNote(NOTE, AT);
    expect(out.every((o) => o.outcome === "FLAGGED")).toBe(true);
    expect(sent).toEqual([]);
    expect((db.store.thesisUpdate as Array<{ type: string; triggerId: string }>).map((u) => [u.type, u.triggerId])).toEqual([
      ["TRIGGER_FIRED", "acct-urgent"],
      ["TRIGGER_FIRED", "acct-urgent"],
    ]);
  });

  it("does nothing once the owner has deleted the rule", async () => {
    db = book([]);
    expect((await fireUrgentNote(NOTE, AT)).map((o) => o.outcome)).toEqual(["NO_RULE", "NO_RULE"]);
    expect(sent).toEqual([]);
  });
});
