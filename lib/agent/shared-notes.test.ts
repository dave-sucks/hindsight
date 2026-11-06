/**
 * shared-notes.test.ts: a note written once and read on every stock it
 * covers (the Portfolio Manager Plan, step 2), with the morning of Mon
 * 2026-11-02 as the case: a note pinned on the five holdings the vote hit,
 * until the day after it. The note is the one the plan page shows; the
 * Activity rows are made up.
 */
import { stockContextFor } from "./stock-context-for";
import { coversStock, isPinned, noteLine, runNotes, type SharedNoteRow } from "./shared-notes";
import { listsTheStock, situationsFor, SITUATIONS, type SituationSources } from "./situations";
import { wantsAnswer, isAgentAnswer } from "./stock-context";

const NOV2 = new Date("2026-11-02T13:01:00Z");
const note = (over: Partial<SharedNoteRow> = {}): SharedNoteRow => ({
  id: "note_vote",
  author: "PORTFOLIO_MANAGER",
  runId: "run_pm",
  body: "Tomorrow's vote puts data-center opposition on the ballot. These five ride that story.",
  audience: "STOCKS",
  analystId: null,
  sector: null,
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
    expect(text).toContain("Portfolio manager's note to MU, GEV, NVDA, PLTR, CEG, about 2026-11-03, pinned until 11-04");
    expect(text).toContain("$MU is one of 5 holdings in this note, 41% of the account.");
    // Above the newest lines, not among them.
    expect(text.indexOf("PINNED ON")).toBeLessThan(text.indexOf("WHAT'S BEEN SAID ON $MU"));
    expect(text.split("WHAT'S BEEN SAID")[1]).not.toContain("Portfolio manager's note");
    expect(ctx.pinnedNote).toEqual({ id: "note_vote", at: note().createdAt });
  });

  it("puts the stock on the list until a run writes on it, then clears for that stock only", () => {
    const sources = (pinnedNote: boolean): SituationSources => ({
      needs: [], triggers: [], status: "HOLDING", direction: "LONG", planSanity: null, actionability: null,
      progressToTarget: null, buyBlockedByFull: false, nameTheSetup: false, unansweredDecision: false, pinnedNote,
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
    expect(after.text).toContain("Portfolio manager's note to MU, GEV, NVDA, PLTR, CEG");
    expect(after.text).toContain("Tomorrow's vote puts data-center opposition on the ballot.");
    expect(after.unansweredDecision).toBeNull();
    const line = noteLine(note()) as Parameters<typeof wantsAnswer>[0];
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
  it("a note to a sector covers the stocks whose thesis is in it, whatever the case", () => {
    const n = note({ audience: "SECTOR", sector: "Utilities", tickers: [] });
    expect(coversStock(n, { ticker: "CEG", sector: "utilities" })).toBe(true);
    expect(coversStock(n, { ticker: "MU", sector: "Information Technology" })).toBe(false);
    expect(coversStock(n, { ticker: "MU" })).toBe(false);
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
