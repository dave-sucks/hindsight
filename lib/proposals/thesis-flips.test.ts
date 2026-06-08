/**
 * thesis-flips.test.ts — orphan-thesis revert coverage.
 *
 * Under Trade-as-Proposal, the agent flips a thesis WATCHING → ACTIVE the
 * moment it enters on an ENTER trigger and swaps the ENTER trigger for
 * HELD-side EXIT/REVIEW triggers — but the position is only
 * PENDING_APPROVAL at that point. If the buy proposal is later REJECTED or
 * EXPIRES, the Position is CANCELLED and the thesis is stranded ACTIVE with
 * no holding (an "orphan"): its ENTER trigger is gone so it can never
 * re-propose. Two live theses (IONS, XENE) hit this and were hand-cleaned.
 *
 * revertThesisToWatchingOnDecline is the inverse of promoteThesisOnApproval:
 * it restores the WATCHING shape (ENTER trigger back, HELD EXIT/TRIM dropped)
 * and writes one STATUS_CHANGED audit row. These tests pin:
 *   (a) ACTIVE thesis + no open position → reverts to WATCHING, ENTER
 *       trigger regenerated from the STORED entryPrice, one STATUS_CHANGED
 *       audit row carrying the ACTIVE→WATCHING delta.
 *   (b) ACTIVE thesis but another OPEN position exists → no-op (the thesis
 *       legitimately still holds; don't strip its HELD triggers).
 *   (c) no matching ACTIVE thesis → no-op (idempotent).
 */

// ── Prisma mock ────────────────────────────────────────────────────────────
const mockThesisFindFirst = jest.fn();
const mockThesisUpdate = jest.fn().mockResolvedValue({});
const mockPositionFindFirst = jest.fn();
const mockThesisUpdateCreate = jest.fn().mockResolvedValue({ id: "tu-1" });

jest.mock("@/lib/prisma", () => ({
  prisma: {
    thesis: {
      findFirst: mockThesisFindFirst,
      update: mockThesisUpdate,
    },
    position: {
      findFirst: mockPositionFindFirst,
    },
    thesisUpdate: {
      create: mockThesisUpdateCreate,
    },
  },
}));

import { revertThesisToWatchingOnDecline } from "./thesis-flips";
import type { Trigger } from "@/lib/agent/triggers/types";

// A LONG TARGET-horizon thesis the agent flipped to ACTIVE on its ENTER
// trigger. Its triggers array is the HELD-side set (EXIT on stop), exactly
// what promoteThesisOnApproval would have written.
const ACTIVE_THESIS = {
  id: "thesis-1",
  direction: "LONG",
  horizon: "TARGET",
  entryPrice: 50,
  targetPrice: 70,
  stopLoss: 45,
  maxHoldDays: null,
  catalystDate: null,
  triggers: [
    {
      id: "held-exit",
      predicate: { kind: "PRICE_BELOW", level: 45 },
      action: "EXIT",
      rationale: "Hard stop.",
      cooldownDays: 0,
    },
  ] as Trigger[],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockThesisFindFirst.mockResolvedValue({ ...ACTIVE_THESIS });
  // No other open position by default → revert proceeds.
  mockPositionFindFirst.mockResolvedValue(null);
});

describe("revertThesisToWatchingOnDecline", () => {
  it("reverts an ACTIVE thesis with no open position to WATCHING with an ENTER trigger restored", async () => {
    await revertThesisToWatchingOnDecline({
      analystId: "analyst-1",
      ticker: "IONS",
      positionId: "pos-1",
    });

    // Queried the most-recent ACTIVE thesis for (analyst, ticker).
    expect(mockThesisFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ticker: "IONS",
          status: "ACTIVE",
          researchRun: { agentConfigId: "analyst-1" },
        }),
        orderBy: { createdAt: "desc" },
      }),
    );

    // GUARD query excluded the just-cancelled position.
    expect(mockPositionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          analystId: "analyst-1",
          symbol: "IONS",
          status: { in: ["OPEN", "PENDING_APPROVAL"] },
          id: { not: "pos-1" },
        }),
      }),
    );

    // Flipped ACTIVE → WATCHING and persisted regenerated triggers.
    expect(mockThesisUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockThesisUpdate.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "thesis-1" });
    expect(updateArg.data.status).toBe("WATCHING");

    // The WATCHING template restored the ENTER trigger off the STORED
    // entryPrice ($50), and dropped the HELD EXIT trigger.
    const nextTriggers = updateArg.data.triggers as Trigger[];
    const enterTrigger = nextTriggers.find((t) => t.action === "ENTER");
    expect(enterTrigger).toBeDefined();
    expect(enterTrigger?.predicate).toMatchObject({
      kind: "PRICE_ABOVE",
      level: 50,
    });
    expect(nextTriggers.some((t) => t.action === "EXIT")).toBe(false);

    // Exactly one STATUS_CHANGED audit row carrying the ACTIVE→WATCHING delta.
    expect(mockThesisUpdateCreate).toHaveBeenCalledTimes(1);
    expect(mockThesisUpdateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          thesisId: "thesis-1",
          type: "STATUS_CHANGED",
          fieldChanges: {
            status: { from: "ACTIVE", to: "WATCHING" },
            triggers: { from: "HELD-set", to: "WATCHING-set" },
          },
          tradeId: "pos-1",
        }),
      }),
    );
  });

  it("no-ops when another OPEN position still exists for the ticker", async () => {
    // The GUARD finds a legitimately-held position → don't strip its triggers.
    mockPositionFindFirst.mockResolvedValue({ id: "pos-other" });

    await revertThesisToWatchingOnDecline({
      analystId: "analyst-1",
      ticker: "IONS",
      positionId: "pos-1",
    });

    // The ACTIVE thesis was looked up + the guard ran, but nothing was flipped.
    expect(mockPositionFindFirst).toHaveBeenCalledTimes(1);
    expect(mockThesisUpdate).not.toHaveBeenCalled();
    expect(mockThesisUpdateCreate).not.toHaveBeenCalled();
  });

  it("no-ops (idempotent) when there is no matching ACTIVE thesis", async () => {
    mockThesisFindFirst.mockResolvedValue(null);

    await revertThesisToWatchingOnDecline({
      analystId: "analyst-1",
      ticker: "IONS",
      positionId: "pos-1",
    });

    // Bails before the guard query and before any write.
    expect(mockPositionFindFirst).not.toHaveBeenCalled();
    expect(mockThesisUpdate).not.toHaveBeenCalled();
    expect(mockThesisUpdateCreate).not.toHaveBeenCalled();
  });
});
