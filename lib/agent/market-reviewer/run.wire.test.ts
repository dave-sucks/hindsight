/**
 * The Market Reviewer's model call as it goes over the wire: the HTTP body
 * its run sends (its web search and its reply's format with it), and what
 * the run keeps about the call, from fixed inputs. Kept as a golden file.
 * `UPDATE_WIRE=1` rewrites it.
 *
 * Written first from the direct OpenAI call, then rewritten when the
 * Reviewer moved onto the agent runner. The text the model reads is the
 * same, and so are its search, its reply's schema and its budget; the body
 * differs from the direct call in five places, all the AI SDK's or the
 * runner's:
 *   1. The instructions go as role "developer", not "system" (the SDK's role
 *      for a gpt-5 model, what every agent on the runner sends).
 *   2. The first message's text goes as [{ type: "input_text", text }], not
 *      a string.
 *   3. `include: ["web_search_call.action.sources"]`: the SDK asks for the
 *      search's sources back.
 *   4. `tool_choice: "auto"`, OpenAI's default, sent by the SDK.
 *   5. `prompt_cache_key` is the run's id, as on every run on the runner.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { STANDIN_SNAPSHOT } from "@/lib/agent/__fixtures__/portfolio-snapshot-standin";
import { STANDIN_MARKET_NUMBERS } from "@/lib/agent/__fixtures__/market-numbers-standin";

jest.mock("@/lib/market-data/load-market-numbers", () => ({ loadMarketNumbers: async () => STANDIN_MARKET_NUMBERS }));
jest.mock("@/lib/portfolio/load-snapshot", () => ({ loadPortfolioSnapshot: async () => STANDIN_SNAPSHOT }));
const saved: string[] = [];
jest.mock("@/lib/prisma", () => ({
  prisma: {
    runMessage: { create: async ({ data }: { data: { content: string } }) => void saved.push(data.content), deleteMany: async () => ({}) },
    thesis: {
      findMany: async () => [
        { ticker: "MU", status: "HOLDING", coreBelief: "Memory prices keep rising into 2027. The rest is detail.", kpis: ["Contract prices rise each quarter, checked at each report", "A guidance cut at the next report"] },
        { ticker: "ASML", status: "WATCHING", coreBelief: "Lithography demand recovers next year.", kpis: [] },
      ],
    },
    marketDigest: { findFirst: async () => ({ date: new Date("2026-11-11T00:00:00Z"), digest: "### Market overview\n\nStocks rose.", createdAt: new Date("2026-11-11T12:40:00Z") }) },
    portfolioDigest: { findFirst: async () => null },
    sharedNote: { findMany: async () => [{ createdAt: new Date("2026-11-10T12:00:00Z"), tickers: ["MU"], impact: "medium", effect: "stronger", body: "Memory prices rose again. More to come." }] },
  },
}));

import { writeMarketReview } from "./run";

const GOLDEN = join(__dirname, "__fixtures__", "market-reviewer.wire.json");
const NOW = new Date("2026-11-12T12:30:00Z");

/** A reply with one search, the digest and one note. */
const REPLY = {
  id: "resp_wire",
  object: "response",
  created_at: 1_763_000_000,
  status: "completed",
  model: "gpt-5.4",
  output: [
    { type: "web_search_call", id: "ws_wire", status: "completed", action: { type: "search", query: "memory prices November 2026" } },
    {
      type: "message",
      id: "msg_wire",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: JSON.stringify({ digest: "### Market overview\n\nStocks fell.", notes: [{ tickers: ["MU"], text: "Memory prices rose.", impact: "low", effect: "stronger" }] }), annotations: [] }],
    },
  ],
  incomplete_details: null,
  usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 15 },
};

let sent: Array<{ url: string; body: unknown }> = [];
const realFetch = globalThis.fetch;
beforeAll(() => {
  process.env.OPENAI_API_KEY = "sk-wire-test";
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(REPLY), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  sent = [];
  saved.length = 0;
});

/** What the run keeps about the call, without the clock. */
const keptOf = (content: string) => {
  const { startedAt: _s, endedAt: _e, ...rest } = JSON.parse(content) as Record<string, unknown>;
  return rest;
};

it("sends the same body and keeps the same record of it", async () => {
  const out = await writeMarketReview({ accountId: "acct", environment: "LIVE", userId: "user_1" }, { now: NOW, runId: "run_review_wire" });
  expect(out.error).toBeUndefined();
  expect(out.digest).toBe("### Market overview\n\nStocks fell.");
  expect(out.notes).toHaveLength(1);
  expect(out.searches).toEqual(["memory prices November 2026"]);
  const wire = { calls: sent, kept: saved.map(keptOf) };
  if (process.env.UPDATE_WIRE) writeFileSync(GOLDEN, JSON.stringify(wire, null, 1) + "\n");
  expect(wire).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
});
