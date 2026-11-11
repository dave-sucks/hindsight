/**
 * write_market_note through its real entry point, against the doubled
 * database: the Market Reviewer's note to the stocks it names, each with its
 * own level, what it touches (the cited line quoted from the thesis) and how
 * much, and what it refuses. The notes and the theses' claims are made up; the
 * run that urgent notes start is in lib/agent/market-reviewer/run.test.ts and
 * lib/agent/triggers/urgent-note.replay.test.ts.
 */
import { replayTool, thesisRow, agentConfigRow, REPLAY_ACCOUNT_ID, type PrismaDouble } from "@/lib/replay";
import { firstWords, MARKET_NOTE_CHARS, NOTE_FIELD_CHARS } from "./market-note-fields";

/** A thesis in the replay's book (PAPER, its account): the tool reads only the run's book. */
const inBook = (over: Record<string, unknown>, environment = "PAPER") =>
  thesisRow({ ...over, researchRun: { agentConfigId: "analyst_replay", agentConfig: { name: "Replay Analyst", setupIds: [], accountId: REPLAY_ACCOUNT_ID, tradingEnvironment: environment } } });

const AT = new Date("2026-11-10T12:40:00Z"); // 7:40 AM ET

// Made-up claims, shaped like a held chip stock's and a held memory stock's.
const NVDA_CLAIM = {
  keyAssumptions: ["Data-center revenue keeps growing faster than the street expects through next year.", "Gross margin holds in the low-to-mid seventies."],
  invalidationConds: ["A close below the 200-day average on heavy volume.", "Guidance cut before the report, or a revenue guide below the street."],
};
const MU_CLAIM = {
  keyAssumptions: ["High-bandwidth memory stays sold out through next year.", "Long-term supply contracts hold with no large cancellations."],
  invalidationConds: ["Two quarters of gross margin below the low seventies."],
};

describe("write_market_note", () => {
  const FAKE: Parameters<typeof jest.useFakeTimers>[0] = {
    now: AT,
    doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "hrtime", "performance"],
  };
  beforeAll(() => jest.useFakeTimers(FAKE));
  afterAll(() => jest.useRealTimers());
  const ARGS = {
    title: "Chip export rule tightened",
    evidence: "The Commerce Department widened its export limits on advanced chips overnight.",
    source_title: "Reuters",
    source_url: "https://www.reuters.com/technology/example-export-rule",
    source_date: "2026-11-10",
    meaning: "Data-center demand abroad could slow for a quarter or two.",
    check: "How much of each company's sales go to the regions named.",
  };
  const BOOK = {
    thesis: [inBook({ id: "t_nvda", ticker: "NVDA", status: "HOLDING", ...NVDA_CLAIM }), inBook({ id: "t_mu", ticker: "MU", status: "HOLDING", ...MU_CLAIM })],
  };
  const SALE_ON = (symbol: string) => ({ ...BOOK, order: [{ id: `ord_${symbol}`, status: "AWAITING_APPROVAL", intent: "CLOSE", symbol, position: { accountId: REPLAY_ACCOUNT_ID, environment: "PAPER" } }] });
  const notesIn = (d: unknown) => (d as PrismaDouble).store.sharedNote as Array<Record<string, unknown>>;
  const summaryOf = (r: unknown) => (r as { summary: string }).summary;
  const write = (args: Record<string, unknown>, seed: Record<string, unknown> = BOOK, ctx: Record<string, unknown> = {}) =>
    replayTool("write-market-note", "writeMarketNote", { ctx: { runMode: "MARKET_REVIEWER", analystId: undefined, ...ctx }, seed: seed as never, args: { ...ARGS, ...args } });

  it("one note to the stocks it names, each with its own level, the line it cites quoted, and how much", async () => {
    const { result, db: out, crashed } = await write({
      stocks: [
        // Its own quote after the number is ignored: the note quotes the thesis's words.
        { ticker: "nvda", level: "REVIEW", touches: 'Assumption 1 "data center keeps growing"', impact: "Most exposed: about a fifth of its sales are in the regions named." },
        { ticker: "MU", level: "CONTEXT", touches: "nothing named", impact: "Less exposed: memory is outside the rule." },
        { ticker: "AMD", level: "REVIEW", touches: "a new risk", impact: "Not ours." },
      ],
    });
    expect(crashed).toBe(false);
    expect(notesIn(out)).toEqual([
      expect.objectContaining({ author: "MARKET_REVIEWER", audience: "STOCKS", tickers: ["NVDA", "MU"], levels: { NVDA: "REVIEW", MU: "CONTEXT" }, analystId: null }),
    ]);
    expect(String(notesIn(out)[0].body).split("\n")).toEqual([
      "Chip export rule tightened",
      'NVDA · to review · assumption 1 ("Data-center revenue keeps growing faster…"): Most exposed: about a fifth of its sales are in the regions named.',
      "MU · context · nothing named: Less exposed: memory is outside the rule.",
      "The Commerce Department widened its export limits on advanced chips overnight. (Reuters, 2026-11-10) https://www.reuters.com/technology/example-export-rule",
      "What it means: Data-center demand abroad could slow for a quarter or two.",
      "To check: How much of each company's sales go to the regions named.",
    ]);
    expect(summaryOf(result)).toMatch(/^Note written to \$NVDA · to review, \$MU \(.+\)\. Changed: not held or watched, left out: AMD\.$/);
  });

  it("a bill in Congress on a waiting sale: quoting the cited line shows what the claim says", async () => {
    // Cited as condition 2, the line reads as what it is: the claim's guidance cut, which a bill is not.
    const cited = await write(
      { title: "China chip bills added to the defense bill", stocks: [{ ticker: "NVDA", level: "REVIEW", touches: "condition 2", impact: "More pressure on the sale." }] },
      SALE_ON("NVDA"),
      { dryRun: true },
    );
    const citedBody = (cited.result as unknown as { data: { note: { body: string } } }).data.note.body;
    expect(citedBody).toContain('NVDA · on the waiting sale · condition 2 ("Guidance cut before the report, or a…"): More pressure on the sale.');
    // Neither of NVDA's lines names export rules: a new risk, on the waiting sale.
    const right = await write(
      { title: "China chip bills added to the defense bill", stocks: [{ ticker: "NVDA", level: "PROPOSAL", touches: "a new risk", impact: "Tighter China chip rules would cut a market for its chips; it bears on the sale waiting." }] },
      SALE_ON("NVDA"),
    );
    expect(String(notesIn(right.db)[0].body)).toContain("NVDA · on the waiting sale · a new risk: Tighter China chip rules would cut a market for its chips; it bears on the sale waiting.");
    expect(notesIn(right.db)[0].levels).toEqual({ NVDA: "PROPOSAL" });
  });

  it("a bill that moves toward a watch's numbered condition is REVIEW and cites that line (ASML, Nov 11)", async () => {
    // ASML's numbered lines, word for word from its thesis on Nov 11. That run called the bill "a new risk", "beyond what the watch thesis already names": condition 3 names it.
    const ASML = inBook({
      id: "t_asml",
      ticker: "ASML",
      status: "WATCHING",
      keyAssumptions: [
        "High-NA EUV adoption extends from Intel to TSMC and Samsung within 18–24 months, driving ASP mix toward €400M+ per unit and sustaining the gross margin expansion path to 56%+",
        "Global fab expansion (AI logic + HBM DRAM) keeps ASML backlog above €35B and 2027 near-fully-booked status, preventing any two-consecutive-quarter order-intake deterioration",
      ],
      invalidationConds: [
        "Two consecutive quarters of guidance cuts to either revenue or gross margin — as distinct from one-quarter timing slippage — signaling structural demand erosion rather than mix-shift",
        "High-NA EUV adoption timeline pushed beyond 2028 by TSMC or Samsung (public statement, capex plan, or confirmed order cancellation), collapsing the ASP step-up mechanism that justifies the 56%+ margin target",
        "Dutch or US export controls extended to cover all DUV immersion tools, reducing the ~130-unit 2026 DUV plan by more than 30% and permanently shrinking the China-addressable TAM",
      ],
    });
    const { result, db: out, crashed } = await write(
      {
        title: "Congress pushes tougher China chip curbs",
        stocks: [{ ticker: "ASML", level: "REVIEW", touches: "condition 3", impact: "Bills to curb chip-tool shipments to China move toward condition 3; nothing is law yet." }],
        evidence: "Reuters said bipartisan lawmakers are pushing bills to tighten advanced chip exports and press allies to restrict chip-making equipment shipments to China.",
        source_title: "Reuters: tighter China chip curbs gain momentum",
        source_url: "https://www.reuters.com/technology/artificial-intelligence/nvidia-drama-revives-chip-export-ban-debate-2026-11-11/",
        source_date: "2026-11-11",
        meaning: "The export-control risk ASML's thesis names moves closer; no rule has changed.",
        check: "Whether the defense bill keeps the equipment-control language.",
      },
      { thesis: [ASML] },
    );
    expect(crashed).toBe(false);
    expect(notesIn(out)[0]).toEqual(expect.objectContaining({ tickers: ["ASML"], levels: { ASML: "REVIEW" } }));
    expect(String(notesIn(out)[0].body).split("\n")[1]).toBe(
      `ASML · to review · condition 3 ("${firstWords("Dutch or US export controls extended to cover all DUV immersion tools, reducing the ~130-unit 2026 DUV plan by more than 30% and permanently shrinking the China-addressable TAM")}"): Bills to curb chip-tool shipments to China move toward condition 3; nothing is law yet.`,
    );
    expect(String(notesIn(out)[0].body)).toContain('condition 3 ("Dutch or US export controls extended');
    expect(summaryOf(result)).toMatch(/^Note written to \$ASML · to review /);
  });

  it("a two-stock note with every field at its limit passes in one call, inside the note's cap", async () => {
    const at = (n: number) => "w".repeat(n);
    const { result, db: out } = await write(
      {
        title: at(NOTE_FIELD_CHARS.title),
        evidence: at(NOTE_FIELD_CHARS.evidence),
        source_title: at(NOTE_FIELD_CHARS.source_title),
        meaning: at(NOTE_FIELD_CHARS.meaning),
        check: at(NOTE_FIELD_CHARS.check),
        stocks: [
          { ticker: "NVDA", level: "REVIEW", touches: "condition 2", impact: at(NOTE_FIELD_CHARS.impact) },
          { ticker: "MU", level: "REVIEW", touches: "assumption 2", impact: at(NOTE_FIELD_CHARS.impact) },
        ],
      },
      SALE_ON("MU"),
    );
    expect(summaryOf(result)).toMatch(/^Note written to/);
    const body = String(notesIn(out)[0].body);
    expect(body.replace(ARGS.source_url, "").trim().length).toBeLessThanOrEqual(MARKET_NOTE_CHARS);
  });

  it("refuses once, naming every field over its limit and by how much, and the line a stock doesn't have", async () => {
    const { result, db: out } = await write({
      evidence: "e".repeat(342),
      stocks: [
        { ticker: "NVDA", level: "REVIEW", touches: "condition 5", impact: "i".repeat(150) },
        { ticker: "MU", level: "CONTEXT", touches: "the sector", impact: "Fine." },
      ],
    });
    expect(summaryOf(result)).toBe(
      'Nothing written: NVDA\'s impact is 150 characters, 120 at most (cut 30); NVDA has 2 conditions, so "condition 5" isn\'t one; MU\'s touches is "the sector": say "condition N", "assumption N", "the catalyst", "a new risk" or "nothing named"; evidence is 342 characters, 300 at most (cut 42). Fix those and send it again.',
    );
    expect(notesIn(out)).toEqual([]);
  });

  it("keeps a date the note is about only when it is ahead; the news's own date is dropped and said back", async () => {
    const past = await write({ about_date: "2026-11-10", stocks: [{ ticker: "NVDA", level: "CONTEXT", touches: "nothing named", impact: "Context only." }] });
    expect(notesIn(past.db)[0].eventDate).toBeNull();
    expect(summaryOf(past.result)).toContain("about_date 2026-11-10 dropped: it is only a future date the note is about");
    const ahead = await write({ about_date: "2026-11-17", stocks: [{ ticker: "NVDA", level: "CONTEXT", touches: "nothing named", impact: "Context only." }] });
    expect(notesIn(ahead.db)[0].eventDate).toBe("2026-11-17");
  });

  it("urgent names what it hits: a held stock its numbered condition, a watched one a condition or the catalyst", async () => {
    const vague = await write({ stocks: [{ ticker: "NVDA", level: "URGENT", touches: "a new risk", impact: "A bill in Congress." }] });
    expect(summaryOf(vague.result)).toBe('Nothing written: NVDA is urgent, so its touches is the numbered condition it hits ("condition N"). Fix those and send it again.');
    expect(notesIn(vague.db)).toEqual([]);
    const assumption = await write({ stocks: [{ ticker: "NVDA", level: "URGENT", touches: "assumption 1", impact: "Growth slowed." }] });
    expect(summaryOf(assumption.result)).toMatch(/^Nothing written: NVDA is urgent/);
    const watch = { thesis: [inBook({ id: "t_bbio", ticker: "BBIO", status: "WATCHING", direction: null })] };
    const landed = await write({ stocks: [{ ticker: "BBIO", level: "URGENT", touches: "the catalyst", impact: "The FDA decision came out." }] }, watch);
    expect(summaryOf(landed.result)).toMatch(/A run starts on \$BBIO once the brief is saved\.$/);
  });

  it("marks at most 3 stocks urgent in a run, refusing the fourth with the reason", async () => {
    const four = { thesis: ["AA", "BB", "CC", "DD"].map((t) => inBook({ id: `t_${t}`, ticker: t, status: "HOLDING", ...NVDA_CLAIM })) };
    const urgent = (t: string) => ({ ticker: t, level: "URGENT", touches: "condition 1", impact: "It closed under the average on heavy volume." });
    const out = await write({ stocks: ["AA", "BB", "CC", "DD"].map(urgent) }, four);
    expect(summaryOf(out.result)).toBe("Nothing written: this run has marked no stock urgent and 3 is the most a run may, so DD can't be: mark it to review. Fix those and send it again.");
    expect(notesIn(out.db)).toEqual([]);
  });

  it("names at most 5 stocks, and refuses a note past the 2,000 characters a note keeps, with its overage", async () => {
    const six = { thesis: ["AA", "BB", "CC", "DD", "EE", "FF"].map((t) => inBook({ id: `t_${t}`, ticker: t, status: "HOLDING" })) };
    const line = (t: string) => ({ ticker: t, level: "CONTEXT", touches: "nothing named", impact: "w".repeat(NOTE_FIELD_CHARS.impact) });
    const many = await write({ stocks: ["AA", "BB", "CC", "DD", "EE", "FF"].map(line) }, six);
    expect(summaryOf(many.result)).toBe("Nothing written: the note names 6 stocks, 5 at most. Name the 5 it bears on most, or split it.");
    const at = (n: number) => "w".repeat(n);
    const long = await write(
      {
        title: at(NOTE_FIELD_CHARS.title), evidence: at(NOTE_FIELD_CHARS.evidence), source_title: at(NOTE_FIELD_CHARS.source_title),
        meaning: at(NOTE_FIELD_CHARS.meaning), check: at(NOTE_FIELD_CHARS.check), source_url: `https://example.com/${at(380)}`,
        stocks: ["AA", "BB", "CC", "DD", "EE"].map((t) => ({ ...line(t), touches: "condition 1" })),
      },
      six,
    );
    expect(summaryOf(long.result)).toMatch(/^Nothing written: the note is 2,\d{3} characters with its link, 2,000 at most \(cut \d+\)\. Name fewer stocks or shorten their lines\.$/);
    expect(notesIn(long.db)).toEqual([]);
  });

  it("reads only the run's book: a stock held in the other environment is left out", async () => {
    const live = { thesis: [inBook({ id: "t_nvda_live", ticker: "NVDA", status: "HOLDING", ...NVDA_CLAIM }, "LIVE")] };
    const out = await write({ stocks: [{ ticker: "NVDA", level: "CONTEXT", touches: "nothing named", impact: "Context." }] }, live);
    expect(summaryOf(out.result)).toBe("None of NVDA is held or watched — nothing written.");
  });

  it("an urgent stock is said back: its run starts once the brief is saved, not from the tool", async () => {
    const { result, db: out } = await write({ stocks: [{ ticker: "NVDA", level: "URGENT", touches: "condition 1", impact: "It closed under the average on twice the usual volume." }] });
    expect(summaryOf(result)).toMatch(/A run starts on \$NVDA once the brief is saved\.$/);
    expect((out as PrismaDouble).store.thesisUpdate).toEqual([]);
  });

  it("a stock with a sale waiting is the owner's to decide: a note asking for a look goes on the proposal; one about a sale with none is context", async () => {
    const { result, db: out } = await write(
      {
        stocks: [
          { ticker: "MU", level: "REVIEW", touches: "assumption 2", impact: "Argues against the sale: the contracts it names hold." },
          { ticker: "NVDA", level: "PROPOSAL", touches: "nothing named", impact: "No sale waits on it." },
        ],
      },
      SALE_ON("MU"),
    );
    expect(notesIn(out)[0].levels).toEqual({ MU: "PROPOSAL", NVDA: "CONTEXT" });
    expect(String(notesIn(out)[0].body)).toContain('MU · on the waiting sale · assumption 2 ("Long-term supply contracts hold with no…"): Argues against the sale');
    expect(summaryOf(result)).toContain("Changed: MU has a sale waiting, so the note goes on that proposal for the owner; NVDA has no sale waiting, so it is context.");
  });

  it("check only (the no-save run): every rule runs, nothing is saved, and the note comes back", async () => {
    const { result, db: out } = await write({ stocks: [{ ticker: "MU", level: "URGENT", touches: "condition 1", impact: "Argues for the sale." }] }, SALE_ON("MU"), { dryRun: true });
    expect(notesIn(out)).toEqual([]);
    const data = (result as unknown as { data: { dry_run: boolean; note: { levels: unknown; body: string } } }).data;
    expect(data.dry_run).toBe(true);
    expect(data.note.levels).toEqual({ MU: "PROPOSAL" });
    expect(data.note.body).toContain('MU · on the waiting sale · condition 1 ("Two quarters of gross margin below the…"): Argues for the sale.');
  });

  it("writes nothing to an analyst on another account, or to stocks none of which we hold or watch", async () => {
    const other = await write({ analyst_id: "an_other" }, { agentConfig: [agentConfigRow({ id: "an_other", accountId: "someone-else" })] });
    expect(summaryOf(other.result)).toBe("No analyst an_other on this account — nothing written.");
    const none = await write({ stocks: [{ ticker: "AMD", level: "CONTEXT", touches: "nothing named", impact: "Not ours." }] }, {});
    expect(summaryOf(none.result)).toBe("None of AMD is held or watched — nothing written.");
    expect(notesIn(none.db)).toEqual([]);
  });
});

describe("firstWords", () => {
  it("cuts a claim at a word, with no trailing punctuation", () => {
    expect(firstWords("Guidance cut before the report, or a revenue guide below the street.")).toBe("Guidance cut before the report, or a…");
    expect(firstWords("Short line.")).toBe("Short line.");
  });
});
