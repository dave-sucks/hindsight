/**
 * The agents read the research brief: get_stock_data carries the day's brief
 * and whole news summaries; the stock's row carries the brief's dated reason
 * for the move. Real tool entry points; the database and vendors doubled.
 */
import { replayTool, thesisRow, positionRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID, type Row } from "@/lib/replay";
import { rowForModel } from "@/lib/agent/row-for-model";
import { lastSessionsFrom } from "@/lib/market-hours";
import type { ResearchBriefPayload } from "@/lib/research/brief-types";

const READ = "Samsara fell with software on Oct 16, not on company news; Wall Street stays mostly bullish.";
const WHY = "Software names sold off on rate worries; the drop was sector-wide.";

function briefRow(createdAt: Date): Row {
  const payload: Partial<ResearchBriefPayload> = {
    version: 1, ticker: "IOT", company: "Samsara Inc.", kind: "PROPOSAL", builtAt: createdAt.toISOString(),
    whyItMoved: [{ text: WHY, date: "2026-10-16", sourceIds: [1] }],
    analystActions: [], targets: null, companyNews: [], fundamentals: [], social: null,
    ratings: { strongBuy: 4, buy: 6, hold: 4, sell: 0, strongSell: 0, period: "2026-10-01" },
    synthesis: READ,
    sources: [{ id: 1, url: "https://news.example.com/iot/sector-selloff", title: "sector selloff", date: "2026-10-16" }],
    failures: [{ part: "x", message: "no xAI key is configured (XAI_API_KEY)" }],
  };
  return { id: "brief_1", ticker: "IOT", kind: "PROPOSAL", orderId: "order_1", payload, sources: payload.sources, costs: {}, error: null, reusedFromId: null, createdAt };
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
  it("carries the day's brief, and up to six whole stories from the last three sessions", async () => {
    const now = new Date();
    const { result, refused } = await replayTool("get-stock-data", "getStockData", {
      seed: { researchBrief: [briefRow(new Date(now.getTime() - 60 * 60_000))] },
      args: { ticker: "IOT", include_technicals: false },
      ctx: { analystId: undefined },
      quotes: { IOT: 42.39 },
      mocks: { "@/lib/agent/research-helpers": finnhubWith(now) },
    });
    expect(refused).toBe(false);
    const data = result.data as { news: { summary: string; date: string }[]; researchBrief: { read: string; whyItMoved: { source: string }[]; failed: string[] } };
    const from = lastSessionsFrom(3, now);
    expect(data.news.length).toBeGreaterThan(0);
    expect(data.news.length).toBeLessThanOrEqual(6);
    expect(data.news.every((n) => n.date >= from)).toBe(true);
    expect(data.news.every((n) => n.summary.length > 120)).toBe(true);
    expect(data.researchBrief.read).toBe(READ);
    expect(data.researchBrief.whyItMoved[0].source).toBe("https://news.example.com/iot/sector-selloff");
    expect(data.researchBrief.failed).toEqual(["X search failed: no xAI key is configured (XAI_API_KEY)"]);
    expect(result.summary).toContain(`Research brief`);
    expect(result.summary).toContain(WHY);
  });

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
  it("get_theses puts the newest brief's dated reason on the row the model reads", async () => {
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
    expect(row.whyItMoved).toBe(`${WHY} (2026-10-16)`);
    expect((rowForModel(row, { named: false, size: "short" }) as Row).why_it_moved).toBe(`${WHY} (2026-10-16)`);
    expect(rowForModel(row, { named: false, size: "line" })).toContain(`moved: ${WHY} (2026-10-16)`);
  });
});
