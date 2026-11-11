/**
 * The Market Reviewer's run, end to end, with the model behind a fake fetch:
 * the requests the SDK really sends to OpenAI (its five tools, its
 * instructions, its inputs), the tool calls coming back, and what the run
 * leaves behind (the run row, its saved thread, a note and the digest row),
 * and the urgent note's run, started once the brief is saved.
 * No live call is made. The inputs are built from the Nov 9 morning's
 * production rows (__fixtures__/market-reviewer-inputs-2026-11-09.json).
 */
import { createOpenAI } from "@ai-sdk/openai";
import fixture from "@/lib/agent/__fixtures__/market-reviewer-inputs-2026-11-09.json";
import { prismaDouble, thesisRow, accountRow, agentConfigRow, type PrismaDouble } from "@/lib/replay";

let db: PrismaDouble;
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));
// Each event sent, with whether the digest row was saved by then.
const events: Array<{ id?: string; digestSaved: boolean }> = [];
jest.mock("@/lib/inngest/client", () => ({
  inngest: { createFunction: jest.fn(() => ({})), send: jest.fn(async (e: { id?: string }) => void events.push({ id: e.id, digestSaved: (db.store.marketDigest ?? []).length > 0 })) },
}));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: jest.fn(async () => null) }));

import { MODES } from "@/lib/agent/modes";
import { lastCloses } from "@/lib/market-data/market-gauges";
import { marketNumbersFrom } from "@/lib/market-data/market-numbers";
import { calendarGaps, scheduledMarketDates } from "@/lib/market-data/market-calendar";
import { bookRows, LOOK_AHEAD_DAYS, portfolioDigestInput, renderInputs, type MarketReviewerFacts } from "./inputs";
import { forceBriefAtTheEnd, runMarketReviewer, startUrgentRuns } from "./run";
import { writeMarketBrief } from "@/lib/agent/tools/write-market-brief";
import { urgentNoteStandingTriggers } from "@/lib/agent/triggers/seed-account";
import { latestMarketBrief } from "@/lib/agent/market-digest-slot";

const ACCOUNT = fixture.accountId;
const OWNER = "34f5c589-owner";
const Q = Object.fromEntries(Object.entries(fixture.quotes).map(([t, q]) => [t, { c: q.c, dp: ((q.c - q.pc) / q.pc) * 100 }]));

const facts: MarketReviewerFacts = {
  date: fixture.date,
  environment: "LIVE",
  market: marketNumbersFrom(
    {
      quotes: Object.fromEntries(Object.entries(Q).map(([t, q]) => [t, { quote: { dp: q.dp, t: 1793998800 } }])),
      spy: fixture.spySnapshot.snapshot as never,
      gauges: { vix: lastCloses(fixture.vixCsv), tenYear: (({ close, prevClose, asOf }) => ({ close: close / 10, prevClose: prevClose != null ? prevClose / 10 : null, asOf }))(lastCloses(fixture.tnxCsv)!) },
    },
    new Date("2026-11-09T12:30:00Z"),
  ),
  marketDates: { days: LOOK_AHEAD_DAYS, dates: scheduledMarketDates(fixture.date, LOOK_AHEAD_DAYS), gaps: calendarGaps(fixture.date, LOOK_AHEAD_DAYS) },
  earnings: { days: LOOK_AHEAD_DAYS, rows: [], checked: 31, notChecked: 0 },
  book: bookRows({
    positions: fixture.positions,
    theses: fixture.theses,
    analystNames: new Map(fixture.analysts.map((a) => [a.id, a.name])),
    quotes: Q,
    closes: new Map(Object.entries(fixture.closes)),
    pending: [],
    earnings: [],
    equity: Number(fixture.account.equity),
    cash: Number(fixture.account.cash),
  }),
  analysts: fixture.analysts.map((a) => ({ id: a.id, name: a.name, strategy: a.description })),
  portfolioDigest: portfolioDigestInput(fixture.portfolioDigest),
  missing: {},
};

const SOURCE = { title: "Reuters", url: "https://www.reuters.com/markets/us/example-tech-rebound" };
const section = (text: string) => ({ text, sources: [SOURCE] });
const BRIEF =
  "Stocks bounced Friday after a sharp mid-week drop: the S&P 500 rose 0.3% but sits 4% under its 50-day average, and the VIX closed near 26. Technology led and staples lagged. Tomorrow's inflation report is the one market date in three weeks. For us, CEG reported a strong beat this morning; NVDA reports Nov 17.";
const NOTE = {
  title: "Chip stocks swing on export news",
  stocks: [{ ticker: "NVDA", level: "REVIEW", touches: "assumption 1", impact: "Most exposed: a wider rule would cut part of its data-center sales abroad." }],
  evidence: "Reports Friday said the export rule on advanced chips could widen.",
  source_title: SOURCE.title,
  source_url: SOURCE.url,
  source_date: "2026-11-06",
  meaning: "The belief rests on data-center demand; a wider rule would cut part of it.",
  check: "How much of this year's sales go to the regions named.",
};
const BRIEF_ARGS = {
  brief: BRIEF,
  sections: {
    market_overview: section("The S&P 500 rose 0.3% Friday after a sharp drop mid-week; it sits 4% under its 50-day average."),
    sector_developments: section("Technology led, up 1.45%; consumer staples fell 1.28%."),
    major_developments: section("Chip stocks swung on reports the export rule could widen."),
    portfolio_implications: section("CEG beat estimates this morning; NVDA reports Nov 17."),
    deserves_attention: section("NVDA's exposure to the export rule, flagged for its analyst."),
    upcoming_events: section("The inflation report is tomorrow at 8:30 AM ET; NVDA reports Nov 17 after the close."),
  },
};

/** One OpenAI Responses reply per request, in order; the request bodies are kept. */
/** One reply per request: an output item, or several (tool calls made in one step). */
function fakeOpenAI(replies: Array<Record<string, unknown> | Array<Record<string, unknown>>>) {
  const bodies: Array<Record<string, unknown>> = [];
  const provider = createOpenAI({
    apiKey: "test",
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      const output = replies[bodies.length - 1];
      if (!output) throw new Error(`no fake reply for request ${bodies.length}`);
      return new Response(
        JSON.stringify({ id: `resp_${bodies.length}`, created_at: 1762691400, model: "gpt-5.4", output: Array.isArray(output) ? output : [output], incomplete_details: null, usage: { input_tokens: 5200, output_tokens: 420 } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  return { model: provider(MODES["market-reviewer"].model), bodies };
}
const call = (n: number, name: string, args: unknown) => ({ type: "function_call", id: `fc_${n}`, call_id: `call_${n}`, name, arguments: JSON.stringify(args) });
const textOnly = { type: "message", role: "assistant", id: "msg_1", content: [{ type: "output_text", text: "I'll write the brief next.", annotations: [] }] };

const NVDA_ID = fixture.theses.find((t) => t.ticker === "NVDA")!.id;
/** A thesis in the LIVE book: the reviewer's notes and fires read only its book. */
const inLive = (analystId: string) => ({ agentConfigId: analystId, agentConfig: { name: "PEAD Specialist", setupIds: [], accountId: ACCOUNT, tradingEnvironment: "LIVE" } });
const PEAD = fixture.analysts.find((a) => a.name === "PEAD Specialist")!.id;
beforeEach(() => {
  events.length = 0;
  db = prismaDouble({
    accountMembership: [{ id: "m1", accountId: ACCOUNT, userId: OWNER, role: "OWNER" }],
    thesis: [thesisRow({ id: fixture.theses.find((t) => t.ticker === "NVDA")!.id, ticker: "NVDA", status: "HOLDING", userId: OWNER, researchRun: inLive(PEAD) })],
  });
});

describe("a Market Reviewer run", () => {
  it("sends its five tools, its instructions and its inputs, writes a note, then the brief and the digest, and ends", async () => {
    const fake = fakeOpenAI([call(1, "write_market_note", NOTE), call(2, "write_market_brief", BRIEF_ARGS)]);
    const out = await runMarketReviewer({ accountId: ACCOUNT, environment: "LIVE", date: fixture.date, model: fake.model, facts });

    expect(fake.bodies).toHaveLength(2);
    const body = fake.bodies[0];
    expect(body.model).toBe("gpt-5.4");
    expect(MODES["market-reviewer"].model).toBe(MODES["research-run"].model);
    expect((body.tools as Array<{ name: string }>).map((t) => t.name).sort()).toEqual(["get_stock_data", "get_theses", "web_search", "write_market_brief", "write_market_note"]);
    const sent = JSON.stringify(body.input);
    expect(sent).toContain("You are the Market Reviewer for this account");
    expect(sent).toContain(JSON.stringify(renderInputs(facts)).slice(1, -1));

    // The run: account-level, in /runs, finished.
    expect(out).toMatchObject({ status: "COMPLETE", written: true });
    const run = (db.store.researchRun as Array<Record<string, unknown>>)[0];
    expect(run).toMatchObject({ id: out.runId, mode: "MARKET_REVIEWER", agentConfigId: null, environment: "LIVE", status: "COMPLETE", userId: OWNER });
    expect((run.parameters as Record<string, unknown>).facts).toEqual(facts);

    // The note: the Market Reviewer's, to review, on NVDA.
    expect(db.store.sharedNote).toEqual([expect.objectContaining({ author: "MARKET_REVIEWER", audience: "STOCKS", tickers: ["NVDA"], levels: { NVDA: "REVIEW" }, runId: out.runId })]);
    // To review starts no run.
    expect(out.urgent).toEqual([]);
    expect(events).toEqual([]);

    // The brief and the digest, with its sources linked.
    const digest = (db.store.marketDigest as Array<Record<string, unknown>>)[0];
    expect(digest).toMatchObject({ accountId: ACCOUNT, environment: "LIVE", brief: BRIEF, model: "gpt-5.4", runId: out.runId, facts });
    expect(digest.date).toEqual(new Date("2026-11-09T00:00:00.000Z"));
    const narrative = String(digest.narrative);
    expect([...narrative.matchAll(/^### (.+)$/gm)].map((m) => m[1])).toEqual([
      "Market overview", "Sector developments", "Major developments", "Implications for your portfolio", "What deserves attention", "Upcoming events",
    ]);
    expect(narrative).toContain(`Sources: [Reuters](${SOURCE.url})`);

    // The thread the run page replays: the inputs first, then each call.
    const saved = (db.store.runMessage as Array<{ role: string; content: string }>).find((m) => m.role === "thread");
    const thread = JSON.parse(String(saved?.content)) as Array<{ role: string; content: unknown }>;
    expect(thread[0]).toEqual({ role: "user", content: [{ type: "text", text: renderInputs(facts) }] });
    expect(JSON.stringify(thread)).toContain("write_market_note");
    expect(JSON.stringify(thread)).toContain("write_market_brief");
    expect((run.parameters as { tokenUsage?: { input: number } }).tokenUsage?.input).toBe(10_400);
    // The call's requests are kept for the run page's chips (#948), beside the thread.
    expect((db.store.runMessage as Array<{ role: string }>).map((m) => m.role).sort()).toEqual(["request", "thread"]);

    // The Market and portfolio block's slot reads the brief, stamped with when it was written (#947).
    expect(await latestMarketBrief({ accountId: ACCOUNT, environment: "LIVE" })).toEqual({ date: "2026-11-09", brief: BRIEF, writtenAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    expect(await latestMarketBrief({ accountId: ACCOUNT, environment: "PAPER" })).toBeNull();
  });

  it("an urgent note starts its run once the brief is saved, through the account's rule", async () => {
    db = prismaDouble({
      accountMembership: [{ id: "m1", accountId: ACCOUNT, userId: OWNER, role: "OWNER" }],
      account: [accountRow({ id: ACCOUNT, triggers: [{ ...urgentNoteStandingTriggers()[0], id: "acct-urgent" }], triggersSeededAt: new Date("2026-11-10T00:00:00Z") })],
      agentConfig: [agentConfigRow({ id: PEAD, accountId: ACCOUNT, triggers: [] })],
      thesis: [thesisRow({ id: NVDA_ID, ticker: "NVDA", status: "HOLDING", userId: OWNER, analystId: PEAD, horizon: "TARGET", triggers: [], researchRun: inLive(PEAD) })],
    });
    const urgent = { ...NOTE, stocks: [{ ...NOTE.stocks[0], level: "URGENT", touches: "condition 2", impact: "The wider rule names its top chip: condition 2 says that ends the case." }] };
    const fake = fakeOpenAI([call(1, "write_market_note", urgent), call(2, "write_market_brief", BRIEF_ARGS)]);
    const out = await runMarketReviewer({ accountId: ACCOUNT, environment: "LIVE", date: fixture.date, model: fake.model, facts });
    expect(out).toMatchObject({ status: "COMPLETE", urgent: ["NVDA"] });
    // One run per stock per day, started once the digest row is saved.
    expect(events).toEqual([{ id: expect.stringMatching(new RegExp(`^urgent-${NVDA_ID}-\\d{4}-\\d{2}-\\d{2}$`)), digestSaved: true }]);
    expect((db.store.runEvent as Array<Record<string, unknown>>).map((e) => [e.type, e.title])).toContainEqual(["urgent_runs", "Urgent notes: NVDA: a run started"]);
  });

  it("four urgent notes in one step: three stocks are urgent and start runs, the fourth is refused with the reason", async () => {
    const held = ["NVDA", "MU", "AA", "BB"];
    db = prismaDouble({
      accountMembership: [{ id: "m1", accountId: ACCOUNT, userId: OWNER, role: "OWNER" }],
      account: [accountRow({ id: ACCOUNT, triggers: [{ ...urgentNoteStandingTriggers()[0], id: "acct-urgent" }], triggersSeededAt: new Date("2026-11-10T00:00:00Z") })],
      agentConfig: [agentConfigRow({ id: PEAD, accountId: ACCOUNT, triggers: [] })],
      thesis: held.map((t) => thesisRow({ id: `t_${t}`, ticker: t, status: "HOLDING", userId: OWNER, analystId: PEAD, horizon: "TARGET", triggers: [], researchRun: inLive(PEAD) })),
    });
    const urgentOn = (t: string) => ({ ...NOTE, title: `${t} hits its line`, stocks: [{ ticker: t, level: "URGENT", touches: "condition 1", impact: "It newly hits its first condition." }] });
    const fake = fakeOpenAI([held.map((t, i) => call(i + 1, "write_market_note", urgentOn(t))), call(5, "write_market_brief", BRIEF_ARGS)]);
    const out = await runMarketReviewer({ accountId: ACCOUNT, environment: "LIVE", date: fixture.date, model: fake.model, facts });
    // The request asks for one call at a time; a model that sends four anyway still gets three.
    expect(fake.bodies[0].parallel_tool_calls).toBe(false);
    expect((db.store.sharedNote as Array<{ tickers: string[] }>).map((n) => n.tickers[0])).toEqual(["NVDA", "MU", "AA"]);
    expect(JSON.stringify(fake.bodies[1].input)).toContain("3 is the most a run may, so BB can't be: mark it to review");
    expect(out.urgent).toEqual(["NVDA", "MU", "AA"]);
    expect(events).toHaveLength(3);
  });

  it("starts runs on 3 urgent stocks at most, oldest note first, and writes the rest down as over the cap", async () => {
    const held = ["NVDA", "MU", "AA", "BB"];
    const runId = "run_mr_cap";
    db = prismaDouble({
      account: [accountRow({ id: ACCOUNT, triggers: [{ ...urgentNoteStandingTriggers()[0], id: "acct-urgent" }], triggersSeededAt: new Date("2026-11-10T00:00:00Z") })],
      agentConfig: [agentConfigRow({ id: PEAD, accountId: ACCOUNT, triggers: [] })],
      thesis: held.map((t) => thesisRow({ id: `t_${t}`, ticker: t, status: "HOLDING", userId: OWNER, analystId: PEAD, horizon: "TARGET", triggers: [], researchRun: inLive(PEAD) })),
      // Written around the tool's own count (two in one step, say): the start holds the cap anyway.
      sharedNote: [
        { id: "n1", userId: OWNER, runId, author: "MARKET_REVIEWER", audience: "STOCKS", analystId: null, tickers: ["NVDA", "MU"], levels: { NVDA: "URGENT", MU: "URGENT" }, body: "First\nNVDA · urgent · condition 1: x\nMU · urgent · condition 1: x", eventDate: null, pinnedUntil: null, createdAt: new Date("2026-11-11T12:40:00Z") },
        { id: "n2", userId: OWNER, runId, author: "MARKET_REVIEWER", audience: "STOCKS", analystId: null, tickers: ["AA", "BB"], levels: { AA: "URGENT", BB: "URGENT" }, body: "Second\nAA · urgent · condition 1: x\nBB · urgent · condition 1: x", eventDate: null, pinnedUntil: null, createdAt: new Date("2026-11-11T12:41:00Z") },
      ],
    });
    expect(await startUrgentRuns(runId, OWNER, { accountId: ACCOUNT, environment: "LIVE" })).toEqual(["NVDA", "MU", "AA"]);
    expect(events).toHaveLength(3);
    expect((db.store.runEvent as Array<{ title: string }>)[0].title).toContain("BB: over the cap (3 urgent stocks a run), no run started");
  });

  it("the last two steps can only write the brief, so a run that spends its steps elsewhere still ends with one", async () => {
    const steps = MODES["market-reviewer"].maxSteps;
    expect(steps).toBe(25);
    // Twenty-three calls that write nothing (notes on stocks off the book), then the model is held to write_market_brief.
    const offBook = (i: number) => ({ ...NOTE, stocks: [{ ...NOTE.stocks[0], ticker: `ZZ${String.fromCharCode(65 + i)}` }] });
    const reads = Array.from({ length: steps - 2 }, (_, i) => call(i + 1, "write_market_note", offBook(i)));
    const fake = fakeOpenAI([...reads, call(steps - 1, "write_market_brief", BRIEF_ARGS)]);
    const out = await runMarketReviewer({ accountId: ACCOUNT, environment: "LIVE", date: fixture.date, model: fake.model, facts });
    expect(out).toMatchObject({ status: "COMPLETE", written: true });
    expect(fake.bodies).toHaveLength(steps - 1);
    expect(fake.bodies[steps - 3].tool_choice).toBe("auto");
    expect(fake.bodies[steps - 2].tool_choice).toEqual({ type: "function", name: "write_market_brief" });
    expect((fake.bodies[steps - 2].tools as Array<{ name: string }>).map((t) => t.name)).toEqual(["write_market_brief"]);
  });

  it("lets the model try again when its brief is too long, and ends once one is saved", async () => {
    // Past the 700 the brief keeps and inside the 1,400 the wire allows, so the tool refuses it with the overage.
    const tooLong = { ...BRIEF_ARGS, brief: `${BRIEF} ${BRIEF} ${BRIEF.slice(0, 300)}` };
    expect(tooLong.brief.length).toBeGreaterThan(700);
    expect(tooLong.brief.length).toBeLessThan(1400);
    const fake = fakeOpenAI([call(1, "write_market_brief", tooLong), call(2, "write_market_brief", BRIEF_ARGS)]);
    const out = await runMarketReviewer({ accountId: ACCOUNT, environment: "LIVE", date: fixture.date, model: fake.model, facts });
    expect(fake.bodies).toHaveLength(2);
    expect(JSON.stringify(fake.bodies[1].input)).toContain("call_1");
    expect(JSON.stringify(fake.bodies[1].input)).toMatch(/Nothing saved: the brief is \d+ characters, 700 at most \(cut \d+\)/);
    expect(out).toMatchObject({ status: "COMPLETE", written: true });
    expect((db.store.marketDigest as Array<{ brief: string }>).map((d) => d.brief)).toEqual([BRIEF]);
  });

  it("fails, and says so, when the model stops without writing the brief", async () => {
    const fake = fakeOpenAI([textOnly]);
    const out = await runMarketReviewer({ accountId: ACCOUNT, environment: "LIVE", date: fixture.date, model: fake.model, facts });
    expect(out).toMatchObject({ status: "FAILED", written: false });
    expect(db.store.marketDigest).toEqual([]);
    expect((db.store.runEvent as Array<Record<string, unknown>>)[0]).toMatchObject({ type: "run_failed", title: "The Market Reviewer ended without writing the brief" });
  });

  it("writes nothing for an account with no owner", async () => {
    db = prismaDouble({});
    const fake = fakeOpenAI([call(1, "write_market_brief", BRIEF_ARGS)]);
    expect(await runMarketReviewer({ accountId: ACCOUNT, environment: "LIVE", date: fixture.date, model: fake.model, facts })).toMatchObject({ status: "SKIPPED", runId: null });
    expect(fake.bodies).toHaveLength(0);
  });
});

describe("forceBriefAtTheEnd", () => {
  const saved = [{ toolResults: [{ toolName: "write_market_brief", output: { ok: true, data: { digestId: "digest_1" } } }] }];
  const refused = [{ toolResults: [{ toolName: "write_market_brief", output: { ok: true, data: { items: [] } } }] }];
  it("holds the last two steps to the brief, until one is saved", () => {
    expect(forceBriefAtTheEnd({ steps: [], stepNumber: 22 })).toBeUndefined();
    expect(forceBriefAtTheEnd({ steps: [], stepNumber: 23 })).toEqual({ toolChoice: { type: "tool", toolName: "write_market_brief" }, activeTools: ["write_market_brief"] });
    expect(forceBriefAtTheEnd({ steps: [], stepNumber: 24 })).toBeDefined();
    expect(forceBriefAtTheEnd({ steps: saved, stepNumber: 24 })).toBeUndefined();
    // A brief the tool refused (too long) is not a saved one: the last step still holds the model to it.
    expect(forceBriefAtTheEnd({ steps: refused, stepNumber: 24 })).toBeDefined();
  });
});

describe("write_market_brief", () => {
  it("refuses any run but the Market Reviewer's", async () => {
    db = prismaDouble({ researchRun: [{ id: "run_morning", mode: "MORNING_PLAN", accountId: ACCOUNT, environment: "LIVE", parameters: {} }] });
    const tool = writeMarketBrief({ runId: "run_morning", userId: OWNER, accountId: ACCOUNT, groupId: (p: string) => p } as never);
    const out = (await tool.execute!(BRIEF_ARGS as never, { toolCallId: "t1", messages: [] })) as { summary: string };
    expect(out.summary).toBe("Only the Market Reviewer writes the market brief; nothing saved.");
    expect(db.store.marketDigest).toEqual([]);
  });

  it("check only (the no-save run): reads no run row, saves nothing, and hands back the brief and the digest", async () => {
    db = prismaDouble({});
    const tool = writeMarketBrief({ runId: "no-save-1", userId: OWNER, accountId: ACCOUNT, dryRun: true, groupId: (p: string) => p } as never);
    const out = (await tool.execute!(BRIEF_ARGS as never, { toolCallId: "t1", messages: [] })) as { data: { dry_run: boolean; brief: string; narrative: string } };
    expect(out.data).toMatchObject({ dry_run: true, brief: BRIEF });
    expect(out.data.narrative).toContain("### Market overview");
    expect(db.store.marketDigest).toEqual([]);
    expect(db.calls).toEqual([]);
  });
});
