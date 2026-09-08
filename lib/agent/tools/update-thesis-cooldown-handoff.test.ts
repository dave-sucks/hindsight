/**
 * update-thesis-cooldown-handoff.test.ts — DAV-232.
 *
 * SMMT 2026-09-03: the thesis-level copy of the account's "+7% in a day —
 * scale in" rung fired at 09:35:34. The tactical run resent the ladder at
 * 09:36:06 WITHOUT that rung. The account-level twin became the effective
 * rung with no `firedAt` in triggerState, and fired at 09:40:16 — a second
 * tactical run five minutes after the first. The old handoff only covered
 * rungs pruned as redundant; this pins the omitted-rung case.
 */

const mockThesisFindUnique = jest.fn();
const mockThesisUpdate = jest.fn().mockResolvedValue({});
const mockPositionFindFirst = jest.fn().mockResolvedValue(null);
const mockThesisUpdateFindFirst = jest.fn().mockResolvedValue(null);

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
  writeThesisUpdate: jest.fn().mockResolvedValue(undefined),
  diffThesisFields: jest.fn().mockReturnValue({}),
  compactFieldChanges: (fc: unknown) => fc,
}));

const ACCOUNT_SCALE_IN = {
  id: "acct-scale-in",
  action: "ADD",
  predicate: { kind: "PRICE_MOVE_PCT", pct: 7, direction: "UP", window: "1D" },
  rationale: "Up 7% in a day — scale in.",
  cooldownDays: 3,
  level: "ACCOUNT",
  inherited: true,
};
jest.mock("@/lib/agent/triggers/load-levels", () => ({
  loadLevelSources: jest.fn().mockResolvedValue(new Map([["analyst_1", { analyst: [], account: [] }]])),
  resolveThesisLadder: jest.fn().mockReturnValue([ACCOUNT_SCALE_IN]),
  parseTriggerState: (raw: unknown) => (raw && typeof raw === "object" ? (raw as Record<string, { firedAt?: string }>) : {}),
  horizonFor: () => "CATALYST",
}));

import { updateThesis } from "./update-thesis";
import type { ToolContext } from "@/lib/agent/tool-context";

const ctx = {
  runId: "run_handoff",
  userId: "user_1",
  accountId: "account_1",
  analystId: "analyst_1",
  groupId: (phase: string) => phase,
} as ToolContext;

const FIRED = "2026-09-03T13:35:09.801Z";

function smmt() {
  return {
    id: "thesis_smmt",
    userId: "user_1",
    accountId: "account_1",
    ticker: "SMMT",
    status: "HOLDING",
    direction: "LONG",
    horizon: "CATALYST",
    entryPrice: 14.35,
    targetPrice: 26,
    stopLoss: 14.35,
    coreBelief: "Ivonescimab data holds up.",
    keyAssumptions: ["a", "b"],
    invalidationConds: ["c", "d"],
    conviction: "HIGH",
    convictionRationale: "Existing.",
    variantView: "Consensus underrates the label.",
    catalystDate: null,
    lastReviewedAt: null,
    researchUpdatedAt: new Date(),
    triggers: [
      {
        id: "0e6b4b82",
        action: "ADD",
        source: "DEFAULT",
        predicate: { kind: "PRICE_MOVE_PCT", pct: 7, direction: "UP", window: "1D" },
        rationale: "Up 7% in a day — scale in.",
        cooldownDays: 3,
        lastFiredAt: FIRED,
      },
      {
        id: "floor",
        action: "EXIT",
        source: "AGENT",
        predicate: { kind: "PRICE_BELOW", level: 14.35 },
        rationale: "Floor.",
        cooldownDays: 0,
      },
    ],
    triggerState: {},
  };
}

async function run(args: Record<string, unknown>) {
  const tool = updateThesis(ctx) as unknown as {
    execute: (a: Record<string, unknown>) => Promise<{ data?: Record<string, unknown> }>;
  };
  return tool.execute({ thesis_id: "thesis_smmt", rationale: "Re-ladder after the move.", ...args });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockThesisFindUnique.mockResolvedValue(smmt());
});

describe("update_thesis — a fired rung that is omitted from the resend hands its cooldown to its inherited twin", () => {
  it("SMMT 09:36: the resend drops the scale-in; the account scale-in inherits the 09:35 stamp", async () => {
    const result = await run({
      triggers: [
        { predicate: { kind: "PRICE_BELOW", level: 14.35 }, action: "EXIT", rationale: "Floor." },
        { predicate: { kind: "PRICE_MOVE_PCT", pct: 12, direction: "UP", window: "1D" }, action: "REVIEW", rationale: "Big day." },
      ],
    });
    expect(result.data?.error).toBeUndefined();
    const data = mockThesisUpdate.mock.calls[0][0].data as { triggerState?: Record<string, { firedAt?: string }> };
    expect(data.triggerState?.["acct-scale-in"]?.firedAt).toBe(FIRED);
  });

  it("a rung that never fired hands nothing over", async () => {
    const row = smmt();
    delete (row.triggers[0] as { lastFiredAt?: string }).lastFiredAt;
    mockThesisFindUnique.mockResolvedValue(row);
    await run({
      triggers: [{ predicate: { kind: "PRICE_BELOW", level: 14.35 }, action: "EXIT", rationale: "Floor." }],
    });
    const data = mockThesisUpdate.mock.calls[0][0].data as { triggerState?: Record<string, unknown> };
    expect(data.triggerState?.["acct-scale-in"]).toBeUndefined();
  });
});
