/**
 * run-thesis-writer.sections-survive.test.ts — step 5 of
 * docs/plans/AGENT_ARCHITECTURE.md, part 1: the research sections leave
 * every agent's copy of update_thesis and record_thesis, and the writer's
 * save must still write them.
 *
 * The writer saves by running its arguments through the tool's own schema
 * (executeThroughSchema), and a schema without a field drops it without a
 * word. So this goes through the real save step, writerPersistPhase, with the
 * context it builds itself (buildWriterToolCtx, runMode THESIS_WRITER), a
 * note carrying a bull case and an earnings section, and checks both reach
 * the row. Decision: DOCU's 2026-09-15 refresh as the model sent it.
 */

const mockThesisFindUnique = jest.fn();
const mockThesisUpdate = jest.fn().mockResolvedValue({});
const mockThesisUpdateFindFirst = jest.fn();
const mockWriteThesisUpdate = jest.fn().mockResolvedValue(undefined);
const mockRunEventCreate = jest.fn().mockResolvedValue({});
const mockGenerateText = jest.fn();

jest.mock("ai", () => ({ ...jest.requireActual("ai"), generateText: (...a: unknown[]) => mockGenerateText(...a) }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    thesis: { findUnique: mockThesisFindUnique, findFirst: jest.fn().mockResolvedValue(null), update: mockThesisUpdate },
    position: { findFirst: jest.fn().mockResolvedValue({ avgCost: 248.05 }) },
    thesisUpdate: { findFirst: mockThesisUpdateFindFirst },
    agentConfig: { findUnique: jest.fn() },
    researchRun: { updateMany: jest.fn(), findUnique: jest.fn().mockResolvedValue({ parameters: {} }), update: jest.fn() },
    runMessage: { deleteMany: jest.fn(), create: jest.fn() },
    runEvent: { create: mockRunEventCreate },
    gateRejection: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/actions/finnhub.actions", () => ({ getStockQuote: jest.fn().mockResolvedValue(null) }));
jest.mock("@/lib/agent/thesis-updates", () => ({
  writeThesisUpdate: mockWriteThesisUpdate,
  diffThesisFields: jest.fn().mockReturnValue({}),
  compactFieldChanges: (fc: unknown) => fc,
}));
jest.mock("@/lib/agent/triggers/load-levels", () => ({
  loadLevelSources: jest.fn().mockResolvedValue(new Map()),
  resolveThesisLadder: jest.fn().mockReturnValue([]),
  parseTriggerState: jest.fn().mockReturnValue({}),
  horizonFor: () => "TARGET",
}));
jest.mock("@/lib/agent/thesis-research/pull-data", () => ({ pullThesisData: jest.fn() }));
jest.mock("@/lib/agent/watchlist-symbols", () => ({ getWatchlistSymbols: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: jest.fn().mockResolvedValue(null) }));

import rawFixtures from "@/lib/agent/__fixtures__/writer-save-refusals-2026-09-15.json";
import { prisma } from "@/lib/prisma";
import { validateThesisDecision, type ValidatedThesisDecision } from "@/lib/agent/thesis-research/decision";
import { setupsForAnalyst } from "@/lib/agent/knowledge/setups";
import { writerPersistPhase, type WriterResearchPhaseOutput } from "./run-thesis-writer";

/** The production rows as read from JSON; the submit is what the model sent. */
type RawDecision = Parameters<typeof validateThesisDecision>[0];
const fixtures = rawFixtures as unknown as Record<"FIVE" | "DOCU", {
  runId: string;
  submit: RawDecision & { remove_trigger_ids: string[] };
  thesis: { id: string; ticker: string; status: string; direction: string; entryPrice: number | null; targetPrice: number | null; stopLoss: number | null; horizon: string; triggers: unknown[]; triggerState: unknown };
}>;


const PEAD = "cmnhxpjio000004jvox6kl6c7";
const fx = fixtures.DOCU;
const CHILD = "writer_child_run";

const analystRow = {
  id: PEAD,
  userId: "user_1",
  accountId: "account_1",
  name: "PEAD Specialist",
  analystPrompt: null,
  sectors: [],
  industries: [],
  themes: [],
  exclusionList: [],
  minConfidence: 60,
  tradingEnvironment: "PAPER",
  minPositionSize: 2000,
  maxPositionSize: 8000,
  maxPositionTotal: 0,
};

const storedRow = {
  ...fx.thesis,
  userId: "user_1",
  accountId: "account_1",
  retiredReason: null,
  researchData: null,
  researchRun: { agentConfigId: PEAD },
  snapshot: null, bullCase: null, bearCase: null, recentCatalysts: null, fundamentals: null,
  latestEarnings: null, catalystsAndEvents: null, analystConsensus: null, insiderTechnical: null,
  coreBelief: "Post-earnings drift continues.",
  keyAssumptions: ["a", "b"],
  invalidationConds: ["c", "d"],
  scoring: null,
  conviction: "MEDIUM",
  convictionRationale: "Medium.",
  variantView: null,
  catalystDate: null,
  lastReviewedAt: null,
  researchUpdatedAt: new Date(),
};


function research(): WriterResearchPhaseOutput {
  const v = validateThesisDecision(fx.submit, {
    mode: "refresh",
    existingStatus: fx.thesis.status,
    currentPrice: 72.87,
    existingTargetPrice: fx.thesis.targetPrice,
    setups: setupsForAnalyst(["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"]),
    chart: null,
  });
  return {
    ok: true,
    noteText: [
      "## Snapshot",
      "DOCU drift note.",
      "## Latest Earnings",
      "- Q2 billings grew 9% against a 6% guide.",
      "## Bull Case",
      "- eSignature renewals are expanding into the IAM suite.",
    ].join("\n"),
    decision: v.decision as ValidatedThesisDecision,
    riskReward: null,
    threadMessages: [],
    userPrompt: "GROUND-TRUTH DATA — DOCU",
    systemPrompt: "You are the PEAD Specialist.",
    stepCount: 3,
    toolCallCount: 1,
    submitAttempts: 1,
    sectionCount: 3,
  };
}

const pullOutput = { ok: true, pull: { currentPrice: 72.87 } } as never;
const args = { childRunId: CHILD, analystId: PEAD, ticker: "DOCU", mode: "refresh" as const, existingThesisId: fx.thesis.id, reason: "Refresh — the sections must reach the row." };

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.agentConfig.findUnique as jest.Mock).mockResolvedValue(analystRow);
  mockThesisFindUnique.mockResolvedValue(storedRow);
  mockThesisUpdateFindFirst.mockImplementation(async () =>
    mockWriteThesisUpdate.mock.calls.length > 0 ? { thesisId: fx.thesis.id } : null,
  );
});

it("the writer's real save writes the bull case and the earnings section to the row", async () => {
  const result = await writerPersistPhase(args, pullOutput, research(), Date.now());

  expect(result.status).toBe("COMPLETE");
  expect(mockThesisUpdate).toHaveBeenCalledTimes(1);
  const data = (mockThesisUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
  expect(JSON.stringify(data.bullCase)).toContain("expanding into the IAM suite");
  expect(JSON.stringify(data.latestEarnings)).toContain("billings grew 9%");
});
