/**
 * The Writer's model call as it goes over the wire: the HTTP body its
 * research call sends (to Anthropic), and what the run keeps about the call,
 * from fixed inputs: a new stock (the Writer's record) and a stock we hold
 * (the Holding refresh's). Kept as a golden file. `UPDATE_WIRE=1` rewrites it.
 *
 * Written first from the Writer's own loop, then rewritten when its research
 * call moved onto the agent runner: the body is the same, byte for byte. The
 * one change is in what the run keeps: the call is named "Main", as every
 * runner call is, where the loop named it "Research".
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const saved: string[] = [];
jest.mock("@/lib/prisma", () => ({
  prisma: {
    agentConfig: {
      findUnique: async () => ({
        id: "analyst_pead",
        userId: "user_1",
        accountId: "account_1",
        name: "PEAD Specialist",
        setupIds: ["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"],
        analystPrompt: "I buy the drift after a clean beat-and-raise.",
        directionBias: "LONG",
        holdDurations: ["SWING"],
        sectors: [],
        exclusionList: [],
        marketCapMin: null,
        marketCapMax: null,
        maxOpenPositions: 6,
        tradingEnvironment: "LIVE",
        minPositionSize: 3000,
        maxPositionSize: 8000,
        maxPositionTotal: 16000,
      }),
    },
    thesis: {
      findFirst: async () => null,
      findUnique: async () => ({
        id: "thesis_mu",
        status: "HOLDING",
        direction: "LONG",
        horizon: "SWING",
        coreBelief: "Memory prices keep rising into 2027.",
        company: "Micron Technology",
        triggers: [{ id: "trg_sell", action: "EXIT", source: "AGENT", predicate: { watch: "price", is: "below", value: 600 }, rationale: "Below the 50-day." }],
      }),
    },
    thesisUpdate: { findFirst: async () => null },
    position: { findFirst: async () => null },
    runEvent: { create: async () => ({}) },
    researchRun: { update: async () => ({}), updateMany: async () => ({ count: 1 }), findUnique: async () => ({ parameters: {} }) },
    runMessage: { create: async ({ data }: { data: { content: string } }) => void saved.push(data.content), deleteMany: async () => ({}) },
    gateRejection: { create: async () => ({}) },
  },
}));
jest.mock("@/lib/actions/finnhub.actions", () => ({ getStockQuote: async () => null }));
jest.mock("@/lib/agent/watchlist-symbols", () => ({ getWatchlistSymbols: async () => [] }));
jest.mock("@/lib/agent/portfolio-block", () => ({ loadPortfolioPieces: async () => [] }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
jest.mock("@/lib/agent/knowledge/load-setup-overrides", () => ({ loadSetupOverrides: async () => ({}) }));
jest.mock("@/lib/agent/knowledge/load-playbook", () => ({
  loadPlaybooks: async () => (setupId: string) => jest.requireActual("@/lib/agent/knowledge/playbooks").playbookTemplates(null, setupId),
}));
jest.mock("@/lib/performance/load-setup-scorecard", () => ({ loadScorecardLines: async () => ["PEAD: 4 trades, 2 won."] }));
jest.mock("@/lib/agent/thesis-research/pull-data", () => ({ pullThesisData: jest.fn() }));

import { writerResearchPhase } from "./run-thesis-writer";

const GOLDEN = join(__dirname, "__fixtures__", "writer.wire.json");

/** A reply that ends the loop at once: some note, no tool call. */
const REPLY = {
  id: "msg_wire",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-6",
  content: [{ type: "text", text: "## Company\nA note." }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 },
};

const pullOutput = (ticker: string, price: number) =>
  ({
    ok: true,
    pull: {
      rawDataBlock: `STRUCTURED DATA: $${ticker}\nPrice $${price}.`,
      pullErrors: [],
      currentPrice: price,
      chart: { atr14: null, pivot: null, brokenOut: null, sma20: null, sma50: null, daysSinceReport: null },
      companyName: ticker,
      exchange: "NASDAQ",
      pulledAt: "2026-11-18T15:00:00.000Z",
      catalystOnFile: null,
    },
  }) as never;

let sent: Array<{ url: string; body: unknown }> = [];
const realFetch = globalThis.fetch;
const realBase = process.env.ANTHROPIC_BASE_URL;
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-wire-test";
  // A base URL set in the shell for something else would send the call elsewhere.
  process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(REPLY), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  if (realBase === undefined) Reflect.deleteProperty(process.env, "ANTHROPIC_BASE_URL");
  else process.env.ANTHROPIC_BASE_URL = realBase;
});
beforeEach(() => {
  sent = [];
  saved.length = 0;
  jest.useFakeTimers({ now: new Date("2026-11-18T15:00:00Z"), doNotFake: ["setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "nextTick", "queueMicrotask"] });
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** What the run keeps about the call, without the clock. */
const keptOf = (content: string) => {
  const { startedAt: _s, endedAt: _e, ...rest } = JSON.parse(content) as Record<string, unknown>;
  return rest;
};

const golden = (): Record<string, unknown> => {
  try {
    return JSON.parse(readFileSync(GOLDEN, "utf8"));
  } catch {
    return {};
  }
};
const wires: Record<string, unknown> = {};
afterAll(() => {
  if (process.env.UPDATE_WIRE) writeFileSync(GOLDEN, JSON.stringify(wires, null, 1) + "\n");
});

it("a new stock: sends the same body and keeps the same record of it", async () => {
  await writerResearchPhase({ childRunId: "writer_wire_aaon", analystId: "analyst_pead", ticker: "AAON", mode: "mint", reason: "A clean beat-and-raise on Nov 17, from the PEAD screen." }, pullOutput("AAON", 78.71));
  wires.mint = { calls: sent, kept: saved.map(keptOf) };
  if (!process.env.UPDATE_WIRE) expect(wires.mint).toEqual(golden().mint);
});

it("a stock we hold: sends the same body and keeps the same record of it", async () => {
  await writerResearchPhase(
    { childRunId: "writer_wire_mu", analystId: "analyst_pead", ticker: "MU", mode: "refresh", existingThesisId: "thesis_mu", reason: "Its report is in: refresh the thesis." },
    pullOutput("MU", 650),
  );
  wires.held = { calls: sent, kept: saved.map(keptOf) };
  if (!process.env.UPDATE_WIRE) expect(wires.held).toEqual(golden().held);
});
