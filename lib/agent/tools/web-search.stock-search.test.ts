/**
 * web-search.stock-search.test.ts — the one news search per stock that every
 * decision note now starts with (lib/agent/voice.ts) is never refused by the
 * run's search budget. A morning run worked up to 11 stocks in the two weeks
 * to 2026-10-20; two analysts' budgets are 5.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/intelligence/sonar", () => ({
  searchSignals: jest.fn(async () => ({ signals: [] })),
}));

import { webSearch } from "./web-search";
import type { ToolContext } from "@/lib/agent/tool-context";

type Reply = { ok: boolean; data?: { allowed?: boolean; budgetUsed: number } };
const run = (runId: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (webSearch({ runId, userId: "u", accountId: "a", intelligencePolicy: { allowLiveSearch: true, liveSearchBudget: 1 } } as unknown as ToolContext) as any).execute as (
    args: Record<string, unknown>,
  ) => Promise<Reply>;

describe("one news search per stock, outside the run's budget", () => {
  it("six stocks each get their search on a budget of one, and the budget still holds for the rest", async () => {
    const search = run("run-six");
    for (const ticker of ["IOT", "NVDA", "CEG", "PLTR", "MU", "$asml"]) {
      const r = await search({ query: `${ticker} stock news this week`, ticker });
      expect([ticker, r.data?.allowed, r.data?.budgetUsed]).toEqual([ticker, undefined, 0]);
    }
    expect((await search({ query: "semiconductor sector news" })).data?.budgetUsed).toBe(1);
    expect((await search({ query: "software sector news" })).data?.allowed).toBe(false);
  });

  it("asks Sonar for room for its whole reply: at 1,024 tokens IOT's 2026-10-20 reply was cut off and read as no results", async () => {
    const { searchSignals } = jest.requireMock("@/lib/intelligence/sonar") as { searchSignals: jest.Mock };
    await run("run-room")({ query: "IOT Samsara stock news this week", ticker: "IOT", recency: "week" });
    expect(searchSignals).toHaveBeenLastCalledWith("IOT Samsara stock news this week", { recency: "week", model: "sonar", maxTokens: 4096 });
  });

  it("a stock's second search spends the budget like any other", async () => {
    const search = run("run-twice");
    expect((await search({ query: "IOT news", ticker: "IOT" })).data?.budgetUsed).toBe(0);
    expect((await search({ query: "IOT guidance", ticker: "IOT" })).data?.budgetUsed).toBe(1);
    expect((await search({ query: "IOT analyst", ticker: "IOT" })).data?.allowed).toBe(false);
  });
});
