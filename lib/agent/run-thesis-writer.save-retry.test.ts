/**
 * run-thesis-writer.save-retry.test.ts — one retry when the save refuses.
 *
 * The submit step's check can still be outrun (it leaves out the
 * server-built sections, and it lets a decision through after two refusals
 * so the loop can't spin). When the real save refuses, the model sees the
 * refusal once and resubmits; the corrected decision is saved.
 *
 * Replay: DOCU's 2026-09-15 decision (the buy level removed, the $76
 * review left behind — the save's plan rule refuses it) reaching the save.
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

/**
 * The fix the refusal asks for. The writer had already named the level in
 * its own REVIEW rung — "pullback to the gap-day midpoint ($67.28) … stop at
 * $64.16 (gap-day low) and target $78.30" — and written it as a review
 * instead of a buy. Moved, the plan pays 3.5:1.
 */
const fixedPlan = {
  ...fx.submit,
  setup_id: "MA_PULLBACK" as const,
  add_triggers: [],
  edit_triggers: [],
  remove_trigger_ids: [],
  entry_price: 67.28,
  stop_loss: 64.16,
  target_price: 78.3,
  stop_basis: "Under the September 4 gap-day low at $64.16, 1.4 ATR below the entry.",
  target_basis: "1.272 Fibonacci extension of the gap move, $78.30 — 3.5R against a $3.12 stop.",
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

it("DOCU: the save refuses taking the buy off, the model resubmits with the buy moved to the level it had named, and the thesis saves", async () => {
  mockGenerateText.mockImplementation(async (opts: { messages: Array<{ content: string }>; tools: { submit_thesis: { execute: (a: unknown, o: unknown) => Promise<unknown> } } }) => {
    // The model is shown the refusal in the save's own words.
    expect(opts.messages[2].content).toMatch(/take the buy off/);
    await opts.tools.submit_thesis.execute(fixedPlan, { toolCallId: "retry", messages: [] });
    return { text: "", response: { messages: [] } };
  });

  const result = await writerPersistPhase(args, pullOutput, research(), Date.now());

  expect(mockGenerateText).toHaveBeenCalledTimes(1);
  expect(result.status).toBe("COMPLETE");
  expect(result.thesisId).toBe(fx.thesis.id);
  expect(mockThesisUpdate).toHaveBeenCalledTimes(1);
  const titles = mockRunEventCreate.mock.calls.map((c) => c[0].data.title);
  expect(titles).toContain("Save refused — retrying once");
  expect(titles).toContain("Thesis persisted");
});

it("DOCU: a retry that doesn't fix it fails the run with the save's reason — one retry, not a loop", async () => {
  mockGenerateText.mockImplementation(async () => ({ text: "", response: { messages: [] } }));

  const result = await writerPersistPhase(args, pullOutput, research(), Date.now());

  expect(mockGenerateText).toHaveBeenCalledTimes(1);
  expect(result.status).toBe("FAILED");
  expect(result.error).toMatch(/take the buy off/);
  expect(mockThesisUpdate).not.toHaveBeenCalled();
});
