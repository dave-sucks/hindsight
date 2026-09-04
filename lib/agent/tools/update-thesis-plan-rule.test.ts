/**
 * update-thesis-plan-rule.test.ts — the one price-plan rule on the
 * update path (2026-09-02).
 *
 * The shape gate used to run only when target_price or stop_loss changed,
 * so an entry-only edit could produce entry == target (PLTR, 2026-08-27:
 * entry 183 → 190 against a $190 target, nothing objected). And the 2:1
 * floor ran only inside the writer loop, never here or in record_thesis.
 * Both now go through validateThesisShape on any level edit.
 */

const mockThesisFindUnique = jest.fn();
const mockThesisUpdate = jest.fn().mockResolvedValue({});
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
  compactFieldChanges: (fc: unknown) => fc,
}));
jest.mock("@/lib/agent/triggers/load-levels", () => ({
  loadLevelSources: jest.fn().mockResolvedValue(new Map()),
  resolveThesisLadder: jest.fn().mockReturnValue([]),
  parseTriggerState: jest.fn().mockReturnValue({}),
  horizonFor: () => "TARGET",
}));

import { updateThesis } from "./update-thesis";
import type { ToolContext } from "@/lib/agent/tool-context";

const ctx = {
  runId: "run_plan_rule",
  userId: "user_1",
  accountId: "account_1",
  analystId: "analyst_1",
  groupId: (phase: string) => phase,
} as ToolContext;

// PLTR as it stood on 2026-08-26: entry 183, target 190, stop 110.
function pltr(overrides: Record<string, unknown> = {}) {
  return {
    id: "thesis_pltr",
    userId: "user_1",
    accountId: "account_1",
    ticker: "PLTR",
    status: "WATCHING",
    direction: "LONG",
    horizon: "COMPOUNDER",
    entryPrice: 183,
    targetPrice: 190,
    stopLoss: 110,
    coreBelief: "AIP adoption compounds.",
    keyAssumptions: ["a", "b"],
    invalidationConds: ["c", "d"],
    conviction: "MEDIUM",
    convictionRationale: "Existing medium tier.",
    variantView: null,
    targetSizePct: 3,
    catalystDate: null,
    lastReviewedAt: null,
    researchUpdatedAt: new Date(),
    triggers: [
      {
        id: "enter-1",
        predicate: { kind: "PRICE_ABOVE", level: 183 },
        action: "ENTER",
        rationale: "Reclaim.",
        source: "AGENT",
      },
      {
        id: "clock-1",
        predicate: { kind: "REVIEW_CADENCE", days: 14 },
        action: "REVIEW",
        rationale: "Routine.",
        source: "AGENT",
      },
    ],
    triggerState: {},
    ...overrides,
  };
}

async function run(args: Record<string, unknown>) {
  const tool = updateThesis(ctx) as unknown as {
    execute: (a: Record<string, unknown>) => Promise<{ data?: Record<string, unknown> }>;
  };
  return tool.execute({ thesis_id: "thesis_pltr", rationale: "Re-level the plan.", ...args });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockThesisFindUnique.mockResolvedValue(pltr());
});

describe("update_thesis — the plan rule runs on any level edit", () => {
  it("refuses the 08-27 PLTR edit: moving only the entry onto the target", async () => {
    const result = await run({ entry_price: 190 });
    expect(result.data?.ok).toBe(false);
    expect(result.data?.error).toBe("invalid_thesis_shape");
    expect(mockThesisUpdate).not.toHaveBeenCalled();
  });

  it("refuses an entry edit that leaves the plan under 2:1", async () => {
    // 183 → 150 against target 190 / stop 110: reward 40, risk 40 → 1:1.
    const result = await run({ entry_price: 150 });
    expect(result.data?.ok).toBe(false);
    expect(result.data?.error).toBe("invalid_thesis_shape");
    expect(String(result.data?.message)).toContain("R/R floor");
  });

  it("accepts a re-level that clears the floor in the same call", async () => {
    // entry 165 / target 250 / stop 135: reward 85, risk 30 → 2.8:1.
    const result = await run({ entry_price: 165, target_price: 250, stop_loss: 135 });
    expect(result.data?.error).toBeUndefined();
    expect(mockThesisUpdate).toHaveBeenCalled();
  });

  it("a held name is exempt from the floor (the fill is the entry, the floor ratchets)", async () => {
    mockThesisFindUnique.mockResolvedValue(pltr({ status: "HOLDING", stopLoss: 170 }));
    mockPositionFindFirst.mockResolvedValueOnce({ avgCost: 160 });
    // Raising the floor toward the fill leaves reward 30 / risk ~0 — no R/R
    // question on a held name, only ordering.
    const result = await run({ stop_loss: 158 });
    expect(result.data?.error).not.toBe("invalid_thesis_shape");
  });
});
