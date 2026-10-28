/**
 * The agents read the research brief: get_stock_data carries the day's brief
 * (its paragraph and links) and whole news summaries; the stock's row carries
 * the paragraph's first sentence. Real tool entry points; the database and vendors doubled.
 */
import { replayTool, thesisRow, positionRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID, type Row } from "@/lib/replay";
import { rowForModel } from "@/lib/agent/row-for-model";
import { lastSessionsFrom } from "@/lib/market-hours";
import type { ResearchBriefPayload } from "@/lib/research/brief-types";

const WHY = "Samsara fell 3% with the rest of software on Oct 16 after a rate scare; there was no news on the company itself.";
const READ = `${WHY} Sales grew 30% last quarter and the outlook was raised. Wall Street stays mostly bullish, with 10 buys and 4 holds.`;
const SOURCE = { id: 1, url: "https://news.example.com/iot/sector-selloff", title: "sector selloff", date: "2026-10-16" };

/** A brief as it is stored from 2026-10-28: the paragraph and its sources. */
function briefRow(createdAt: Date): Row {
  const payload: ResearchBriefPayload = {
    version: 2, ticker: "IOT", company: "Samsara Inc.", kind: "PROPOSAL", builtAt: createdAt.toISOString(), synthesis: READ, sources: [SOURCE],
  };
  return { id: "brief_1", ticker: "IOT", kind: "PROPOSAL", orderId: "order_1", payload, sources: payload.sources, costs: {}, error: null, reusedFromId: null, createdAt };
}

/** A brief stored before 2026-10-28, with its ~100 values: only its paragraph and sources are read. */
function oldBriefRow(createdAt: Date): Row {
  const row = briefRow(createdAt);
  const payload = { ...(row.payload as object), version: 1, whyItMoved: [{ text: "an old fact", date: "2026-10-16", sourceIds: [1] }], social: { status: "failed" }, failures: [{ part: "x", message: "no xAI key is configured (XAI_API_KEY)" }] };
  return { ...row, payload };
}

/** Finnhub's company news: eight stories over the last week, each summary well past 80 characters. */
function news(now: Date) {
  return Array.from({ length: 8 }, (_, i) => ({
    headline: `Story ${i}`,
    summary: `Story ${i} summary. ${"A full paragraph that runs well past eighty characters so a cut would show. ".repeat(2)}`,
    source: "example",
    url: `https://news.example.com/${i}`,
    datetime: Math.floor((now.getTime() - i * 86_400_000) / 1000),
  }));
}

const finnhubWith = (now: Date) => () => ({
  ...jest.requireActual("@/lib/agent/research-helpers"),
  finnhub: jest.fn(async (path: string) =>
    path.startsWith("/company-news") ? { data: news(now) }
    : path.startsWith("/stock/profile2") ? { data: { name: "Samsara Inc", finnhubIndustry: "Technology" } }
    : { data: null, error: "replay: no vendor" }),
});

describe("get_stock_data reads the brief and the whole news", () => {
  for (const [what, row] of [["today's brief", briefRow], ["a brief stored before the paragraph-only change", oldBriefRow]] as const) {
    it(`carries ${what} as its paragraph and links, and up to six whole stories from the last three sessions`, async () => {
      const now = new Date();
      const { result, refused } = await replayTool("get-stock-data", "getStockData", {
        seed: { researchBrief: [row(new Date(now.getTime() - 60 * 60_000))] },
        args: { ticker: "IOT", include_technicals: false },
        ctx: { analystId: undefined },
        quotes: { IOT: 42.39 },
        mocks: { "@/lib/agent/research-helpers": finnhubWith(now) },
      });
      expect(refused).toBe(false);
      const data = result.data as { news: { summary: string; date: string }[]; researchBrief: Record<string, unknown> };
      const from = lastSessionsFrom(3, now);
      expect(data.news.length).toBeGreaterThan(0);
      expect(data.news.length).toBeLessThanOrEqual(6);
      expect(data.news.every((n) => n.date >= from)).toBe(true);
      expect(data.news.every((n) => n.summary.length > 120)).toBe(true);
      expect(Object.keys(data.researchBrief).sort()).toEqual(["builtAt", "read", "sources"]);
      expect(data.researchBrief.read).toBe(READ);
      expect(data.researchBrief.sources).toEqual([{ title: SOURCE.title, date: SOURCE.date, url: SOURCE.url }]);
      expect(result.summary).toContain(`Research brief`);
      expect(result.summary).toContain(WHY);
      expect(JSON.stringify(result.data)).not.toContain("xAI");
    });
  }

  it("a brief older than a day is not today's brief, and the result says there is none", async () => {
    const now = new Date();
    const { result } = await replayTool("get-stock-data", "getStockData", {
      seed: { researchBrief: [briefRow(new Date(now.getTime() - 26 * 60 * 60_000))] },
      args: { ticker: "IOT", include_technicals: false },
      ctx: { analystId: undefined },
      quotes: { IOT: 42.39 },
      mocks: { "@/lib/agent/research-helpers": finnhubWith(now) },
    });
    expect((result.data as { researchBrief: unknown }).researchBrief).toBe("No research brief on this stock from the last 24 hours.");
  });
});

describe("the stock's row carries why it moved", () => {
  it("get_theses puts the newest brief's first sentence on the row the model reads", async () => {
    const now = new Date();
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: {
        agentConfig: [agentConfigRow({ name: "Replay Analyst", setupIds: [], triggers: [], enabled: true })],
        account: [accountRow({ triggers: [], triggersSeededAt: new Date("2026-09-18T12:00:00Z") })],
        thesis: [thesisRow({ id: "t_iot", ticker: "IOT", status: "HOLDING", analystId: REPLAY_ANALYST_ID })],
        position: [positionRow({ symbol: "IOT", analystId: REPLAY_ANALYST_ID, environment: "LIVE", quantity: 300, avgCost: 42.695 })],
        researchBrief: [briefRow(new Date(now.getTime() - 3 * 60 * 60_000))],
      },
      args: { tickers: ["IOT"] },
      ctx: { runEnvironment: "LIVE", runMode: "MORNING_PLAN" },
      quotes: { IOT: 40 },
    });
    const row = (result.data as { theses: Row[] }).theses.find((t) => t.ticker === "IOT")!;
    expect(row.whyItMoved).toBe(WHY);
    expect((rowForModel(row, { named: false, size: "short" }) as Row).why_it_moved).toBe(WHY);
    expect(rowForModel(row, { named: false, size: "line" })).toContain(`moved: ${WHY}`);
  });
});
