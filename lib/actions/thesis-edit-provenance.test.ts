/**
 * thesis-edit-provenance.test.ts — pins that the UI add path
 * (applyTriggerAdd) stamps `source: "PRINCIPAL"` on every trigger it mints,
 * and that the sibling edit paths (value edit, fire-mode change) do NOT
 * change an existing rung's source — editing a default's % doesn't make it
 * yours (v1 provenance rule; see TRIGGER_MODEL.md §5 gap 2).
 *
 * Prisma + writeThesisUpdate are mocked (same pattern as
 * lib/agent/tools/update-thesis-conviction-gates.test.ts).
 */

const mockThesisFindUnique = jest.fn();
const mockThesisUpdate = jest.fn().mockResolvedValue({});
const mockPositionFindFirst = jest.fn().mockResolvedValue(null);
const mockPositionUpdate = jest.fn().mockResolvedValue({});
const mockPositionEventCreate = jest.fn().mockResolvedValue({});

const txMock = {
  thesis: { update: mockThesisUpdate },
  position: { update: mockPositionUpdate },
  positionEvent: { create: mockPositionEventCreate },
};

jest.mock("@/lib/prisma", () => ({
  prisma: {
    thesis: {
      findUnique: mockThesisFindUnique,
      update: mockThesisUpdate,
    },
    position: { findFirst: mockPositionFindFirst },
    $transaction: jest.fn(async (cb: (tx: typeof txMock) => Promise<void>) =>
      cb(txMock),
    ),
  },
}));
jest.mock("@/lib/agent/thesis-updates", () => ({
  writeThesisUpdate: jest.fn().mockResolvedValue(undefined),
}));

import {
  applyTriggerAdd,
  applyTriggerValueEdit,
  applyTriggerFireModeChange,
} from "./thesis-edit";

const ctx = { accountId: "acct_1", actorUserId: "user_1" };

function makeThesisRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "thesis_1",
    ticker: "TEST",
    direction: "LONG",
    status: "WATCHING",
    accountId: "acct_1",
    userId: "user_1",
    targetPrice: 130,
    stopLoss: 90,
    triggers: [],
    researchRun: { agentConfigId: "analyst_1" },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPositionFindFirst.mockResolvedValue(null);
});

describe("applyTriggerAdd — PRINCIPAL provenance", () => {
  it("stamps source: PRINCIPAL on a UI-minted trigger", async () => {
    mockThesisFindUnique.mockResolvedValue(makeThesisRow());
    const result = await applyTriggerAdd(
      "thesis_1",
      {
        action: "ENTER",
        predicate: { kind: "PRICE_ABOVE", level: 120 },
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(result.trigger.source).toBe("PRINCIPAL");
    // ...and the persisted array carries it too.
    const persisted = mockThesisUpdate.mock.calls[0][0].data.triggers;
    expect(persisted[persisted.length - 1].source).toBe("PRINCIPAL");
  });
});

describe("edit paths do NOT change source", () => {
  const defaultStop = {
    id: "t_stop",
    predicate: { kind: "PRICE_BELOW", level: 90 },
    action: "EXIT",
    rationale: "hard stop",
    cooldownDays: 0,
    fireMode: "TACTICAL",
    source: "DEFAULT",
  };

  it("applyTriggerValueEdit keeps the rung's DEFAULT source (editing a default's level doesn't claim it)", async () => {
    mockThesisFindUnique.mockResolvedValue(
      makeThesisRow({ triggers: [defaultStop] }),
    );
    const result = await applyTriggerValueEdit("thesis_1", "t_stop", 95, ctx);
    expect(result.ok).toBe(true);
    const persisted = mockThesisUpdate.mock.calls[0][0].data.triggers;
    expect(persisted[0].source).toBe("DEFAULT");
    expect(persisted[0].predicate.level).toBe(95);
  });

  it("applyTriggerFireModeChange keeps the rung's DEFAULT source", async () => {
    mockThesisFindUnique.mockResolvedValue(
      makeThesisRow({ status: "HOLDING", triggers: [defaultStop] }),
    );
    const result = await applyTriggerFireModeChange(
      "thesis_1",
      "t_stop",
      "DIRECT",
      ctx,
    );
    expect(result.ok).toBe(true);
    const persisted = mockThesisUpdate.mock.calls[0][0].data.triggers;
    expect(persisted[0].source).toBe("DEFAULT");
    expect(persisted[0].fireMode).toBe("DIRECT");
  });
});
