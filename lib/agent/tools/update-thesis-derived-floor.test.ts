/**
 * update-thesis-derived-floor.test.ts — the 2:1 floor also covers a
 * triggers-only resend (DAV-241, 2026-09-09).
 *
 * `update_thesis` validated the plan only when the agent passed a price
 * argument. Moving the buy level through the trigger used to skip the
 * floor: ETN went $375 → $432 with target $490 and stop $355 kept — 0.75:1
 * stored on a watch row. Under per-trigger ops (DAV-242) the plan derived
 * from the resulting list is checked once, whichever way the level moved.
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
  getStockQuote: jest.fn().mockResolvedValue({ c: 350 }),
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
  horizonFor: () => "COMPOUNDER",
}));

import { updateThesis } from "./update-thesis";
import type { ToolContext } from "@/lib/agent/tool-context";

function makeCtx(): ToolContext {
  return {
    runId: "run_test_floor",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    groupId: (phase: string) => phase,
  } as ToolContext;
}

// ETN on the morning of 2026-09-09, before the run: 375 / 490 / 355 = 5.75:1.
function etnRow() {
  return {
    id: "thesis_etn",
    userId: "user_1",
    accountId: "account_1",
    ticker: "ETN",
    status: "WATCHING",
    direction: "LONG",
    horizon: "COMPOUNDER",
    entryPrice: 375,
    targetPrice: 490,
    stopLoss: 355,
    triggers: ladder(375),
    triggerState: {},
    researchRun: { agentConfigId: "analyst_1" },
    createdAt: new Date(Date.now() - 30 * 86_400_000),
  };
}

function ladder(buyLevel: number) {
  return [
    { id: "buy", predicate: { kind: "PRICE_ABOVE", level: buyLevel }, action: "ENTER", rationale: "Buy on a clean breakout." },
    { id: "target", predicate: { kind: "PRICE_ABOVE", level: 490 }, action: "REVIEW", rationale: "Target $490 — decide here." },
    { id: "floor", predicate: { kind: "PRICE_BELOW", level: 355 }, action: "EXIT", rationale: "Floor — sell if the price drops to $355." },
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(args: Record<string, unknown>): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = updateThesis(makeCtx()) as unknown as { execute: (a: any) => Promise<any> };
  return tool.execute(args);
}

beforeEach(() => {
  mockThesisFindUnique.mockReset();
  mockThesisUpdate.mockClear();
});

describe("update_thesis — the floor covers a buy level moved through its trigger (DAV-241)", () => {
  it("refuses a buy level moved through the trigger that leaves the plan under 2:1", async () => {
    mockThesisFindUnique.mockResolvedValue(etnRow());
    const result = await run({
      thesis_id: "thesis_etn",
      rationale: "Re-anchoring the watch to confirmation above current structure.",
      // (490 − 432) / (432 − 355) = 0.75:1
      edit_triggers: [{ id: "buy", level: 432, rationale: "Confirmation is above the repair range." }],
    });
    expect(result.data.ok).toBe(false);
    expect(result.data.error).toBe("invalid_thesis_shape");
    expect(String(result.data.message)).toContain("R/R floor");
    expect(mockThesisUpdate).not.toHaveBeenCalled();
  });

  it("lets the same resend through when the derived plan clears the floor", async () => {
    mockThesisFindUnique.mockResolvedValue(etnRow());
    const result = await run({
      thesis_id: "thesis_etn",
      rationale: "Buy the pullback a little higher; plan still 4.4:1.",
      // (490 − 380) / (380 − 355) = 4.4:1
      edit_triggers: [{ id: "buy", level: 380, rationale: "A little higher, still a clean breakout." }],
    });
    expect(result.ok).toBe(true);
    expect(mockThesisUpdate).toHaveBeenCalled();
    const data = mockThesisUpdate.mock.calls[0][0].data as { entryPrice?: number };
    expect(data.entryPrice).toBe(380);
  });
});
