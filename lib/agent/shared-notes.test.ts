/**
 * shared-notes.test.ts: a note written once and read on every stock it
 * covers (lib/agent/shared-notes.ts), with the morning of Mon
 * 2026-11-02 as the case: a note pinned on the five holdings the vote hit,
 * until the day after it. The note is the one the plan page shows; the
 * Activity rows are made up.
 */
import { stockContextFor } from "./stock-context-for";
import { coversStock, inStockActivity, isPinned, newestEightForRuns, noteLine, runNotes, type SharedNoteRow } from "./shared-notes";
import { activityFeed } from "@/lib/thesis/activity-feed";
import { titleSegments } from "@/components/agent/sheets/thesis-timeline-utils";
import { listsTheStock, situationsFor, SITUATIONS, type SituationSources } from "./situations";
import { wantsAnswer, isAgentAnswer } from "./stock-context";

const NOV2 = new Date("2026-11-02T13:01:00Z");
const note = (over: Partial<SharedNoteRow> = {}): SharedNoteRow => ({
  id: "note_vote",
  author: "MARKET_REVIEWER",
  runId: "run_pm",
  body: "Tomorrow's vote puts data-center opposition on the ballot. These five ride that story.",
  audience: "STOCKS",
  analystId: null,
  tickers: ["MU", "GEV", "NVDA", "PLTR", "CEG"],
  eventDate: "2026-11-03",
  pinnedUntil: new Date("2026-11-05T04:59:00Z"),
  createdAt: new Date("2026-11-02T12:30:00Z"),
  ...over,
});
const row = (at: string, over: Record<string, unknown> = {}) => ({
  id: `u_${at}`,
  type: "REVIEWED",
  timestamp: new Date(at),
  runId: "run_morning",
  summary: "Review",
  rationale: "Memory pricing holds into the January report.",
  ...over,
});
const MU_ROWS = [row("2026-10-30T13:00:00Z"), row("2026-10-28T13:00:00Z", { type: "UPDATED" })];
const SHARES = new Map([["note_vote", { holdings: ["MU", "GEV", "NVDA", "PLTR", "CEG"], share: 0.409 }]]);

describe("a pinned note on the five, the morning before the vote", () => {
  it("MU's run reads it above the Activity lines, with the share of the account it covers", () => {
    const ctx = stockContextFor({ ticker: "MU", rows: MU_ROWS, notes: [note()], shares: SHARES, now: NOV2 });
    const text = ctx.text ?? "";
    expect(text.startsWith("PINNED ON $MU")).toBe(true);
    expect(text).toContain("Agent note to MU, GEV, NVDA, PLTR, CEG, about 2026-11-03, pinned until 11-04");
    expect(text).toContain("$MU is one of 5 holdings in this note, 41% of the account.");
    // Above the newest lines, not among them.
    expect(text.indexOf("PINNED ON")).toBeLessThan(text.indexOf("WHAT'S BEEN SAID ON $MU"));
    expect(text.split("WHAT'S BEEN SAID")[1]).not.toContain("Agent note");
    expect(ctx.pinnedNote).toEqual({ id: "note_vote", at: note().createdAt });
  });

  it("puts the stock on the list until a run writes on it, then clears for that stock only", () => {
    const sources = (pinnedNote: boolean): SituationSources => ({
      needs: [], triggers: [], status: "HOLDING", direction: "LONG", actionability: null,
      progressToTarget: null, buyBlockedByFull: false, unansweredDecision: false, pinnedNote,
    });
    expect(situationsFor(sources(true))).toEqual(["PINNED_NOTE"]);
    expect(listsTheStock(sources(true))).toBe(true);
    expect(listsTheStock(sources(false))).toBe(false);

    const answered = stockContextFor({ ticker: "MU", rows: [row("2026-11-02T13:20:00Z"), ...MU_ROWS], notes: [note()], shares: SHARES, now: NOV2 });
    expect(answered.pinnedNote).toBeNull();
    expect(answered.text).toContain("PINNED ON $MU"); // still read until it ends
    // GEV hasn't answered: still on its list.
    expect(stockContextFor({ ticker: "GEV", rows: MU_ROWS, notes: [note()], now: NOV2 }).pinnedNote).not.toBeNull();
  });

  it("a stock outside the note reads nothing of it", () => {
    const v = stockContextFor({ ticker: "V", rows: MU_ROWS, notes: [note()], now: NOV2 });
    expect(v.text).not.toContain("PINNED");
    expect(v.pinnedNote).toBeUndefined();
  });

  it("once it ends it is an ordinary Activity line, and never the owner's word or a run's answer", () => {
    const after = stockContextFor({ ticker: "MU", rows: MU_ROWS, notes: [note()], now: new Date("2026-11-06T13:00:00Z") });
    expect(after.text).not.toContain("PINNED");
    expect(after.text).toContain("Agent note to MU, GEV, NVDA, PLTR, CEG");
    expect(after.text).toContain("Tomorrow's vote puts data-center opposition on the ballot.");
    expect(after.unansweredDecision).toBeNull();
    const line = noteLine(note(), "MU") as Parameters<typeof wantsAnswer>[0];
    expect(wantsAnswer(line)).toBe(false);
    expect(isAgentAnswer(line)).toBe(false);
  });

  it("the situation's text stays under the 2,200-character limit and names the rule on floors", () => {
    expect(SITUATIONS.PINNED_NOTE.guidance.length).toBeLessThan(2200);
    expect(SITUATIONS.PINNED_NOTE.guidance).toContain("only the principal lowers a floor");
  });
});

describe("who a note reaches", () => {
  const now = NOV2;
  it("a note to stocks covers the stocks it names, whatever the case they were written in", () => {
    expect(coversStock(note(), { ticker: "mu" })).toBe(true);
    expect(coversStock(note(), { ticker: "V" })).toBe(false);
  });

  it("a note to the account or an analyst is read once at the top of a run while it lasts, never on a stock", () => {
    const account = note({ id: "a", audience: "ACCOUNT", tickers: [] });
    const mine = note({ id: "b", audience: "ANALYST", analystId: "secular", tickers: [] });
    const theirs = note({ id: "c", audience: "ANALYST", analystId: "pead", tickers: [] });
    const ended = note({ id: "d", audience: "ACCOUNT", tickers: [], pinnedUntil: new Date("2026-11-01T00:00:00Z") });
    expect(runNotes([account, mine, theirs, ended], "secular", now).map((n) => n.id)).toEqual(["a", "b"]);
    expect(runNotes([account, mine, theirs, ended], null, now).map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(coversStock(account, { ticker: "MU" })).toBe(false);
    expect(isPinned(ended, now)).toBe(false);
  });
});

describe("the Activity tab", () => {
  const now = NOV2;
  const mu = { ticker: "MU", analystId: "secular", createdAt: new Date("2026-10-01T13:00:00Z"), endedAt: null };

  it("a note to the account is a line on every stock on the book when it was written, and on none that came later or had ended", () => {
    const account = note({ audience: "ACCOUNT", tickers: [] });
    expect(inStockActivity(account, mu)).toBe(true);
    expect(inStockActivity(account, { ...mu, createdAt: new Date("2026-11-03T13:00:00Z") })).toBe(false);
    expect(inStockActivity(account, { ...mu, endedAt: new Date("2026-10-20T20:00:00Z") })).toBe(false);
  });

  it("a note to an analyst is a line on that analyst's stocks only", () => {
    const toSecular = note({ audience: "ANALYST", analystId: "secular", tickers: [] });
    expect(inStockActivity(toSecular, mu)).toBe(true);
    expect(inStockActivity(toSecular, { ...mu, analystId: "pead" })).toBe(false);
  });

  it("reads as who wrote it and to whom", () => {
    const line = activityFeed({ updates: [noteLine(note({ audience: "ACCOUNT", author: "OWNER", tickers: [] }), "MU")], orders: [] })[0];
    expect(titleSegments(line as never)).toMatchObject({ primary: "Your note", secondary: "to the whole account" });
  });

  it("the newest 8 mark skips the notes a run reads elsewhere: the account's, and the stock's two newest pinned", () => {
    const lines = [
      noteLine(note({ id: "acct", audience: "ACCOUNT", tickers: [], createdAt: new Date("2026-11-02T12:50:00Z") }), "MU"),
      noteLine(note({ id: "pin1", createdAt: new Date("2026-11-02T12:40:00Z") }), "MU"),
      noteLine(note({ id: "pin2", createdAt: new Date("2026-11-02T12:35:00Z") }), "MU"),
      noteLine(note({ id: "pin3", createdAt: new Date("2026-11-02T12:32:00Z") }), "MU"),
      noteLine(note({ id: "old", pinnedUntil: new Date("2026-10-20T00:00:00Z"), createdAt: new Date("2026-10-15T12:00:00Z") }), "MU"),
      ...Array.from({ length: 10 }, (_, i) => row(`2026-11-0${1}T1${i}:00:00Z`)),
    ];
    const feed = activityFeed({ updates: lines as never, orders: [] });
    const eight = newestEightForRuns(feed, now).map((i) => i.id);
    expect(eight).toHaveLength(8);
    expect(eight).not.toContain("note:acct");
    expect(eight).not.toContain("note:pin1");
    expect(eight).not.toContain("note:pin2");
    expect(eight[0]).toBe("note:pin3");
  });
});
