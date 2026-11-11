/**
 * The Market Reviewer's inputs, read through the real loader on the shape of
 * the LIVE book at 7:30 AM ET on Mon Nov 9, 2026
 * (__fixtures__/market-reviewer-inputs-2026-11-09.json). The market data is
 * real and public (SPY's and each stock's chart-numbers rows, the closes of
 * QQQ and the 11 sector funds, Cboe's VIX and 10-year files, Finnhub's
 * calendar and headlines); the book is stand-ins in the shape production
 * holds: the positions, equity and cash, the theses' claims, the run lines,
 * the sales waiting and their notes, the digest and the analysts' lines. The
 * edges are doubled: the database, Alpaca, Finnhub and Cboe. So is
 * loadStockFacts (tested on its own), with NVDA's situation made up. The
 * Market Reviewer's own earlier notes are made up: none existed.
 */
import fixture from "@/lib/agent/__fixtures__/market-reviewer-inputs-2026-11-09.json";
import { prismaDouble, type PrismaDouble, type Row } from "@/lib/replay";
import type { SituationSources } from "@/lib/agent/situations";

let db: PrismaDouble;
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));
const Q = fixture.quotes as Record<string, { c: number; pc: number }>;
jest.mock("@/lib/market-data/live-quote", () => ({
  getLiveQuotes: jest.fn(async (symbols: string[]) =>
    Object.fromEntries(symbols.filter((s) => Q[s]).map((s) => [s, { quote: { c: Q[s].c, pc: Q[s].pc, dp: ((Q[s].c - Q[s].pc) / Q[s].pc) * 100, t: 1793998800 } }])),
  ),
}));
jest.mock("@/lib/alpaca", () => ({ getAccount: jest.fn(async () => fixture.account) }));
const finnhubCalls: string[] = [];
jest.mock("@/lib/agent/research-helpers", () => ({
  finnhub: jest.fn(async (path: string) => {
    finnhubCalls.push(path);
    const symbol = /symbol=([A-Z]+)/.exec(path)?.[1] ?? "";
    if (path.startsWith("/company-news")) return { data: (fixture.news as Record<string, unknown[]>)[symbol] ?? [] };
    return { data: { earningsCalendar: (fixture.earnings as Record<string, unknown[]>)[symbol] ?? [] } };
  }),
}));
// The facts every read uses: NVDA in "note to answer"; each stock's newest run line from the fixture.
const thesisOf = (t: string, status: string) => fixture.theses.find((x) => x.ticker === t && x.status === status)!.id;
const noteToAnswer: SituationSources = {
  needs: [], triggers: [], status: "HOLDING", direction: "LONG", planSanity: null, actionability: null,
  progressToTarget: null, buyBlockedByFull: false, nameTheSetup: false, unansweredDecision: false, pinnedNote: true,
};
jest.mock("@/lib/agent/stock-facts", () => ({
  loadStockFacts: jest.fn(async () => ({
    sources: new Map([[thesisOf("NVDA", "HOLDING"), noteToAnswer]]),
    load: { inputs: new Map(fixture.lastRunLines.map((l) => [l.thesisId, { activity: [{ id: `u_${l.thesisId}`, ...l, timestamp: new Date(l.timestamp) }] }])) },
  })),
}));

import { INPUTS, loadMarketReviewerInputs, renderInputs } from "./inputs";
import { forgetGauges } from "@/lib/market-data/load-market-numbers";

const ACCOUNT = fixture.accountId;
const NOW = new Date("2026-11-09T12:30:00Z"); // 7:30 AM ET
const BELIEF_CEG = "CEG compounds over two years as its contracted nuclear power comes online.";
const MU_ID = "cmv9nm3xo000o06l3om8r7ath";
// Made up: the Market Reviewer's note on MU and NVDA the Friday before, from its LIVE run, and one from a PAPER run, which is not this book's.
const OWN_RUNS = [
  { id: "run_mr_1106", accountId: ACCOUNT, environment: "LIVE", mode: "MARKET_REVIEWER", startedAt: new Date("2026-11-06T12:30:00Z") },
  { id: "run_mr_paper", accountId: ACCOUNT, environment: "PAPER", mode: "MARKET_REVIEWER", startedAt: new Date("2026-11-06T12:30:00Z") },
];
const PAPER_NOTE = {
  id: "note_mr_paper", userId: "user_owner", author: "MARKET_REVIEWER", runId: "run_mr_paper", audience: "STOCKS", analystId: null,
  tickers: ["MU"], levels: { MU: "URGENT" }, eventDate: null, pinnedUntil: null,
  body: "The PAPER book's note\nMU · urgent · condition 4: ...", createdAt: new Date("2026-11-06T12:42:00Z"),
};
const OWN_NOTE = {
  id: "note_mr_1106", userId: "user_owner", author: "MARKET_REVIEWER", runId: "run_mr_1106", audience: "STOCKS", analystId: null,
  tickers: ["MU", "NVDA"], levels: { MU: "REVIEW", NVDA: "CONTEXT" }, eventDate: null, pinnedUntil: null,
  body: "Taiwan fab labor dispute pauses a planned Micron fab\nMU · to review · assumption 1: ...", createdAt: new Date("2026-11-06T12:41:00Z"),
};

function seed(extra: { pending?: Array<{ symbol: string; intent: string; quantity: number }> } = {}): PrismaDouble {
  const analyst = (id: string) => {
    const a = fixture.analysts.find((x) => x.id === id);
    return { accountId: ACCOUNT, enabled: !!a, tradingEnvironment: "LIVE", setupIds: [] };
  };
  const snap = (closes: number[]) => ({ asOf: "2026-11-06", closes, high52w: Math.max(...closes), sma: { 20: null, 50: null, 150: null, 200: null } });
  return prismaDouble({
    tickerIndicators: [
      fixture.spySnapshot,
      ...Object.entries(fixture.closes).map(([ticker, closes]) => ({ ticker, asOf: "2026-11-06", snapshot: snap(closes) })),
    ],
    position: fixture.positions.map((p, i) => ({ id: `pos_${i}`, accountId: ACCOUNT, environment: "LIVE", status: "OPEN", ...p })),
    thesis: fixture.theses.map((t) => ({
      ...t,
      direction: "LONG", entryPrice: null, targetPrice: null, stopLoss: null, triggers: [], setupId: null, horizon: null,
      catalystDate: t.catalystDate ? new Date(t.catalystDate) : null,
      createdAt: new Date("2026-10-01T00:00:00Z"),
      researchRun: { agentConfigId: t.analystId, agentConfig: analyst(t.analystId) },
    })) as Row[],
    agentConfig: fixture.analysts.map((a, i) => ({ ...a, accountId: ACCOUNT, enabled: true, tradingEnvironment: "LIVE", createdAt: new Date(2026, 0, i + 1) })),
    order: (extra.pending ?? []).map((o, i) => ({ id: `ord_${i}`, status: "AWAITING_APPROVAL", ...o, position: { accountId: ACCOUNT, environment: "LIVE" } })),
    sharedNote: [OWN_NOTE, PAPER_NOTE],
    researchRun: OWN_RUNS,
    portfolioDigest: [{ id: "pd_1106", accountId: ACCOUNT, environment: "LIVE", date: new Date(`${fixture.portfolioDigest.date}T00:00:00Z`), narrative: fixture.portfolioDigest.narrative }],
  });
}

const cboe = jest.fn(async (url: string) => new Response(url.includes("TNX") ? fixture.tnxCsv : fixture.vixCsv, { status: 200 }));
beforeEach(() => {
  forgetGauges();
  finnhubCalls.length = 0;
  global.fetch = cboe as unknown as typeof fetch;
});

const load = () => loadMarketReviewerInputs({ accountId: ACCOUNT, environment: "LIVE", date: fixture.date, userId: "user_owner", creds: { apiKey: "k", apiSecret: "s", environment: "LIVE" } as never, now: NOW });

describe("the Market Reviewer's inputs, from the Nov 9 morning", () => {
  it("the market, through the Market and portfolio block's one loader: SPY and QQQ last session, SPY against its averages, the VIX and the 10-year, the sectors best to worst", async () => {
    db = seed();
    const { market } = await load();
    expect(market.session).toBe("2026-11-06");
    expect(market.spyPct).toBeCloseTo(0.31, 2);
    expect(market.qqqPct).toBeCloseTo(1.4, 1);
    expect(market.spyAverages).toMatchObject({ asOf: "2026-11-06" });
    expect(market.spyAverages!.vs50).toBeCloseTo(-3.97, 1);
    expect(market.vix).toEqual({ close: 25.64, prevClose: 28.18, asOf: "2026-11-06" });
    expect(market.tenYear).toEqual({ close: 4.859, prevClose: 4.837, asOf: "2026-11-06" });
    expect(market.sectors[0].name).toBe("Tech");
    expect(market.sectors[0].pct).toBeCloseTo(1.45, 2);
    expect(market.sectors).toHaveLength(11);
  });

  it("the book: holdings first by size, each with its analyst, share, moves, situations, belief, report and newest run line", async () => {
    db = seed();
    const { book } = await load();
    expect(book.rows.slice(0, 8).map((r) => [r.ticker, r.sharePct])).toEqual([
      ["MSFT", 11], ["V", 10.9], ["IOT", 10.6], ["CEG", 10.3], ["MU", 8.6], ["GEV", 8], ["PLTR", 6.6], ["NVDA", 5.8],
    ]);
    const ceg = book.rows.find((r) => r.ticker === "CEG")!;
    expect(ceg).toMatchObject({ held: true, analysts: ["Secular Compounder"], dayPct: 4.3, monthPct: -12.3, sinceEntryPct: -13.8, nextEarnings: { date: "2026-11-09", when: "before the open" } });
    expect(ceg.belief?.startsWith(BELIEF_CEG)).toBe(true);
    expect(book.rows.find((r) => r.ticker === "NVDA")?.situations).toEqual(["note to answer"]);
    expect(book.rows.find((r) => r.ticker === "MU")?.lastRunLine).toMatchObject({ date: "2026-11-06" });
    expect(book.rows.find((r) => r.ticker === "MU")?.lastRunLine?.text).toBe("Reviewed MU thesis — no changes: Micron rebounded today after a sharp drop, and I would not sell here.");
    // A date column reads as its own day.
    expect(book.rows.find((r) => r.ticker === "BBIO")?.catalystDate).toBe("2026-11-27");
    // Two analysts watch CRWD: one row naming both.
    expect(book.rows.find((r) => r.ticker === "CRWD")).toMatchObject({ held: false, analysts: ["PEAD Specialist", "Secular Compounder"], sharePct: null });
    expect(book.rows).toHaveLength(8 + 23);
    expect(book.cashPct).toBe(25.8);
  });

  it("each stock's written claim word for word, its headlines since the last review, and its own notes", async () => {
    db = seed();
    const mu = (await load()).book.rows.find((r) => r.ticker === "MU")!;
    const thesis = fixture.theses.find((t) => t.id === MU_ID)!;
    expect(mu.assumptions).toEqual(thesis.keyAssumptions);
    expect(mu.conditions).toEqual(thesis.invalidationConds);
    // Six headlines since Friday's 7:30, five read, newest first.
    expect(mu.headlines).toHaveLength(5);
    expect(mu.headlines[0]).toEqual({ title: "Micron: The Robotic Play Most Investors Are Missing", source: "SeekingAlpha", at: "Mon 7:13 AM", url: "https://example.com/news/mu-19" });
    // Its own note from the LIVE book's run; the PAPER run's note is not this book's.
    expect(mu.ownNotes).toEqual([{ date: "2026-11-06", level: "REVIEW", title: "Taiwan fab labor dispute pauses a planned Micron fab" }]);
    expect(finnhubCalls.filter((c) => c.startsWith("/company-news?symbol=MU&from=2026-11-06&to=2026-11-09"))).toHaveLength(1);
  });

  it("a sale waiting is on its stock's row with the analyst's note", async () => {
    db = seed({ pending: fixture.pendingOrders });
    const { book } = await load();
    expect(book.rows.find((r) => r.ticker === "NVDA")?.pending).toMatchObject({ what: "a sale of 30 shares", at: "2026-11-10" });
    expect(book.rows.find((r) => r.ticker === "MU")?.pending?.gist).toBe("Micron is down again today, and I would hold rather than sell; the sale waits for you.");
    expect(book.rows.find((r) => r.ticker === "CEG")?.pending).toBeNull();
  });

  it("the analysts, by id, with their strategy in one line", async () => {
    db = seed();
    const { analysts } = await load();
    expect(analysts.map((a) => a.name)).toEqual(["PEAD Specialist", "Catalyst Event PM", "Secular Compounder"]);
    expect(analysts[0].strategy).toMatch(/^Buys clean beat-and-raise earnings prints/);
  });

  it("renders every input in order, each with its reason, as the agent reads it", async () => {
    db = seed({ pending: fixture.pendingOrders });
    const text = renderInputs(await load());
    expect([...text.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(INPUTS.map((i) => i.title));
    for (const i of INPUTS) expect(text).toContain(`Why: ${i.why}`);
    // The same lines the Market and portfolio block prints, as of 7:30 on Mon Nov 9.
    expect(text).toContain("S&P 500 (SPY) +0.31% on Fri Nov 6; 4.0% below its 50-day and 0.7% above its 200-day at the Fri Nov 6 close");
    expect(text).toContain("VIX 25.64 (28.18 the day before), 10-year yield 4.86% (4.84% the day before) at the Fri Nov 6 close");
    expect(text).toMatch(/Sectors on Fri Nov 6, best to worst: Tech \+1\.5% · /);
    expect(text).toContain("- Tue Nov 10: inflation report (CPI), 8:30 AM ET");
    expect(text).toContain("- CEG · held by Secular Compounder · 10.3% of the account ($9,998) · last session +4.3% · 30 days -12.3% · since our entry -13.8% · reports Mon Nov 9 before the open · thesis cmqb2ku1a000q04l6jtquuqr6");
    expect(text).toContain(`  Belief: ${BELIEF_CEG}`);
    expect(text).toContain("- NVDA · held by PEAD Specialist · 5.8% of the account");
    expect(text).toContain("  Today: note to answer");
    // MU's row, as the agent reads it: the claim numbered word for word, the sale waiting, the run line, the headlines, its own note.
    const mu = text.split("\n- MU · ")[1].split("\n- ")[0];
    expect(mu).toContain("  Key assumptions:\n    1. High-bandwidth memory stays sold out through next year, keeping gross margin high.");
    expect(mu).toContain("  What would prove it wrong:\n    1. Two quarters in a row of gross margin well below plan.");
    expect(mu).toContain("    4. A close below its 200-day average on heavy volume.");
    expect(mu).toContain(`  Waiting for approval: a sale of 12 shares, proposed Tue Nov 10. The analyst's note: "Micron is down again today, and I would hold rather than sell; the sale waits for you."`);
    expect(mu).toContain(`  Newest run line, Fri Nov 6: "Reviewed MU thesis — no changes: Micron rebounded today after a sharp drop, and I would not sell here."`);
    // Each headline with its link, so a fact from it can cite where it came from.
    expect(mu).toContain("  Headlines since the last review:\n    Mon 7:13 AM · SeekingAlpha: Micron: The Robotic Play Most Investors Are Missing https://example.com/news/mu-19");
    expect(mu).toContain("  Your notes on it, last 30 days:\n    Fri Nov 6 · to review: Taiwan fab labor dispute pauses a planned Micron fab");
    // A move that rounds to zero has no sign.
    expect(text).toContain("- BBIO · watched by Catalyst Event PM · last session 0.0% · 30 days +14.2% · catalyst Fri Nov 27");
    expect(text).toContain("- PEAD Specialist (id cmnhxpjio000004jvox6kl6c7): Buys clean beat-and-raise earnings prints");
    expect(text).toContain(fixture.portfolioDigest.narrative);
    // The live book of 31 stocks came to about 75,000 characters (some 19,000 tokens, cached across the run's steps), the written claims most of it; these stand-ins are shorter.
    expect(text.length).toBeLessThan(80_000);
  });

  it("asks a refused headline lookup again once the minute turns, and says so in the book when it is refused twice", async () => {
    db = seed();
    const research = jest.requireMock("@/lib/agent/research-helpers") as { finnhub: jest.Mock };
    const refused = new Map([["MU", 1], ["NVDA", 2]]);
    const usual = research.finnhub.getMockImplementation()!;
    research.finnhub.mockImplementation(async (path: string) => {
      const symbol = /symbol=([A-Z]+)/.exec(path)?.[1] ?? "";
      if (path.startsWith("/company-news")) {
        const left = refused.get(symbol) ?? 0;
        if (left > 0) return refused.set(symbol, left - 1), { data: null, error: "Finnhub /company-news rate limited (429) after 1 retries" };
        return { data: (fixture.news as Record<string, unknown[]>)[symbol] ?? [] };
      }
      return { data: { earningsCalendar: (fixture.earnings as Record<string, unknown[]>)[symbol] ?? [] } };
    });
    const f = await loadMarketReviewerInputs({ accountId: ACCOUNT, environment: "LIVE", date: fixture.date, userId: "user_owner", creds: { apiKey: "k", apiSecret: "s", environment: "LIVE" } as never, now: NOW, retryWaitMs: 0 });
    expect(f.book.rows.find((r) => r.ticker === "MU")?.headlines).toHaveLength(5);
    expect(f.missing.book).toBe("no headlines for NVDA");
    expect(renderInputs(f)).toContain("Could not read: no headlines for NVDA.");
    research.finnhub.mockImplementation(usual);
  });

  it("leaves out a market number it could not read, and still loads the rest", async () => {
    db = seed();
    global.fetch = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
    const f = await load();
    // The block's loader leaves out what it can't read: no VIX or 10-year line.
    expect(f.market.vix).toBeNull();
    const text = renderInputs(f);
    expect(text).not.toMatch(/VIX \d/);
    expect(f.book.rows.length).toBeGreaterThan(0);
  });
});
