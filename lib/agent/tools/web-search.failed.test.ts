/**
 * A search that fails is an error the agent reads as "the search failed",
 * never "Found 0 results", and it spends nothing.
 *
 * The V write-up of 2026-11-19 (run cmwnnpwcu000007jmy86hwxm8) searched at
 * 09:40 ET with the query below. Sonar's reply couldn't be parsed; the
 * production log kept its start (below, verbatim), whose first headline was
 * the news that moved the stock. sonar.ts returned no signals, web_search said
 * "Found 0 results", and the note the owner read before approving the sale
 * said "Today's company news was actually positive".
 */
const REPLY = jest.fn();
jest.mock("openai", () => ({ __esModule: true, default: jest.fn().mockImplementation(() => ({ chat: { completions: { create: REPLY } } })) }));
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { webSearch } from "./web-search";
import type { ToolContext } from "@/lib/agent/tool-context";

const QUERY = "Visa stock down Nov 19 2026 why today latest company news Visa Recurrent swipe fee settlement financials sector move";
const CUT_OFF =
  '{"signals":[{"headline":"Visa shares pressured by uncertainty over proposed $38 billion merchant swipe-fee settlement","industries":["Financial Exchanges & Data"],"sectors":["Financials"],"sentiment":';

type Reply = { ok: boolean; summary: string; data: { failed?: boolean; reason?: string; budgetUsed: number; resultCount?: number } };
const search = (runId: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (webSearch({ runId, userId: "u", accountId: "a" } as unknown as ToolContext) as any).execute as (args: Record<string, unknown>) => Promise<Reply>;

describe("a search that fails says so", () => {
  it("V's unreadable reply: the search failed, nothing was checked; never 0 results", async () => {
    REPLY.mockResolvedValueOnce({ choices: [{ message: { content: CUT_OFF }, finish_reason: "stop" }] });
    const r = await search("v-writeup")({ query: QUERY, recency: "day", ticker: "V" });
    expect(r.summary).toBe("The search failed (the reply couldn't be read), so nothing was checked. Try again (a shorter query helps), or say you couldn't check.");
    expect(r.summary).not.toMatch(/Found 0 results/);
    expect(r.data).toMatchObject({ failed: true, reason: "the reply couldn't be read" });
    expect(r.data.resultCount).toBeUndefined();
  });

  it("a reply cut off at its length says it was cut off", async () => {
    REPLY.mockResolvedValueOnce({ choices: [{ message: { content: CUT_OFF }, finish_reason: "length" }] });
    const r = await search("cut")({ query: QUERY });
    expect(r.data.reason).toBe("the reply was cut off before it ended");
  });

  it("the vendor erroring is a failed search too", async () => {
    REPLY.mockRejectedValueOnce(new Error("429 Too Many Requests"));
    const r = await search("vendor")({ query: QUERY });
    expect(r.summary).toMatch(/^The search failed \(429 Too Many Requests\)/);
  });

  it("a failed search spends nothing: the stock's news search can be tried again outside the budget", async () => {
    const s = search("retry");
    REPLY.mockResolvedValueOnce({ choices: [{ message: { content: CUT_OFF }, finish_reason: "stop" }] });
    expect((await s({ query: QUERY, ticker: "V" })).data.budgetUsed).toBe(0);
    REPLY.mockResolvedValueOnce({ choices: [{ message: { content: '{"signals":[]}' }, finish_reason: "stop" }] });
    const again = await s({ query: QUERY, ticker: "V" });
    expect(again.data.budgetUsed).toBe(0);
    expect(again.summary).toMatch(/^Found 0 results/);
  });
});
