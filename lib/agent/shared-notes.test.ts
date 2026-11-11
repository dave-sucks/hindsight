/**
 * shared-notes.test.ts: a note written once and read on every stock it
 * covers, with the morning of Mon 2026-11-02 as the case: the Market
 * Reviewer's note on the five holdings the next day's vote hit, to review on
 * MU, GEV and CEG and for context on NVDA and PLTR. A run on a stock reads up
 * to 3 notes naming it above its newest 8 Activity lines: the one it must
 * answer first, then the newest since its last run line. The note is the one
 * the plan page shows; the levels and the Activity rows are made up.
 */
import { stockContextFor } from "./stock-context-for";
import { coversStock, inStockActivity, isPinned, levelFor, newestEightForRuns, noteLine, notesForRun, runNotes, type SharedNoteRow } from "./shared-notes";
import { activityFeed } from "@/lib/thesis/activity-feed";
import { titleSegments } from "@/components/agent/sheets/thesis-timeline-utils";
import { listsTheStock, situationsFor, SITUATIONS, type SituationSources } from "./situations";
import { wantsAnswer, isAgentAnswer } from "./stock-context";

const NOV2 = new Date("2026-11-02T13:01:00Z");
const LEVELS = { MU: "REVIEW", GEV: "REVIEW", CEG: "REVIEW", NVDA: "CONTEXT", PLTR: "CONTEXT" };
const note = (over: Partial<SharedNoteRow> = {}): SharedNoteRow => ({
  id: "note_vote",
  author: "MARKET_REVIEWER",
  runId: "run_mr",
  body: "Tomorrow's vote puts data-center opposition on the ballot. These five ride that story.",
  audience: "STOCKS",
  analystId: null,
  tickers: ["MU", "GEV", "NVDA", "PLTR", "CEG"],
  eventDate: "2026-11-03",
  levels: LEVELS,
  pinnedUntil: null,
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
const hours = (h: number) => new Date(NOV2.getTime() - h * 3_600_000);

describe("the Market Reviewer's note on the five, the morning before the vote", () => {
  it("MU's run reads it above the Activity lines, with its author, MU's level and the share of the account it covers", () => {
    const ctx = stockContextFor({ ticker: "MU", rows: MU_ROWS, notes: [note()], shares: SHARES, now: NOV2 });
    const text = ctx.text ?? "";
    expect(text.startsWith("NOTES ON $MU, read before its Activity lines: the one waiting for an answer first, then the newest since its last run line:")).toBe(true);
    expect(text).toContain("Market Reviewer to MU, GEV, NVDA, PLTR, CEG, about 2026-11-03 · to review");
    expect(text).toContain("$MU is one of 5 holdings in this note, 41% of the account.");
    // Above the newest lines, not among them.
    expect(text.indexOf("NOTES ON")).toBeLessThan(text.indexOf("WHAT'S BEEN SAID ON $MU"));
    expect(text.split("WHAT'S BEEN SAID")[1]).not.toContain("Market Reviewer");
    expect(ctx.pinnedNote).toEqual({ id: "note_vote", at: note().createdAt });
  });

  it("each stock reads its own level: NVDA reads the same note for context, and nothing puts it on the list", () => {
    const nvda = stockContextFor({ ticker: "NVDA", rows: MU_ROWS, notes: [note()], now: NOV2 });
    expect(nvda.text).toContain("Market Reviewer to MU, GEV, NVDA, PLTR, CEG, about 2026-11-03 —");
    expect(nvda.text).not.toContain("· to review");
    expect(nvda.pinnedNote).toBeNull();
    expect(levelFor(note(), "nvda")).toBe("CONTEXT");
    expect(levelFor(note(), "GEV")).toBe("REVIEW");
    // A stock the levels leave out, and a note with none, read as context.
    expect(levelFor(note({ levels: {} }), "MU")).toBe("CONTEXT");
    expect(levelFor(note({ levels: null }), "MU")).toBe("CONTEXT");
  });

  it("puts the stock on the list until a run writes on it; then the note is an ordinary Activity line on that stock only", () => {
    const sources = (pinnedNote: boolean): SituationSources => ({
      needs: [], triggers: [], status: "HOLDING", direction: "LONG", planSanity: null, actionability: null,
      progressToTarget: null, buyBlockedByFull: false, nameTheSetup: false, unansweredDecision: false, pinnedNote,
    });
    expect(situationsFor(sources(true))).toEqual(["PINNED_NOTE"]);
    expect(listsTheStock(sources(true))).toBe(true);
    expect(listsTheStock(sources(false))).toBe(false);

    const answered = stockContextFor({ ticker: "MU", rows: [row("2026-11-02T13:20:00Z"), ...MU_ROWS], notes: [note()], shares: SHARES, now: NOV2 });
    expect(answered.pinnedNote ?? null).toBeNull();
    expect(answered.text).not.toContain("NOTES ON");
    expect(answered.text?.split("WHAT'S BEEN SAID")[1]).toContain("Market Reviewer to MU, GEV, NVDA, PLTR, CEG · to review");
    // GEV hasn't answered: still on its list.
    expect(stockContextFor({ ticker: "GEV", rows: MU_ROWS, notes: [note()], now: NOV2 }).pinnedNote).not.toBeNull();
  });

  it("an urgent note asks for an answer like one to review; a note on the waiting sale does not (it is on the proposal's card)", () => {
    expect(stockContextFor({ ticker: "MU", rows: MU_ROWS, notes: [note({ levels: { MU: "URGENT" } })], now: NOV2 }).pinnedNote).not.toBeNull();
    const sale = stockContextFor({ ticker: "MU", rows: MU_ROWS, notes: [note({ levels: { MU: "PROPOSAL" } })], now: NOV2 });
    expect(sale.pinnedNote).toBeNull();
    expect(sale.text).toContain("· on the waiting sale");
    // The owner's note pinned from the chat still asks, until its date.
    const pinned = note({ author: "OWNER", levels: {}, pinnedUntil: new Date("2026-11-05T04:59:00Z") });
    expect(stockContextFor({ ticker: "MU", rows: MU_ROWS, notes: [pinned], now: NOV2 }).pinnedNote).not.toBeNull();
  });

  it("reads the note it must answer first, then the newest since its last run line, 3 at most; the rest are Activity lines", () => {
    const review = note({ id: "n_review", createdAt: hours(10) });
    const context = [1, 2, 3].map((h) => note({ id: `n${h}`, levels: {}, createdAt: hours(h) }));
    const text = stockContextFor({ ticker: "MU", rows: MU_ROWS, notes: [...context, review], now: NOV2 }).text ?? "";
    const [block, activity] = text.split("WHAT'S BEEN SAID");
    expect(block.indexOf("[note n_review]")).toBeGreaterThan(-1);
    expect(block.indexOf("[note n_review]")).toBeLessThan(block.indexOf("[note n1]"));
    expect(block).toContain("[note n2]");
    expect(block).not.toContain("[note n3]");
    expect(activity).toContain("Market Reviewer to MU");
  });

  it("a note written before the stock's last run line is an Activity line, not in the block", () => {
    const old = note({ id: "n_old", levels: {}, createdAt: new Date("2026-10-29T12:00:00Z") });
    const fresh = note({ id: "n_fresh", levels: {}, createdAt: hours(1) });
    expect(notesForRun([fresh, old], "MU", MU_ROWS, NOV2).map((n) => n.id)).toEqual(["n_fresh"]);
    const text = stockContextFor({ ticker: "MU", rows: MU_ROWS, notes: [fresh, old], now: NOV2 }).text ?? "";
    expect(text.split("WHAT'S BEEN SAID")[0]).not.toContain("[note n_old]");
  });

  it("a stock outside the note reads nothing of it", () => {
    const v = stockContextFor({ ticker: "V", rows: MU_ROWS, notes: [note()], now: NOV2 });
    expect(v.text).not.toContain("NOTES ON");
    expect(v.pinnedNote).toBeUndefined();
  });

  it("a note line is never the owner's word or a run's answer", () => {
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
    const until = new Date("2026-11-09T04:59:00Z");
    const account = note({ id: "a", audience: "ACCOUNT", tickers: [], levels: {}, pinnedUntil: until });
    const mine = note({ id: "b", audience: "ANALYST", analystId: "secular", tickers: [], levels: {}, pinnedUntil: until });
    const theirs = note({ id: "c", audience: "ANALYST", analystId: "pead", tickers: [], levels: {}, pinnedUntil: until });
    const ended = note({ id: "d", audience: "ACCOUNT", tickers: [], levels: {}, pinnedUntil: new Date("2026-11-01T00:00:00Z") });
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
    const account = note({ audience: "ACCOUNT", tickers: [], levels: {} });
    expect(inStockActivity(account, mu)).toBe(true);
    expect(inStockActivity(account, { ...mu, createdAt: new Date("2026-11-03T13:00:00Z") })).toBe(false);
    expect(inStockActivity(account, { ...mu, endedAt: new Date("2026-10-20T20:00:00Z") })).toBe(false);
  });

  it("a note to an analyst is a line on that analyst's stocks only", () => {
    const toSecular = note({ audience: "ANALYST", analystId: "secular", tickers: [], levels: {} });
    expect(inStockActivity(toSecular, mu)).toBe(true);
    expect(inStockActivity(toSecular, { ...mu, analystId: "pead" })).toBe(false);
  });

  it("reads as who wrote it, to whom, and the stock's own level", () => {
    const title = (n: SharedNoteRow, ticker?: string) => titleSegments(activityFeed({ updates: [noteLine(n, ticker)], orders: [] })[0] as never);
    expect(title(note({ audience: "ACCOUNT", author: "OWNER", tickers: [], levels: {} }))).toMatchObject({ primary: "Your note", secondary: "to the whole account" });
    expect(title(note(), "MU")).toMatchObject({ primary: "Market Reviewer", secondary: "to MU, GEV, NVDA, PLTR, CEG · to review" });
    expect(title(note(), "NVDA")).toMatchObject({ primary: "Market Reviewer", secondary: "to MU, GEV, NVDA, PLTR, CEG" });
    expect(title(note({ author: "PORTFOLIO_REVIEWER", levels: { MU: "URGENT" }, tickers: ["MU"] }), "MU")).toMatchObject({ primary: "Portfolio Reviewer", secondary: "to MU · urgent" });
    expect(title(note({ levels: { MU: "PROPOSAL" }, tickers: ["MU"] }), "MU")).toMatchObject({ secondary: "to MU · on the waiting sale" });
  });

  it("the newest 8 mark skips the notes a run reads elsewhere: the account's, and the stock's block", () => {
    const lines = [
      noteLine(note({ id: "acct", audience: "ACCOUNT", tickers: [], levels: {}, createdAt: new Date("2026-11-02T12:50:00Z") }), "MU"),
      noteLine(note({ id: "n1", createdAt: new Date("2026-11-02T12:40:00Z") }), "MU"),
      noteLine(note({ id: "n2", createdAt: new Date("2026-11-02T12:35:00Z") }), "MU"),
      noteLine(note({ id: "n3", createdAt: new Date("2026-11-02T12:32:00Z") }), "MU"),
      noteLine(note({ id: "n4", createdAt: new Date("2026-11-02T12:31:00Z") }), "MU"),
      noteLine(note({ id: "old", createdAt: new Date("2026-10-15T12:00:00Z") }), "MU"),
      ...Array.from({ length: 10 }, (_, i) => row(`2026-11-01T1${i}:00:00Z`)),
    ];
    const feed = activityFeed({ updates: lines as never, orders: [] });
    const eight = newestEightForRuns(feed, "MU", now).map((i) => i.id);
    expect(eight).toHaveLength(8);
    expect(eight).not.toContain("note:acct");
    expect(["note:n1", "note:n2", "note:n3"].some((id) => eight.includes(id))).toBe(false);
    expect(eight[0]).toBe("note:n4");
  });
});
