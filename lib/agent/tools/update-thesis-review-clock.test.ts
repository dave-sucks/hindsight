/**
 * update-thesis-review-clock.test.ts — DAV-193: a substantive update on an
 * OVERDUE thesis restarts the review clock.
 *
 * The empty-patch path has bumped nextReviewAt since 2026-05-11, but real
 * reviews under gpt-5.5 carry narrative fields and take the non-empty path,
 * which never advanced the clock — so reviewed theses re-fired REVIEW_DUE
 * every morning (overdue backlog 2 → 9, 2026-08-18 run review).
 */

const mockThesisFindUnique = jest.fn();
const mockThesisUpdate = jest.fn();
const mockPositionFindFirst = jest.fn().mockResolvedValue(null);
const mockThesisUpdateFindFirst = jest.fn().mockResolvedValue(null);
const mockWriteThesisUpdate = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/prisma", () => ({
  prisma: {
    thesis: {
      findUnique: mockThesisFindUnique,
      update: mockThesisUpdate,
    },
    position: { findFirst: mockPositionFindFirst },
    thesisUpdate: { findFirst: mockThesisUpdateFindFirst },
  },
}));
jest.mock("@/lib/actions/finnhub.actions", () => ({
  getStockQuote: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/agent/thesis-updates", () => ({
  writeThesisUpdate: mockWriteThesisUpdate,
  diffThesisFields: jest.fn().mockReturnValue({}),
}));
jest.mock("@/lib/agent/triggers/load-levels", () => ({
  loadLevelSources: jest.fn().mockResolvedValue(new Map()),
  resolveThesisLadder: jest.fn().mockReturnValue([]),
}));

import { updateThesis } from "./update-thesis";
import type { ToolContext } from "@/lib/agent/tool-context";

function makeCtx(): ToolContext {
  return {
    runId: "run_test_clock",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    groupId: (phase: string) => phase,
  } as ToolContext;
}

const OVERDUE = new Date(Date.now() - 9 * 86_400_000);
const FUTURE = new Date(Date.now() + 5 * 86_400_000);

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "thesis_clock_1",
    userId: "user_1",
    ticker: "PANW",
    status: "WATCHING",
    direction: "LONG",
    entryPrice: 100,
    researchRun: { agentConfigId: "analyst_1" },
    snapshot: { text: "old" },
    bullCase: { bullets: [] },
    bearCase: { bullets: [] },
    recentCatalysts: null,
    fundamentals: null,
    latestEarnings: null,
    catalystsAndEvents: null,
    analystConsensus: null,
    insiderTechnical: null,
    coreBelief: "Old belief",
    keyAssumptions: ["a1", "a2"],
    invalidationConds: ["i1", "i2"],
    scoring: null,
    targetPrice: 120,
    stopLoss: 92,
    targetSizePct: 3,
    conviction: "MEDIUM",
    convictionRationale: "Existing medium tier.",
    variantView: null,
    horizon: "TARGET",
    catalystDate: null,
    maxHoldDays: null,
    nextReviewAt: OVERDUE,
    triggers: [
      {
        id: "trig_enter",
        predicate: { kind: "PRICE_ABOVE", level: 110 },
        action: "ENTER",
        rationale: "Entry.",
      },
    ],
    triggerState: {},
    scalingPlan: null,
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTool(): { execute: (args: any) => Promise<any> } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return updateThesis(makeCtx()) as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: (args: any) => Promise<any>;
  };
}

function updatedData(): Record<string, unknown> {
  expect(mockThesisUpdate).toHaveBeenCalled();
  return mockThesisUpdate.mock.calls[0][0].data as Record<string, unknown>;
}

describe("update_thesis — review-clock advance (DAV-193)", () => {
  beforeEach(() => {
    mockThesisFindUnique.mockReset();
    mockThesisUpdate.mockReset();
    mockThesisUpdate.mockResolvedValue(makeRow());
  });

  it("restarts an overdue clock on a substantive (non-empty) update", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeRow({ nextReviewAt: OVERDUE }));
    const result = await makeTool().execute({
      thesis_id: "thesis_clock_1",
      rationale: "Belief refresh after today's read-through of the quarter.",
      core_belief: "Refreshed belief with the same direction.",
    });

    expect(result.data.ok).not.toBe(false);
    const data = updatedData();
    expect(data.nextReviewAt).toBeInstanceOf(Date);
    expect((data.nextReviewAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("also restarts a clock that was never set", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeRow({ nextReviewAt: null }));
    await makeTool().execute({
      thesis_id: "thesis_clock_1",
      rationale: "Belief refresh; clock was never armed on this row.",
      core_belief: "Refreshed belief.",
    });

    const data = updatedData();
    expect(data.nextReviewAt).toBeInstanceOf(Date);
  });

  it("leaves a FUTURE-dated clock alone (pinned pre-catalyst reviews survive)", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeRow({ nextReviewAt: FUTURE }));
    await makeTool().execute({
      thesis_id: "thesis_clock_1",
      rationale: "Early touch — the scheduled review is still days out.",
      core_belief: "Refreshed belief.",
    });

    const data = updatedData();
    expect(data.nextReviewAt).toBeUndefined();
  });

  it("never overrides an explicitly supplied review date", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeRow({ nextReviewAt: OVERDUE }));
    const explicit = new Date(Date.now() + 30 * 86_400_000).toISOString();
    await makeTool().execute({
      thesis_id: "thesis_clock_1",
      rationale: "Pushing the review out deliberately after the print.",
      core_belief: "Refreshed belief.",
      next_review_at: explicit,
    });

    const data = updatedData();
    expect((data.nextReviewAt as Date).toISOString()).toBe(explicit);
  });

  it("does not arm a clock on a terminal transition", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeRow({ nextReviewAt: OVERDUE }));
    await makeTool().execute({
      thesis_id: "thesis_clock_1",
      rationale: "Bear case confirmed by the guidance cut; killing the watch.",
      change_status: "INVALIDATED",
    });

    const data = updatedData();
    expect(data.nextReviewAt).toBeUndefined();
  });
});
