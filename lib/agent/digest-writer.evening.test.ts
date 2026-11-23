/**
 * The evening of Mon, Nov 23, 2026 on the live book: three sales were waiting
 * (NVDA, PLTR, IOT) and the Portfolio Manager had run at 3:25 PM. The evening
 * summary used to be given the snapshot alone and told to say whether it
 * would approve each proposal, "from what the snapshot shows". Now it is
 * given each proposal's saved reason (the snapshot's, as before) and that
 * day's Portfolio Manager write-up, is asked for no view of its own, and may
 * search the web. The tickers, the reasons and the write-up's words are that
 * evening's; the amounts are stand-ins (the repo is public). Through
 * writeDigestNarrative on the agent runner; the database, OpenAI's endpoint
 * and the search are stood in for.
 */
let writeup: { message: string; createdAt: Date } | null = null;
const asked: unknown[] = [];
jest.mock("@/lib/prisma", () => ({ prisma: { runEvent: { findFirst: async (q: unknown) => (asked.push(q), writeup) } } }));
const searched: string[] = [];
jest.mock("@/lib/intelligence/sonar", () => ({
  searchSignals: async (query: string) => (searched.push(query), { signals: [{ headline: "Nvidia says Jensen Huang returns as CEO", summary: "The board reversed his resignation.", tickers: ["NVDA"], sentiment: "bullish", sourceUrls: [] }], citations: [] }),
}));

const sent: Array<{ messages: Array<{ role: string; content: string | null }>; tools?: Array<{ function: { name: string } }> }> = [];
const text = (content: string) => ({ index: 0, message: { role: "assistant", content }, finish_reason: "stop" });
const search = (query: string) => ({ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "web_search", arguments: JSON.stringify({ query, ticker: "NVDA" }) } }] }, finish_reason: "tool_calls" });
let replies: unknown[] = [];
const realFetch = globalThis.fetch;
beforeAll(() => {
  process.env.OPENAI_API_KEY = "sk-test";
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "gpt-5.4", choices: [replies.shift() ?? text("A digest.")] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

import { writeDigestNarrative } from "./digest-writer";
import { buildSnapshot } from "@/lib/portfolio/snapshot";

const NVDA_REASON = "Nvidia is down again today around $162, and I proposed selling your shares. This is still company trouble, not just a weak chip group.";
const PLTR_REASON = "Palantir is down about 3% today to roughly $166, and I would hold rather than approve the sale that is waiting for you.";
const IOT_REASON = "Samsara is slipping again to about $40.6, and I agree with the sale that is waiting for you.";
const EVENING = buildSnapshot({
  day: "2026-11-23",
  live: false,
  at: "2026-11-24T01:00:00.000Z",
  cash: 40_000,
  contributed: 100_000,
  holdings: [
    { ticker: "IOT", shares: 100, avgCost: 42, price: 38, prevClose: 37, analyst: "PEAD Specialist" },
    { ticker: "PLTR", shares: 20, avgCost: 190, price: 160, prevClose: 144, analyst: "Secular Compounder" },
    { ticker: "NVDA", shares: 10, avgCost: 218, price: 165, prevClose: 125, analyst: "PEAD Specialist" },
  ],
  trades: [],
  waiting: [
    { side: "SELL", ticker: "NVDA", shares: 10, firstProposed: "2026-09-14T14:40:00.000Z", times: 30, note: NVDA_REASON, analyst: "PEAD Specialist" },
    { side: "SELL", ticker: "PLTR", shares: 20, firstProposed: "2026-10-23T14:40:00.000Z", times: 16, note: PLTR_REASON, analyst: "Secular Compounder" },
    { side: "SELL", ticker: "IOT", shares: 100, firstProposed: "2026-10-16T14:40:00.000Z", times: 17, note: IOT_REASON, analyst: "PEAD Specialist" },
  ],
});
const WRITEUP =
  "### The ranking\nCRWD first, even after today’s drop, because the quarter itself was very strong.\n\nCEG next, because the business evidence is still clearly moving the right way.\n\n### What I did\nNothing.\n\nI did not repeat any sale that is already waiting for you in NVDA, PLTR, or IOT.";
const BOOK = { userId: "user_owner", accountId: "account_live", environment: "LIVE" } as const;

beforeEach(() => {
  sent.length = 0;
  asked.length = 0;
  searched.length = 0;
  replies = [];
  writeup = { message: WRITEUP, createdAt: new Date("2026-11-23T20:25:44.000Z") };
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("the evening summary on Mon, Nov 23", () => {
  it("is sent each waiting sale with its saved reason, then the Portfolio Manager's write-up from that day, for the live book", async () => {
    await writeDigestNarrative(EVENING, null, BOOK);
    const message = sent[0].messages[1].content!;
    expect(message.startsWith("Mon, Nov 23, 2026, 8:00 PM ET, the LIVE account.\n\n## Market and portfolio\n\n### Portfolio snapshot\n")).toBe(true);
    expect(message).toContain(`- Sell 10 shares of NVDA, proposed 30 times since Mon, Sep 14 · PEAD Specialist. Its reason: "${NVDA_REASON}"`);
    expect(message).toContain(`- Sell 20 shares of PLTR, proposed 16 times since Fri, Oct 23 · Secular Compounder. Its reason: "${PLTR_REASON}"`);
    expect(message).toContain(`- Sell 100 shares of IOT, proposed 17 times since Fri, Oct 16 · PEAD Specialist. Its reason: "${IOT_REASON}"`);
    expect(message.endsWith(`\n\n## The Portfolio Manager's write-up today\n${WRITEUP}`)).toBe(true);
    // The write-up is the live book's: the paper book had its own that afternoon.
    expect(asked).toEqual([expect.objectContaining({ where: { type: "portfolio_writeup", run: { accountId: "account_live", environment: "LIVE", mode: "PORTFOLIO_MANAGER" } } })]);
  });

  it("is asked for each proposal's reason and no view of its own, and what the Portfolio Manager did", async () => {
    await writeDigestNarrative(EVENING, null, BOOK);
    const system = sent[0].messages[0].content!;
    expect(system).toContain("For each: what it would do, and the reason it was proposed, as the snapshot gives it. Add no view of your own on whether to approve it.");
    expect(system).not.toMatch(/would you approve|your own view, in plain words/);
    expect(system).toContain("When you are given the Portfolio Manager's write-up: what it did that day and the top of its ranking, in a sentence or two.");
    expect(system).toContain("never suggest what to do with it");
    expect(sent[0].tools?.map((t) => t.function.name)).toEqual(["web_search"]);
  });

  it("on an evening the Portfolio Manager didn't run, an older write-up is left out", async () => {
    // Its last was Thursday's, Nov 19.
    writeup = { message: WRITEUP, createdAt: new Date("2026-11-19T15:34:00.000Z") };
    await writeDigestNarrative(EVENING, null, BOOK);
    expect(sent[0].messages[1].content).not.toContain("Portfolio Manager");
    expect(sent[0].messages[1].content!.endsWith('Its reason: "' + IOT_REASON + '"')).toBe(true);
  });

  it("a write-up from later that night is not this run's", async () => {
    writeup = { message: WRITEUP, createdAt: new Date("2026-11-24T02:10:00.000Z") };
    await writeDigestNarrative(EVENING, null, BOOK);
    expect(sent[0].messages[1].content).not.toContain("Portfolio Manager");
  });

  it("when it searches first, the search runs, a second request carries the result, and the summary is its last reply", async () => {
    replies = [search("Nvidia stock news Nov 23 2026"), text("NVDA jumped after Jensen Huang returned as CEO.")];
    const out = await writeDigestNarrative(EVENING, null, BOOK);
    expect(searched).toEqual(["Nvidia stock news Nov 23 2026"]);
    expect(sent).toHaveLength(2);
    expect(sent[1].messages.map((m) => m.role)).toEqual(["developer", "user", "assistant", "tool"]);
    expect(sent[1].messages[3].content).toContain("Jensen Huang returns as CEO");
    expect(out).toMatchObject({ narrative: "NVDA jumped after Jensen Huang returned as CEO.", model: "gpt-5.4" });
    expect(out.run.toolCalls).toEqual([{ tool: "web_search", input: { query: "Nvidia stock news Nov 23 2026", ticker: "NVDA" } }]);
  });
});
