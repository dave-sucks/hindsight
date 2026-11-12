/**
 * The Writer keeps what its research call started with, for its Context panel.
 *
 * DYN's write on 2026-09-25 (writer-and-trade-refusals-2026-09-25.json, as in
 * run-thesis-writer.repair.test.ts), through the real research phase, the
 * SDK's own loop and the real Anthropic provider with only the network
 * stood in for: the model writes its note and submits the decision that
 * night's run submitted. The record holds the first request byte for byte, and the panel
 * shows the Writer's instructions, the analyst's brief and the house rules.
 */
const mockRunMessages: Array<{ runId: string; role: string; content: string }> = [];

jest.mock("@/lib/prisma", () => ({
  prisma: {
    agentConfig: { findUnique: jest.fn() },
    thesis: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
    thesisUpdate: { findFirst: jest.fn().mockResolvedValue(null) },
    position: { findFirst: jest.fn().mockResolvedValue(null) },
    runEvent: { create: jest.fn().mockResolvedValue({}) },
    researchRun: { update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn().mockResolvedValue({ parameters: {} }) },
    runMessage: { deleteMany: jest.fn(), create: jest.fn(async ({ data }: { data: { runId: string; role: string; content: string } }) => (mockRunMessages.push(data), data)) },
    gateRejection: { create: jest.fn() },
  },
}));
jest.mock("@/lib/actions/finnhub.actions", () => ({ getStockQuote: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/agent/watchlist-symbols", () => ({ getWatchlistSymbols: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/agent/knowledge/load-setup-overrides", () => ({ loadSetupOverrides: jest.fn().mockResolvedValue({}) }));
jest.mock("@/lib/performance/load-setup-scorecard", () => ({ loadScorecardLines: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/agent/thesis-research/pull-data", () => ({ pullThesisData: jest.fn() }));

import { prisma } from "@/lib/prisma";
import { writerResearchPhase } from "./run-thesis-writer";
import { viewOfRecord, type RequestRecord } from "@/lib/agent/run-requests";
import { HOUSE_RULES } from "@/lib/agent/house-rules";
import { MODES } from "@/lib/agent/modes";
import raw from "@/lib/agent/__fixtures__/writer-and-trade-refusals-2026-09-25.json";

const DYN = (raw as unknown as { DYN: { last: { input: unknown } } }).DYN;
const sent: string[] = [];
// The network: the provider's fetch passes through to it.
process.env.ANTHROPIC_API_KEY ??= "test";
beforeAll(() => {
  jest.spyOn(globalThis, "fetch").mockImplementation((async (_u: unknown, init?: RequestInit) => {
    sent.push(String(init?.body));
    const reply = {
      id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-6", stop_reason: "tool_use",
      content: [
        { type: "text", text: "## Company\nDyne makes a drug.\n## Bull Case\n- x\n## Bear Case\n- x" },
        { type: "tool_use", id: "toolu_1", name: "submit_thesis", input: DYN.last.input },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch);
});
afterAll(() => jest.restoreAllMocks());

const CATALYST = "cmmqxola3000004lbj7c11bfn";
const CHILD = "writer_child_dyn";

const pullOutput = {
  ok: true,
  pull: {
    rawDataBlock: "STRUCTURED DATA: $DYN",
    pullErrors: [],
    currentPrice: 16.51,
    chart: { atr14: null, pivot: null, brokenOut: null, sma20: null, sma50: null, daysSinceReport: null },
    companyName: "Dyne Therapeutics",
    exchange: "NASDAQ",
    pulledAt: "2026-09-25T04:06:00.000Z",
    catalystOnFile: null,
  },
} as never;

it("DYN: the research call's first request is kept byte for byte, with the Writer's instructions, the analyst's brief, the house rules and the Market and portfolio block apart", async () => {
  (prisma.agentConfig.findUnique as jest.Mock).mockResolvedValue({
    id: CATALYST, userId: "user_1", accountId: "account_1", name: "Catalyst Event PM", setupIds: ["PRE_CATALYST"], analystPrompt: null,
    sectors: [], exclusionList: [], tradingEnvironment: "LIVE", minPositionSize: 3000, maxPositionSize: 8000, maxPositionTotal: 16000,
  });
  const research = await writerResearchPhase({ childRunId: CHILD, analystId: CATALYST, ticker: "DYN", mode: "mint", reason: "PRE_CATALYST dispatch." }, pullOutput);
  expect(research.ok).toBe(true);

  const kept = mockRunMessages.filter((m) => m.role === "request");
  expect(kept).toHaveLength(1);
  expect(kept[0].runId).toBe(CHILD);
  const record = JSON.parse(kept[0].content) as RequestRecord;
  expect(record).toMatchObject({ call: "Research", source: "thesis-writer", model: MODES["thesis-writer"].model, of: 1 });
  expect(record.requests.map((b) => JSON.stringify(b))).toEqual([sent[0]]);

  const view = viewOfRecord(record);
  expect(view.categories.map((c) => [c.name, c.part])).toEqual([
    ["Instructions", "job"],
    ["Analyst: Catalyst Event PM", "analyst"],
    ["House rules", "house"],
    ["Market and portfolio", "portfolio"],
    ["First message", "read"],
    ["Tool menu", "tools"],
  ]);
  // Anthropic's system is a list of text blocks: their text, every character in one part.
  const system = (JSON.parse(sent[0]) as { system: Array<{ text: string }> }).system.map((b) => b.text).join("\n\n");
  expect(view.categories.slice(0, 4).reduce((n, c) => n + c.chars, 0)).toBe(system.length);
  expect(view.categories[2].sections.map((s) => s.text).join("")).toBe(HOUSE_RULES);
  expect(view.categories[4].sections.map((s) => s.text).join("")).toContain("STRUCTURED DATA: $DYN");
  expect(view.categories[5].sections.map((s) => s.label)).toEqual(["web_search", "submit_thesis"]);
});
