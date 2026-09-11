/**
 * update-thesis-horizon-change.test.ts — a held stock inherits its
 * horizon's sell rules (DAV-250), so moving it TRADE → COMPOUNDER would
 * loosen an 8% sell to 25% without touching a trigger. The tool keeps every
 * inherited sell line the new horizon loosens, on the thesis, at today's
 * value — the horizon still changes.
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
jest.mock("@/lib/agent/triggers/load-levels", () => {
  const actual = jest.requireActual("@/lib/agent/triggers/load-levels");
  const { horizonStandingRules } = jest.requireActual("@/lib/agent/triggers/defaults");
  return {
    ...actual,
    loadLevelSources: jest.fn().mockResolvedValue(
      new Map([["analyst_1", { analyst: [], account: horizonStandingRules() }]]),
    ),
  };
});

import { updateThesis } from "./update-thesis";
import type { ToolContext } from "@/lib/agent/tool-context";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    runId: "run_test_ratchet",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    groupId: (phase: string) => phase,
    ...overrides,
  } as ToolContext;
}

const FLOOR_948 = floorAt(948);

/**
 * The protective floor, as a trigger. Since L3 the `stopLoss` COLUMN is
 * derived from this, so a fixture must set both together or it encodes the
 * very drift the project removes — a column saying one thing and the trigger
 * that actually fires saying another.
 */
function floorAt(level: number) {
  return {
    id: "trig_floor",
    predicate: { kind: "PRICE_BELOW", level },
    action: "EXIT",
    rationale: "Hard floor.",
    fireMode: "DIRECT",
  };
}

/** A held (HOLDING) LONG row carrying the protective floor. */
function makeHeldRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "thesis_held_1",
    userId: "user_1",
    ticker: "CRDO",
    status: "HOLDING",
    direction: "LONG",
    entryPrice: 895.94,
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
    targetPrice: 1100,
    stopLoss: 948,
    conviction: "MEDIUM",
    convictionRationale: "Existing medium tier.",
    variantView: null,
    horizon: "TRADE",
    catalystDate: null,
    maxHoldDays: null,
    lastReviewedAt: null,
    triggers: [FLOOR_948],
    triggerState: {},
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

/** No trigger change reached the database. */
function noTriggerWrite() {
  expect(
    mockThesisUpdate.mock.calls.every(
      (c) => (c[0].data as Record<string, unknown>).triggers === undefined,
    ),
  ).toBe(true);
}

describe("update_thesis — a horizon change on a held stock keeps its sell lines", () => {
  beforeEach(() => {
    mockThesisFindUnique.mockReset();
    mockThesisUpdate.mockReset();
    mockThesisUpdate.mockResolvedValue(makeHeldRow());
  });

  it("TRADE → COMPOUNDER: the inherited 8% trail and −7% sell are kept on the thesis", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeHeldRow());
    const result = await makeTool().execute({
      thesis_id: "thesis_held_1",
      rationale: "The trade became a multi-year story.",
      horizon: "COMPOUNDER",
    });

    expect(result.data.ok).not.toBe(false);
    const write = mockThesisUpdate.mock.calls.find((c) => (c[0].data as Record<string, unknown>).triggers);
    const triggers = (write![0].data as { triggers: Array<{ action: string; predicate: Record<string, unknown> }> }).triggers;
    expect(triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "EXIT", predicate: { kind: "TRAILING_FROM_HIGH", pct: 8 } }),
        expect.objectContaining({ action: "EXIT", predicate: { kind: "GAIN_FROM_ENTRY", pct: 7, direction: "DOWN" } }),
      ]),
    );
    // The horizon itself still moved.
    expect(mockThesisUpdate.mock.calls.some((c) => (c[0].data as { horizon?: string }).horizon === "COMPOUNDER")).toBe(true);
  });

  it("a horizon change that tightens adds nothing", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeHeldRow({ horizon: "COMPOUNDER" }));
    await makeTool().execute({
      thesis_id: "thesis_held_1",
      rationale: "Moat eroding — shorter leash.",
      horizon: "TRADE",
    });
    const write = mockThesisUpdate.mock.calls.find((c) => (c[0].data as Record<string, unknown>).triggers);
    expect(write).toBeUndefined();
  });

  it("a watched stock's horizon change adds nothing (sell rules are position-scoped)", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeHeldRow({ status: "WATCHING" }));
    await makeTool().execute({
      thesis_id: "thesis_held_1",
      rationale: "Re-scoped.",
      horizon: "COMPOUNDER",
    });
    const write = mockThesisUpdate.mock.calls.find((c) => (c[0].data as Record<string, unknown>).triggers);
    expect(write).toBeUndefined();
  });
});
