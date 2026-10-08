/**
 * run-thesis-writer.save-retry.test.ts — what the real save does with a plan
 * the check let through.
 *
 * The submit step's check can still be outrun (it leaves out the
 * server-built sections, and it lets a decision through after two refusals
 * so the loop can't spin). A save is a patch: a plan the save can't apply is
 * refused by itself and the rest of the refresh lands, so the research is
 * kept, the stock keeps the plan it had, and the run's record names what was
 * not applied. The one save-time retry is left for a save refused whole.
 *
 * Replay: DOCU's 2026-09-15 decision with its floor kept (the buy level
 * removed, the $57.50 sell left behind — a sale with no buy, which the save's
 * plan rule refuses) reaching the save. DOCU's real decision took the floor
 * off too; the $76 review it kept is a wake since the QB ruling of
 * 2026-09-29 (DAV-335), so that call is the fix.
 * FIVE's original case (explanations over a 240-character cap) is no longer
 * a refusal: the cap is gone (DAV-316).
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

/** The refused decision: DOCU's, with its floor ($57.50 sell) kept and no buy. */
const halfPlan = {
  ...fx.submit,
  remove_trigger_ids: fx.submit.remove_trigger_ids.filter((id) => !id.startsWith("85cba008")),
};

function research(): WriterResearchPhaseOutput {
  const v = validateThesisDecision(halfPlan, {
    mode: "refresh",
    existingStatus: fx.thesis.status,
    currentPrice: 72.87,
    existingTargetPrice: fx.thesis.targetPrice,
    setups: setupsForAnalyst(["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"]),
    chart: null,
  });
  return {
    ok: true,
    noteText: "## Snapshot\nDOCU drift note.",
    decision: v.decision as ValidatedThesisDecision,
    riskReward: null,
    threadMessages: [],
    userPrompt: "GROUND-TRUTH DATA — DOCU",
    systemPrompt: "You are the PEAD Specialist.",
    stepCount: 3,
    toolCallCount: 1,
    submitAttempts: 1,
    sectionCount: 1,
  };
}

const pullOutput = { ok: true, pull: { currentPrice: 72.87 } } as never;
const args = { childRunId: CHILD, analystId: PEAD, ticker: "DOCU", mode: "refresh" as const, existingThesisId: fx.thesis.id, reason: "Refresh under the new writer rules — live check." };

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.agentConfig.findUnique as jest.Mock).mockResolvedValue(analystRow);
  mockThesisFindUnique.mockResolvedValue(storedRow);
  // No audit row until the save actually writes.
  mockThesisUpdateFindFirst.mockImplementation(async () =>
    mockWriteThesisUpdate.mock.calls.length > 0 ? { thesisId: fx.thesis.id } : null,
  );
});

it("DOCU: the save keeps the research, refuses the half plan by name, and the stock keeps its plan — no retry", async () => {
  const result = await writerPersistPhase(args, pullOutput, research(), Date.now());

  expect(mockGenerateText).not.toHaveBeenCalled();
  expect(result.status).toBe("COMPLETE");
  expect(result.thesisId).toBe(fx.thesis.id);
  expect(mockThesisUpdate).toHaveBeenCalledTimes(1);
  expect(mockThesisUpdate.mock.calls[0][0].data.triggers).toBeUndefined();
  const events = mockRunEventCreate.mock.calls.map((c) => c[0].data as { title: string; message: string });
  expect(events.map((e) => e.title)).not.toContain("Save refused — retrying once");
  expect(events.find((e) => e.title === "Thesis persisted")?.message).toMatch(/Not applied: triggers — .*no buy level/);
});
