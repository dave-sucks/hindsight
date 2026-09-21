/**
 * manage-position.stop-ratchet.test.ts — the stop gate reads the floor that
 * fires, not the mirror column beside it.
 *
 * `Position.stopLoss` is written by the buy, by the fill path and by the
 * thesis popover — but NOT by `update_thesis`, which is how an agent tightens
 * a stop. So every agent tightening drifts the two apart in the loose
 * direction, and a gate reading the mirror waves through a change that lowers
 * the real floor. That is the one thing this gate exists to stop (DAV-296).
 *
 * Replay from NVDA's real row: bought at $218.2259 with a hard stop at
 * $200.15 on both the thesis and the position. An agent tightens the thesis
 * floor to $215 through `update_thesis`; the mirror stays at $200.15. Then
 * `manage_position(update_targets, new_stop_loss: 201)` — a $14 loosening
 * that the old gate read as a tightening.
 */
const mockPositionFindFirst = jest.fn();
const mockThesisFindUnique = jest.fn();
const mockThesisUpdate = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    position: { findFirst: mockPositionFindFirst, count: jest.fn().mockResolvedValue(1), update: jest.fn().mockResolvedValue({}) },
    thesis: { findUnique: mockThesisFindUnique, update: mockThesisUpdate },
    order: { create: jest.fn().mockResolvedValue({ id: "ord_1" }), update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (fn) =>
      typeof fn === "function"
        ? fn({
            position: { update: jest.fn() },
            order: { update: jest.fn() },
            positionEvent: { create: jest.fn() },
            positionManagementAction: { create: jest.fn() },
            runEvent: { create: jest.fn() },
          })
        : [],
    ),
    gateRejection: { create: jest.fn().mockResolvedValue({}) },
    agentConfig: { findUnique: jest.fn().mockResolvedValue({ name: "Growth PM", enabled: true, maxPositionSize: 50000, maxPositionTotal: 200000 }) },
    account: { findUnique: jest.fn().mockResolvedValue({ setupOverrides: {} }) },
    tradeDecision: { create: jest.fn().mockResolvedValue({}) },
    positionEvent: { create: jest.fn().mockResolvedValue({}) },
    thesisUpdate: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
  },
}));
jest.mock("@/lib/alpaca", () => ({
  getAccount: jest.fn().mockResolvedValue({ buying_power: "1000000" }),
  getOrder: jest.fn(),
  getLatestPrice: jest.fn().mockResolvedValue(230),
  closePositionPartial: jest.fn(),
  placeMarketOrder: jest.fn().mockResolvedValue({ id: "alp_1", status: "accepted" }),
}));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: jest.fn().mockResolvedValue({}) }));
jest.mock("@/lib/proposals/maybe-await-approval", () => ({
  approvalRequired: jest.fn().mockResolvedValue(false),
  maybeAwaitApproval: jest.fn().mockResolvedValue(null),
  awaitingApprovalEnvelope: jest.fn().mockReturnValue({}),
  notifyProposalPending: jest.fn(),
  PROPOSAL_TTL_MS: 24 * 60 * 60 * 1000,
}));
jest.mock("@/lib/proposals/execute", () => ({ findRelatedThesisId: jest.fn().mockResolvedValue("thesis_nvda") }));
jest.mock("@/lib/agent/thesis-updates", () => ({ writeThesisUpdate: jest.fn().mockResolvedValue("tu_1") }));

import { managePosition } from "./manage-position";
import { thesisFloorStop, stopToRatchetAgainst } from "@/lib/agent/triggers/floor-in-force";
import type { ToolContext } from "@/lib/agent/tool-context";

/** NVDA's real position row, with the mirror column left where the buy put it. */
const NVDA = {
  id: "pos_nvda", userId: "user_1", analystId: "analyst_1", symbol: "NVDA",
  status: "OPEN", environment: "PAPER", direction: "LONG",
  quantity: 45, avgCost: 218.2259, targetPrice: 322, stopLoss: 200.15,
  analyst: { name: "Growth PM" },
};

/** NVDA's real ladder. `floor` is the level on its hard-stop rung. */
const ladder = (floor: number) => [
  { id: "d9c8dabf", action: "REVIEW", source: "DEFAULT", predicate: { days: 7, kind: "REVIEW_CADENCE" }, rationale: "Look at this every 7 days.", cooldownDays: 7 },
  { id: "6306936b", action: "EXIT", source: "DEFAULT", predicate: { kind: "PRICE_BELOW", level: floor }, rationale: `Hard stop at $${floor}.`, cooldownDays: 0 },
  { id: "8f58e347", action: "REVIEW", source: "DEFAULT", predicate: { kind: "PRICE_ABOVE", level: 322 }, rationale: "Target $322 hit.", cooldownDays: 1 },
  { id: "d7d37522", action: "REVIEW", source: "DEFAULT", predicate: { pct: 12, kind: "GAIN_FROM_ENTRY", direction: "DOWN" }, rationale: "Down 12% from entry.", cooldownDays: 7 },
];

const tool = () =>
  managePosition({
    runId: "run_1", userId: "user_1", accountId: "account_1", analystId: "analyst_1",
    alpacaCreds: { keyId: "k", secretKey: "s" },
    maxPositionSize: 50_000, maxPositionTotal: 200_000,
    groupId: (p: string) => p,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as ToolContext) as unknown as { execute: (a: any) => Promise<any> };

beforeEach(() => {
  mockPositionFindFirst.mockReset().mockResolvedValue(NVDA);
  mockThesisUpdate.mockReset().mockResolvedValue({});
  mockThesisFindUnique.mockReset();
});

/** The thesis the agent has already tightened; the mirror still reads $200.15. */
const tightened = { id: "thesis_nvda", direction: "LONG", status: "HOLDING", triggers: ladder(215) };

describe("the stop gate reads the thesis floor, not Position.stopLoss", () => {
  it("NVDA: floor tightened to $215, mirror still $200.15 — a move to $201 is refused", async () => {
    mockThesisFindUnique.mockResolvedValue(tightened);
    const res = await tool().execute({
      symbol: "NVDA", action: "update_targets", new_stop_loss: 201,
      reason: "Giving the position more room after the pullback held the 50-day.",
    });
    expect(res.data.success).toBe(false);
    expect(res.data.status).toBe("FAILED");
    expect(res.data.message).toContain("215.00");
    // And the thesis floor is left exactly where it was.
    expect(mockThesisUpdate).not.toHaveBeenCalled();
  });

  it("the same move is allowed when the floor really is $200.15", async () => {
    mockThesisFindUnique.mockResolvedValue({ ...tightened, triggers: ladder(200.15) });
    const res = await tool().execute({
      symbol: "NVDA", action: "update_targets", new_stop_loss: 201,
      reason: "Tightening the stop under the pullback's swing low.",
    });
    expect(res.data.success).toBe(true);
  });

  it("move_stop_to_breakeven reads the floor too — breakeven above it is a tightening and stands", async () => {
    // Breakeven ($218.2259) sits above the $215 floor, so this genuinely is a
    // tightening. The point is which number it was compared against.
    mockThesisFindUnique.mockResolvedValue(tightened);
    const res = await tool().execute({ symbol: "NVDA", action: "move_stop_to_breakeven", reason: "1R reached; taking the risk off." });
    expect(res.data.success).toBe(true);
  });

  it("move_stop_to_breakeven is refused when the floor already sits above cost", async () => {
    mockThesisFindUnique.mockResolvedValue({ ...tightened, triggers: ladder(240) });
    const res = await tool().execute({ symbol: "NVDA", action: "move_stop_to_breakeven", reason: "Taking the risk off." });
    expect(res.data.success).toBe(false);
    expect(res.data.message).toContain("240.00");
  });

  it("a stock whose thesis has no typed floor still falls back to the position column", async () => {
    mockThesisFindUnique.mockResolvedValue({ ...tightened, triggers: ladder(215).filter((t) => t.action !== "EXIT") });
    const res = await tool().execute({
      symbol: "NVDA", action: "update_targets", new_stop_loss: 190,
      reason: "Widening the stop below the base.",
    });
    expect(res.data.success).toBe(false);
    expect(res.data.message).toContain("200.15");
  });
});

describe("thesisFloorStop / stopToRatchetAgainst", () => {
  it("reads the hard stop off the ladder", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(thesisFloorStop({ triggers: ladder(215) as any, direction: "LONG", avgCost: 218.2259 })).toBe(215);
  });

  it("an empty or floorless ladder has no floor", () => {
    expect(thesisFloorStop({ triggers: [], direction: "LONG" })).toBeNull();
  });

  it("the position column only wins when there is no floor at all", () => {
    expect(stopToRatchetAgainst({ thesisFloor: 215, positionStopLoss: 200.15 })).toBe(215);
    expect(stopToRatchetAgainst({ thesisFloor: null, positionStopLoss: 200.15 })).toBe(200.15);
    expect(stopToRatchetAgainst({ thesisFloor: null, positionStopLoss: null })).toBeNull();
  });
});
