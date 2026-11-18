/**
 * The Writer is told the day it is in New York. AAON's Writer run started
 * 2026-11-17 at 7:10 PM ET (00:10 UTC on the 18th) and was told "Today is
 * 2026-11-18": the date came from the UTC clock. Its date rule says a
 * catalyst dated after today has not happened, so a report due the next
 * morning read as already out.
 */
const mockGenerateText = jest.fn();

jest.mock("ai", () => ({ ...jest.requireActual("ai"), generateText: (...a: unknown[]) => mockGenerateText(...a) }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    agentConfig: { findUnique: jest.fn() },
    thesis: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
    thesisUpdate: { findFirst: jest.fn().mockResolvedValue(null) },
    position: { findFirst: jest.fn().mockResolvedValue(null) },
    runEvent: { create: jest.fn().mockResolvedValue({}) },
    researchRun: { update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn().mockResolvedValue({ parameters: {} }) },
    runMessage: { deleteMany: jest.fn(), create: jest.fn() },
    gateRejection: { create: jest.fn() },
  },
}));
jest.mock("@/lib/actions/finnhub.actions", () => ({ getStockQuote: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/agent/watchlist-symbols", () => ({ getWatchlistSymbols: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/agent/portfolio-block", () => ({ loadPortfolioPieces: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/agent/knowledge/load-setup-overrides", () => ({ loadSetupOverrides: jest.fn().mockResolvedValue({}) }));
jest.mock("@/lib/performance/load-setup-scorecard", () => ({ loadScorecardLines: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/agent/thesis-research/pull-data", () => ({ pullThesisData: jest.fn() }));

import { prisma } from "@/lib/prisma";
import { writerResearchPhase } from "./run-thesis-writer";

const analystRow = {
  id: "analyst_pead",
  userId: "user_1",
  accountId: "account_1",
  name: "PEAD Specialist",
  setupIds: ["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"],
  analystPrompt: null,
  sectors: [],
  exclusionList: [],
  tradingEnvironment: "LIVE",
  minPositionSize: 3000,
  maxPositionSize: 8000,
  maxPositionTotal: 16000,
};

const pullOutput = {
  ok: true,
  pull: { rawDataBlock: "STRUCTURED DATA: $AAON", pullErrors: [], currentPrice: 78.71, chart: { atr14: null, pivot: null, brokenOut: null, sma20: null, sma50: null, daysSinceReport: null }, companyName: "AAON", exchange: "NASDAQ", pulledAt: "2026-11-18T00:10:00.000Z", catalystOnFile: null },
} as never;

afterEach(() => jest.useRealTimers());

it("AAON 2026-11-17, 7:10 PM ET: the Writer's date line says the 17th in New York, not the UTC date", async () => {
  // Only the clock is fixed; the run's own waits use real timers.
  jest.useFakeTimers({ now: new Date("2026-11-18T00:10:00Z"), doNotFake: ["setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "nextTick", "queueMicrotask"] });
  (prisma.agentConfig.findUnique as jest.Mock).mockResolvedValue(analystRow);
  const sent: string[] = [];
  mockGenerateText.mockImplementation(async (opts: Record<string, unknown>) => {
    sent.push(JSON.stringify([opts.system, opts.prompt, opts.messages]));
    return { text: "", response: { messages: [] } };
  });

  await writerResearchPhase({ childRunId: "writer_child_aaon", analystId: "analyst_pead", ticker: "AAON", mode: "mint", reason: "A PEAD re-scan." }, pullOutput);

  expect(sent.length).toBeGreaterThan(0);
  expect(sent[0]).toContain("Tue, Nov 17, 2026, 7:10 PM ET, the LIVE account.");
  expect(sent[0]).not.toContain("Nov 18");
});
