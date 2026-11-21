jest.mock("@/lib/agent/stock-table-load", () => ({
  loadStockTable: async () => ({
    asOf: "2026-11-11T21:00:00.000Z",
    rows: [
      { ticker: "AAA", status: "held", analyst: "Case Analyst", situations: ["sale signal"], price: 98.4, dayPct: -3.1, volume: 1.4, move5dPct: -6.2, move20dPct: -9.8, vsSpy1M: -7.5, vs50dPct: -8.1, offHighPct: -19.4, sinceBuyPct: -8.9, conviction: "MEDIUM", nextReport: null, waiting: "sell 40" },
      { ticker: "CCC", status: "watch", analyst: "Case Analyst", situations: [], price: 118.9, dayPct: 1.2, volume: 1.1, move5dPct: 2.9, move20dPct: 7.6, vsSpy1M: 5, vs50dPct: 4.3, offHighPct: -2.2, sinceBuyPct: null, conviction: "MEDIUM", nextReport: "2026-11-19", waiting: null },
    ],
  }),
}));
/**
 * The Portfolio Manager's model call as it goes over the wire: the HTTP body
 * its run sends, and what the run keeps about the call, from fixed inputs
 * (the engine tests' stand-ins). Kept as a golden file, written from the run
 * before it moved onto the agent runner: the runner must send the same body,
 * byte for byte. Rewritten once since, for the three parts (2026-11-18): only
 * the instructions and the first message changed, as lib/agent/engine/engine.test.ts
 * proves part by part; the tools and every other field are the same bytes.
 * Rewritten again for the action tools, one job each (2026-11-18): only the
 * tools and the instructions' tool names changed.
 * `UPDATE_WIRE=1` rewrites it.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { STANDIN_SNAPSHOT } from "@/lib/agent/__fixtures__/portfolio-snapshot-standin";
import { STANDIN_MARKET_NUMBERS } from "@/lib/agent/__fixtures__/market-numbers-standin";

const saved: string[] = [];
jest.mock("@/lib/market-data/load-market-numbers", () => ({ loadMarketNumbers: async () => STANDIN_MARKET_NUMBERS }));
jest.mock("@/lib/portfolio/load-snapshot", () => ({ loadPortfolioSnapshot: async () => STANDIN_SNAPSHOT }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    portfolioDigest: { findFirst: async () => ({ narrative: "The account had a good day.", createdAt: new Date("2026-11-12T01:00:00Z") }) },
    marketDigest: { findFirst: async () => ({ digest: "### Market overview\n\nStocks rose.", createdAt: new Date("2026-11-11T12:40:00Z") }) },
    runEvent: { findFirst: async () => ({ message: "### Where the money is\nTwo stocks, one bet.", createdAt: new Date("2026-11-10T15:30:00Z") }) },
    thesis: { findMany: async () => [{ ticker: "AAA", status: "HOLDING", coreBelief: "The company sells a product people keep buying.", triggers: [], researchRun: { agentConfig: { name: "Case Analyst" } } }] },
    runMessage: { create: async ({ data }: { data: { content: string } }) => void saved.push(data.content), deleteMany: async () => ({}) },
  },
}));

import { runPortfolioManager } from "./run";

const GOLDEN = join(__dirname, "__fixtures__", "portfolio-manager.wire.json");
const NOW = new Date("2026-11-12T15:00:00Z");

/** A reply that ends the run at once: the write-up, no tool calls. */
const REPLY = {
  id: "resp_wire",
  object: "response",
  created_at: 1_763_000_000,
  status: "completed",
  model: "gpt-5.4",
  output: [{ type: "message", id: "msg_wire", status: "completed", role: "assistant", content: [{ type: "output_text", text: "### Where the money is\nThe write-up.", annotations: [] }] }],
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
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

/** What the run keeps about the call, without the clock. */
const keptOf = (content: string) => {
  const { startedAt: _s, endedAt: _e, ...rest } = JSON.parse(content) as Record<string, unknown>;
  return rest;
};

it("sends the same body and keeps the same record of it", async () => {
  const result = await runPortfolioManager({ accountId: "acct", environment: "LIVE", userId: "user_1" }, "run_pm_wire", { now: NOW });
  expect(result.error).toBeUndefined();
  expect(result.writeup).toBe("### Where the money is\nThe write-up.");
  const wire = { calls: sent, kept: saved.map(keptOf) };
  if (process.env.UPDATE_WIRE) writeFileSync(GOLDEN, JSON.stringify(wire, null, 1) + "\n");
  expect(wire).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
});
