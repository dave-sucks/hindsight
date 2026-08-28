/**
 * update-thesis-cadence-stamp.test.ts — plan ⇒ cadence on the update path
 * (W2, DAV-209 invariant 2).
 *
 * WATCHING no longer inherits the account review cadence (W1), and
 * `update_thesis.triggers` is wholesale-replace — so a replace that omits
 * the cadence rung would silently take a committed watch off the review
 * clock ("reviews stop, no error"). The tool re-stamps the horizon cadence
 * on directional WATCHING rows. Direction-null rows (seeds, soft watches)
 * are exempt: a soft watch being cadence-free is the point.
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
  horizonFor: (h: string | null) =>
    h === "CATALYST" || h === "TRADE" || h === "COMPOUNDER" || h === "TARGET"
      ? h
      : "TARGET",
}));

import { updateThesis } from "./update-thesis";
import type { ToolContext } from "@/lib/agent/tool-context";
import type { Trigger } from "@/lib/agent/triggers/types";

function makeCtx(): ToolContext {
  return {
    runId: "run_test_stamp",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    groupId: (phase: string) => phase,
  } as ToolContext;
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "thesis_stamp_1",
    userId: "user_1",
    accountId: "account_1",
    ticker: "ANET",
    status: "WATCHING",
    direction: "LONG",
    horizon: "COMPOUNDER",
    entryPrice: 186,
    targetPrice: 215,
    stopLoss: 172,
    triggers: [],
    triggerState: {},
    researchRun: { agentConfigId: "analyst_1" },
    createdAt: new Date(Date.now() - 30 * 86_400_000),
    ...overrides,
  };
}

const enterTrigger = {
  id: "enter-1",
  predicate: { kind: "PRICE_ABOVE", level: 190 },
  action: "ENTER",
  rationale: "Breakout confirmation.",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(args: Record<string, unknown>): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = updateThesis(makeCtx()) as unknown as { execute: (a: any) => Promise<any> };
  return tool.execute(args);
}

function patchedTriggers(): Trigger[] {
  expect(mockThesisUpdate).toHaveBeenCalled();
  const data = mockThesisUpdate.mock.calls[0][0].data as { triggers?: Trigger[] };
  return data.triggers ?? [];
}

beforeEach(() => {
  mockThesisFindUnique.mockReset();
  mockThesisUpdate.mockClear();
});

describe("update_thesis — plan ⇒ cadence stamp (W2, DAV-209)", () => {
  it("re-stamps the horizon cadence when a replace omits it on a directional watch", async () => {
    mockThesisFindUnique.mockResolvedValue(makeRow());
    const result = await run({
      thesis_id: "thesis_stamp_1",
      rationale: "Re-anchoring the entry after the pullback.",
      triggers: [enterTrigger],
    });
    expect(result.ok).toBe(true);

    const cadences = patchedTriggers().filter(
      (t) => t.predicate.kind === "REVIEW_CADENCE",
    );
    expect(cadences).toHaveLength(1);
    // COMPOUNDER horizon → 30 days.
    expect(cadences[0].predicate).toEqual({ kind: "REVIEW_CADENCE", days: 30 });
    expect(cadences[0].source).toBe("DEFAULT");
  });

  it("respects an agent-supplied cadence — no duplicate stamp", async () => {
    mockThesisFindUnique.mockResolvedValue(makeRow());
    const result = await run({
      thesis_id: "thesis_stamp_1",
      rationale: "Slowing the clock deliberately.",
      triggers: [
        enterTrigger,
        {
          id: "own-clock",
          predicate: { kind: "REVIEW_CADENCE", days: 14 },
          action: "REVIEW",
          rationale: "Every two weeks is enough here.",
        },
      ],
    });
    expect(result.ok).toBe(true);

    const cadences = patchedTriggers().filter(
      (t) => t.predicate.kind === "REVIEW_CADENCE",
    );
    expect(cadences).toHaveLength(1);
    expect(cadences[0].predicate).toEqual({ kind: "REVIEW_CADENCE", days: 14 });
  });

  it("does not stamp a direction-null row — a soft watch stays cadence-free", async () => {
    mockThesisFindUnique.mockResolvedValue(
      makeRow({
        direction: null,
        entryPrice: null,
        targetPrice: null,
        stopLoss: null,
        // A real soft watch: the mint gate guarantees ≥1 AGENT-authored
        // wake — which is also what lets update_thesis distinguish it
        // from an unresearched seed and allow trigger-only edits.
        triggers: [
          {
            id: "wake-0",
            predicate: { kind: "PRICE_BELOW", level: 160 },
            action: "REVIEW",
            rationale: "Original wake level.",
            source: "AGENT",
          },
        ],
      }),
    );
    const result = await run({
      thesis_id: "thesis_stamp_1",
      rationale: "Refreshing the wake level.",
      triggers: [
        {
          id: "wake-1",
          predicate: { kind: "PRICE_BELOW", level: 150 },
          action: "REVIEW",
          rationale: "Interesting again down here.",
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(
      patchedTriggers().some((t) => t.predicate.kind === "REVIEW_CADENCE"),
    ).toBe(false);
  });

  it("does not stamp a HOLDING row — positions inherit the account floor", async () => {
    mockThesisFindUnique.mockResolvedValue(makeRow({ status: "HOLDING" }));
    const result = await run({
      thesis_id: "thesis_stamp_1",
      rationale: "Tightening the floor.",
      triggers: [
        {
          id: "floor-1",
          predicate: { kind: "PRICE_BELOW", level: 180 },
          action: "EXIT",
          rationale: "Raised floor after the gain.",
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(
      patchedTriggers().some((t) => t.predicate.kind === "REVIEW_CADENCE"),
    ).toBe(false);
  });
});
