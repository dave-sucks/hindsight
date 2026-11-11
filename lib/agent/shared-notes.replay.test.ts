/**
 * shared-notes.replay.test.ts: a shared note through the real entry points.
 * The owner writes one note to two stocks with write_note; get_theses then
 * reads it on both stocks. A note to the account is not on the read: every
 * agent gets it in its Market and portfolio block (market-and-portfolio.replay.test.ts).
 * Against the doubled database.
 */
import { replayTool, thesisRow, REPLAY_USER_ID } from "@/lib/replay";

const NOW = new Date("2026-11-02T13:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const FAKE: Parameters<typeof jest.useFakeTimers>[0] = {
  now: NOW,
  doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "hrtime", "performance"],
};
/** The shared notes the store holds after the call. */
const notesIn = async (db: unknown) => (await (db as { sharedNote: { findMany: (a: object) => Promise<unknown[]> } }).sharedNote.findMany({})) as Array<Record<string, unknown>>;

/** A watch with no view and a wake, quiet until something lists it. */
const watch = (id: string, ticker: string) =>
  thesisRow({
    id, ticker, status: "WATCHING", direction: null, horizon: "COMPOUNDER", setupId: null,
    coreBelief: null, keyAssumptions: [], invalidationConds: [], snapshot: null, bullCase: null, bearCase: null, scoring: null, conviction: null, convictionRationale: null,
    entryPrice: null, targetPrice: null, stopLoss: null, researchUpdatedAt: null, createdAt: ago(3), lastReviewedAt: null,
    triggers: [{ id: `wake_${ticker}`, action: "REVIEW", source: "AGENT", predicate: { watch: "price", is: "below", value: 1 }, rationale: "r", cooldownDays: 7 }],
  });

const sharedNote = (over: Record<string, unknown>) => ({
  id: "note_vote", userId: REPLAY_USER_ID, author: "MARKET_REVIEWER", runId: "run_mr", levels: { MU: "REVIEW", GEV: "REVIEW" },
  body: "Tomorrow's vote puts data-center opposition on the ballot.", audience: "STOCKS", analystId: null,
  tickers: ["MU", "GEV"], eventDate: "2026-11-03", pinnedUntil: new Date(NOW.getTime() + 2 * DAY), createdAt: ago(0.05),
  ...over,
});

describe("write_note to two stocks at once", () => {
  beforeAll(() => jest.useFakeTimers(FAKE));
  afterAll(() => jest.useRealTimers());

  it("saves one shared note, pinned, and says what it changed on save", async () => {
    const { result, db, crashed } = await replayTool("write-note", "writeNoteTool", {
      ctx: { runMode: "PRINCIPAL_CHAT", analystId: undefined },
      args: {
        text: "The vote is tomorrow and these two ride the data-center story. Size them for it.",
        tickers: ["mu", "GEV"],
        pinned_until: "2026-11-04",
        about_date: "Nov 3",
      },
    });
    expect(crashed).toBe(false);
    const rows = await notesIn(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ author: "OWNER", audience: "STOCKS", tickers: ["MU", "GEV"], eventDate: null });
    expect((result as { summary: string }).summary).toContain("Note written to $MU, $GEV, until 2026-11-04");
    expect((result as { summary: string }).summary).toContain('the date "Nov 3" was dropped (YYYY-MM-DD only)');
  });

  it("a note to the account with no end lasts a week", async () => {
    const { result, db } = await replayTool("write-note", "writeNoteTool", {
      ctx: { runMode: "PRINCIPAL_CHAT", analystId: undefined },
      args: { text: "Fed on Wednesday; nothing new on margin until after it.", whole_account: true },
    });
    const rows = (await notesIn(db)) as Array<{ audience: string; pinnedUntil: Date }>;
    expect(rows[0].audience).toBe("ACCOUNT");
    expect(rows[0].pinnedUntil.getTime()).toBe(NOW.getTime() + 7 * DAY);
    expect((result as { summary: string }).summary).toContain("Note written to every run, until 2026-11-09");
  });
});

describe("get_theses reads the notes", () => {
  beforeAll(() => jest.useFakeTimers(FAKE));
  afterAll(() => jest.useRealTimers());

  type Read = { data: { theses: Array<Record<string, unknown>>; quiet_theses?: Array<Record<string, unknown>>; notes?: string[] } };
  async function read(seed: Record<string, unknown[]>, runMode = "MORNING_PLAN") {
    const { result, crashed } = await replayTool("get-theses", "getTheses", {
      seed: { thesis: [watch("t_mu", "MU"), watch("t_gev", "GEV"), watch("t_v", "V")], ...seed } as never,
      args: { limit: 50 },
      ctx: { runMode },
      quotes: { MU: 850, GEV: 900, V: 420 },
    });
    if (crashed) throw new Error(`get_theses crashed: ${JSON.stringify(result).slice(0, 1500)}`);
    return (result as unknown as Read).data;
  }
  const listed = (d: Read["data"], id: string) => d.theses.find((t) => t.id === id);

  it("each covered stock is listed with the note pinned above its lines; the others stay quiet", async () => {
    const d = await read({ sharedNote: [sharedNote({})] });
    for (const id of ["t_mu", "t_gev"]) {
      const row = listed(d, id);
      expect(row?.situations).toEqual(["PINNED_NOTE"]);
      expect(String(row?.context)).toContain("Market Reviewer to MU, GEV, about 2026-11-03");
    }
    expect(listed(d, "t_v")).toBeUndefined();
    expect(d.notes).toBeUndefined();
  });

  it("each stock reads its own level: a note to review on MU and for context on GEV lists MU only", async () => {
    const d = await read({ sharedNote: [sharedNote({ levels: { MU: "REVIEW", GEV: "CONTEXT" }, pinnedUntil: null })] });
    expect(listed(d, "t_mu")?.situations).toEqual(["PINNED_NOTE"]);
    expect(listed(d, "t_gev")).toBeUndefined();
  });

  it("the Market Reviewer's read lists the same stocks, without the analysts' situation texts", async () => {
    const analyst = await read({ sharedNote: [sharedNote({})] });
    expect(Object.keys((analyst as { guidance?: object }).guidance ?? {})).toContain("PINNED_NOTE");
    const reviewer = await read({ sharedNote: [sharedNote({})] }, "MARKET_REVIEWER");
    expect(listed(reviewer, "t_mu")?.situations).toEqual(["PINNED_NOTE"]);
    expect((reviewer as { guidance?: object }).guidance).toBeUndefined();
  });

  it("a stock a run has written on since leaves the list", async () => {
    const answer = { id: "u_mu", thesisId: "t_mu", type: "REVIEWED", timestamp: ago(0.01), runId: "run_morning", summary: "Review", rationale: "Checked the vote against MU's case.", fieldChanges: {}, signalIds: [] };
    const d = await read({ sharedNote: [sharedNote({})], thesisUpdate: [answer] });
    expect(listed(d, "t_mu")).toBeUndefined();
    expect(listed(d, "t_gev")?.situations).toEqual(["PINNED_NOTE"]);
  });

  it("a note to the account is not on the read: the Market and portfolio block carries it, so it is sent once", async () => {
    const d = await read({ sharedNote: [sharedNote({ id: "note_fed", audience: "ACCOUNT", tickers: [], eventDate: "2026-12-09", body: "Fed decision Dec 9; the market prices a rise." })] });
    expect(d.notes).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain("Fed decision Dec 9");
    expect(d.theses).toHaveLength(0);
  });
});
