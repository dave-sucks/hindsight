/**
 * update-thesis-active-gate.test.ts — the ACTIVE-requires-open-position gate.
 *
 * "Do we hold it?" is owned by the position lifecycle, not the agent. A
 * thesis can only be flipped WATCHING → ACTIVE when a real OPEN position
 * backs it. This is the mirror of the terminal-without-close zombie gate
 * (you can't mark a thesis CLOSED without a real close → you can't mark it
 * ACTIVE without a real open), and the fix for the orphan class: a
 * rejected/expired buy proposal leaving the thesis stranded ACTIVE with no
 * holding (IONS, XENE 2026-06-07).
 */

const mockThesisFindUnique = jest.fn();
const mockThesisUpdate = jest.fn().mockResolvedValue({});
const mockPositionFindFirst = jest.fn().mockResolvedValue(null);
const mockThesisUpdateFindFirst = jest.fn().mockResolvedValue(null);
const mockWriteThesisUpdate = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/prisma", () => ({
  prisma: {
    thesis: { findUnique: mockThesisFindUnique, update: mockThesisUpdate },
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

import { updateThesis } from "./update-thesis";
import type { ToolContext } from "@/lib/agent/tool-context";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    runId: "run_test_active",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    groupId: (phase: string) => phase,
    ...overrides,
  } as ToolContext;
}

/** A WATCHING LONG thesis with an ENTER trigger — the row an entry flips. */
function makeWatchingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "thesis_1",
    userId: "user_1",
    ticker: "TEST",
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
    scoring: {
      trendStrength: { score: 2, note: "ok" },
      relativeStrength: { score: 2, note: "ok" },
      entryQuality: { score: 2, note: "ok" },
      catalystFreshness: { score: 2, note: "ok" },
      composite: 8,
    },
    targetPrice: 120,
    stopLoss: 92,
    targetSizePct: 3,
    conviction: "MEDIUM",
    convictionRationale: "Existing medium tier.",
    variantView: null,
    horizon: "TARGET",
    catalystDate: null,
    maxHoldDays: null,
    nextReviewAt: null,
    triggers: [
      { kind: "PRICE_ABOVE", action: "ENTER", predicate: { kind: "PRICE_ABOVE", level: 100 } },
    ],
    scalingPlan: null,
    ...overrides,
  };
}

type ExecArgs = Record<string, unknown>;
function runUpdate(ctx: ToolContext, args: ExecArgs) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = updateThesis(ctx) as unknown as { execute: (a: any) => Promise<any> };
  return tool.execute(args);
}

describe("update_thesis — ACTIVE requires a real open position", () => {
  beforeEach(() => {
    mockThesisFindUnique.mockReset();
    mockPositionFindFirst.mockReset().mockResolvedValue(null);
    mockThesisUpdate.mockClear();
  });

  it("refuses WATCHING → ACTIVE when no OPEN position backs it (the orphan path)", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeWatchingRow());
    mockPositionFindFirst.mockResolvedValue(null); // proposal pending or nothing — no real holding

    const result = await runUpdate(makeCtx(), {
      thesis_id: "thesis_1",
      rationale: "ENTER trigger fired; proposing entry.",
      change_status: "ACTIVE",
      target_price: 120,
      stop_loss: 92,
    });

    expect(result.data.ok).toBe(false);
    expect(result.data.error).toBe("active_without_open_position");
    // It looked for a real OPEN position on (analyst, ticker).
    expect(mockPositionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          analystId: "analyst_1",
          symbol: "TEST",
          status: "OPEN",
        }),
      }),
    );
    // And it never wrote the premature flip.
    expect(mockThesisUpdate).not.toHaveBeenCalled();
  });

  it("allows WATCHING → ACTIVE when a real OPEN position exists (direct fill)", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeWatchingRow());
    mockPositionFindFirst.mockResolvedValue({ id: "pos_open_1" }); // real holding backs it

    const result = await runUpdate(makeCtx(), {
      thesis_id: "thesis_1",
      rationale: "Order filled; promoting to ACTIVE.",
      change_status: "ACTIVE",
      target_price: 120,
      stop_loss: 92,
    });

    // The gate did NOT block — whatever happens downstream, it isn't this refusal.
    expect(result.data.error).not.toBe("active_without_open_position");
  });

  it("does not fire on a plain WATCHING review (no change_status)", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeWatchingRow());

    const result = await runUpdate(makeCtx(), {
      thesis_id: "thesis_1",
      rationale: "Reviewed; thesis intact, no changes warranted today.",
    });

    expect(result.data.error).not.toBe("active_without_open_position");
  });
});
