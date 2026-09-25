/**
 * run-thesis-writer.repair.test.ts — a refused submit is repaired, not
 * abandoned (DAV-316).
 *
 * Replay: DYN, 2026-09-25 00:06 ET (run cmugfv69n000904jt5u0nhozo). The
 * research loop ended on a refused submit_thesis — one field wrong, the
 * step budget spent — and the run was marked FAILED with "submit_thesis
 * never passed validation (1 attempt)". Three of five catalyst dispatches
 * that night ended the same way.
 *
 * On main, `writerResearchPhase` returns ok:false the moment the loop ends
 * on a refusal. Here the refusal goes back to the model once, through the
 * same submit tool, and the accepted decision comes out of the phase.
 */

const mockRunEventCreate = jest.fn().mockResolvedValue({});
const mockGenerateText = jest.fn();

jest.mock("ai", () => ({ ...jest.requireActual("ai"), generateText: (...a: unknown[]) => mockGenerateText(...a) }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    agentConfig: { findUnique: jest.fn() },
    thesis: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
    thesisUpdate: { findFirst: jest.fn().mockResolvedValue(null) },
    position: { findFirst: jest.fn().mockResolvedValue(null) },
    runEvent: { create: mockRunEventCreate },
    researchRun: { update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn().mockResolvedValue({ parameters: {} }) },
    runMessage: { deleteMany: jest.fn(), create: jest.fn() },
    gateRejection: { create: jest.fn() },
  },
}));
jest.mock("@/lib/actions/finnhub.actions", () => ({ getStockQuote: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/agent/watchlist-symbols", () => ({ getWatchlistSymbols: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/agent/knowledge/load-setup-overrides", () => ({ loadSetupOverrides: jest.fn().mockResolvedValue({}) }));
jest.mock("@/lib/performance/load-setup-scorecard", () => ({ loadScorecardLines: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/agent/thesis-research/pull-data", () => ({ pullThesisData: jest.fn() }));

import raw from "@/lib/agent/__fixtures__/writer-and-trade-refusals-2026-09-25.json";
import { prisma } from "@/lib/prisma";
import type { ThesisDecisionInput } from "@/lib/agent/thesis-research/decision";
import { writerResearchPhase } from "./run-thesis-writer";

const fx = (raw as unknown as { DYN: { runId: string; last: { input: ThesisDecisionInput } } }).DYN;
const CATALYST = "cmmqxola3000004lbj7c11bfn";
const CHILD = "writer_child_dyn";

const analystRow = {
  id: CATALYST,
  userId: "user_1",
  accountId: "account_1",
  name: "Catalyst Event PM",
  setupIds: ["PRE_CATALYST", "BASE_BREAKOUT", "MA_PULLBACK"],
  analystPrompt: null,
  sectors: [],
  industries: [],
  themes: [],
  exclusionList: [],
  minConfidence: 50,
  tradingEnvironment: "LIVE",
  minPositionSize: 3000,
  maxPositionSize: 8000,
  maxPositionTotal: 16000,
};

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

const args = { childRunId: CHILD, analystId: CATALYST, ticker: "DYN", mode: "mint" as const, reason: "PRE_CATALYST dispatch." };

type Submit = { execute: (a: unknown, o: unknown) => Promise<{ accepted: boolean; errors?: string[] }> };
type Call = { messages?: Array<{ role: string; content: string }>; tools?: { submit_thesis?: Submit }; onStepFinish?: (s: unknown) => void };

/** What the model sent at 00:09 — minus the scoring block, so the writer's own check refuses it. */
const refusedFirst = { ...fx.last.input, scoring: undefined };

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.agentConfig.findUnique as jest.Mock).mockResolvedValue(analystRow);
});

it("DYN: the loop ends on a refused submit; the refusal goes back once and the decision is accepted", async () => {
  const seen: string[] = [];
  mockGenerateText.mockImplementation(async (opts: Call) => {
    const repair = opts.messages?.[2]?.content?.includes("submit_thesis refused it");
    if (opts.tools?.submit_thesis && !repair) {
      seen.push("research");
      // The research loop: a full note, then the one refused submit, then
      // the step budget is gone.
      opts.onStepFinish?.({ toolCalls: [], text: "## Snapshot\nDyne.\n## Recent Catalysts\nx\n## Fundamentals\nx\n## Latest Earnings\n- x\n## Catalysts & Events\n- x\n## Bull Case\n- x\n## Bear Case\n- x\n## Analyst Consensus\nx\n## Insider & Technical\nx", response: { messages: [] } });
      const r = await opts.tools.submit_thesis.execute(refusedFirst, { toolCallId: "t1", messages: [] });
      expect(r.accepted).toBe(false);
      expect(r.errors?.join(" ")).toMatch(/scoring/);
      return { text: "", response: { messages: [] } };
    }
    if (repair) {
      seen.push("repair");
      // The model is shown exactly what it sent and why it was refused.
      expect(opts.messages?.[2]?.content).toMatch(/"direction":"LONG"/);
      expect(opts.messages?.[2]?.content).toMatch(/scoring/);
      const r = await opts.tools!.submit_thesis!.execute(fx.last.input, { toolCallId: "t2", messages: [] });
      expect(r.accepted).toBe(true);
      return { text: "", response: { messages: [] } };
    }
    seen.push("other");
    return { text: "", response: { messages: [] } };
  });

  const research = await writerResearchPhase(args, pullOutput);

  expect(seen).toEqual(["research", "repair"]);
  expect(research.ok).toBe(true);
  expect(research.decision?.direction).toBe("LONG");
  expect(research.decision?.setup_id).toBe("PRE_CATALYST");
  expect(research.submitAttempts).toBe(2);
  const titles = mockRunEventCreate.mock.calls.map((c) => c[0].data.title);
  expect(titles).toContain("Decision refused — repairing");
  expect(titles).toContain("Research complete");
});

it("DYN: a repair that is refused again ends the phase honestly — one repair, not a loop", async () => {
  mockGenerateText.mockImplementation(async (opts: Call) => {
    if (opts.tools?.submit_thesis) {
      await opts.tools.submit_thesis.execute(refusedFirst, { toolCallId: "t", messages: [] });
    }
    return { text: "", response: { messages: [] } };
  });

  const research = await writerResearchPhase(args, pullOutput);

  expect(mockGenerateText).toHaveBeenCalledTimes(2);
  expect(research.ok).toBe(false);
  expect(research.error).toMatch(/never passed validation \(2 attempts\)/);
});
