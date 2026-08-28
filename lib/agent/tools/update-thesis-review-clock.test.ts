/**
 * update-thesis-review-clock.test.ts — reviewing a thesis records that we
 * looked at it.
 *
 * DAV-193's subject, after DAV-195 L7 relocated the mechanism. The bug was
 * that real reviews under gpt-5.5 carry narrative fields and took a path
 * that never advanced the clock, so reviewed theses re-fired every morning
 * (overdue backlog 2 → 9, 2026-08-18 run review). The fix then was a
 * conditional bump of a cached review-date column computed from the horizon
 * cadence, in two places that disagreed. That column is gone (DAV-221).
 *
 * Now the clock counts from when we last LOOKED, so there is nothing to
 * compute: `lastReviewedAt` is stamped and the cadence trigger does the
 * arithmetic. Same bug stays fixed, one write instead of two.
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
  // Real function, not a stub: the tool calls it on the WRITE path, so
  // omitting it made every "the legal edit still goes through" case die
  // at the update with "not a function" while the refusal cases — which
  // return before reaching it — all passed. The gate looked green from
  // one side only.
  compactFieldChanges: (fc: unknown) => fc,
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
const RECENT = new Date(Date.now() - 3_600_000);

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
    lastReviewedAt: OVERDUE,
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

describe("update_thesis — recording that we looked", () => {
  beforeEach(() => {
    mockThesisFindUnique.mockReset();
    mockThesisUpdate.mockReset();
    mockThesisUpdate.mockResolvedValue(makeRow());
  });

  it("stamps the review on a substantive (non-empty) update", async () => {
    // The DAV-193 bug: this path is what a real gpt-5.5 review takes, and it
    // used to leave the clock untouched.
    mockThesisFindUnique.mockResolvedValueOnce(makeRow({ lastReviewedAt: OVERDUE }));
    const result = await makeTool().execute({
      thesis_id: "thesis_clock_1",
      rationale: "Belief refresh after today's read-through of the quarter.",
      core_belief: "Refreshed belief with the same direction.",
    });

    expect(result.data.ok).not.toBe(false);
    const data = updatedData();
    expect(data.lastReviewedAt).toBeInstanceOf(Date);
  });

  it("stamps a thesis nobody had looked at before", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeRow({ lastReviewedAt: null }));
    await makeTool().execute({
      thesis_id: "thesis_clock_1",
      rationale: "First look at this row.",
      core_belief: "Refreshed belief.",
    });

    expect(updatedData().lastReviewedAt).toBeInstanceOf(Date);
  });

  it("stamps every review, not only overdue ones", async () => {
    // The old code skipped a thesis whose clock was future-dated, to protect
    // a hand-pinned pre-catalyst review. There is no hand-pinned date any
    // more: looking at a thesis restarts its cadence, full stop. "Look again
    // right before earnings" is a catalyst trigger, not a review date — that
    // is what catalystDate and the earnings predicates are for.
    mockThesisFindUnique.mockResolvedValueOnce(makeRow({ lastReviewedAt: RECENT }));
    await makeTool().execute({
      thesis_id: "thesis_clock_1",
      rationale: "Early touch — reviewed ahead of the cadence.",
      core_belief: "Refreshed belief.",
    });

    expect(updatedData().lastReviewedAt).toBeInstanceOf(Date);
  });

  it("does not stamp a terminal transition", async () => {
    // Killing a thesis is not reviewing it, and a retired row has no cadence.
    mockThesisFindUnique.mockResolvedValueOnce(makeRow({ lastReviewedAt: OVERDUE }));
    await makeTool().execute({
      thesis_id: "thesis_clock_1",
      rationale: "Bear case confirmed by the guidance cut; killing the watch.",
      change_status: "INVALIDATED",
    });

    expect(updatedData().lastReviewedAt).toBeUndefined();
  });
});
