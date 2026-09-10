/**
 * update-thesis-ratchet-gate.test.ts — the protective-level ratchet wired
 * through the real tool (DAV-185).
 *
 * The pure comparison logic is covered in lib/agent/triggers/ratchet.test.ts;
 * these tests prove the tool refuses the OP — by id, with the reason — and
 * writes no trigger change, with the MU 2026-08-18 shapes: floor lowered
 * 948 → 814, DIRECT → TACTICAL demotion, and the stop moved the wrong way.
 * Legal raises must still land. (FLIPPED 2026-09-09, DAV-242: a refused op
 * no longer sinks the call; the rest of the update lands.)
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
  // Real signature, tiny stub — the W2 plan⇒cadence stamp calls it on the
  // trigger-replace path this suite exercises.
  horizonFor: (h: string | null) =>
    h === "CATALYST" || h === "TRADE" || h === "COMPOUNDER" || h === "TARGET"
      ? h
      : "TARGET",
}));

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
    ticker: "MU",
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
    horizon: "TARGET",
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

describe("update_thesis — protective-level ratchet gate (DAV-185)", () => {
  beforeEach(() => {
    mockThesisFindUnique.mockReset();
    mockThesisUpdate.mockReset();
    mockThesisUpdate.mockResolvedValue(makeHeldRow());
  });

  it("refuses lowering the hard floor on a held stock (MU 948 → 814)", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeHeldRow());
    const result = await makeTool().execute({
      thesis_id: "thesis_held_1",
      rationale: "Recalibrating the floor to reduce alert noise.",
      edit_triggers: [{ id: "trig_floor", level: 814, rationale: "Adjusted floor." }],
    });

    const op = result.data.trigger_ops[0];
    expect(op).toMatchObject({ id: "trig_floor", ok: false });
    expect(op.reason).toContain("$948");
    noTriggerWrite();
  });

  it("refuses demoting the floor from automatic (DIRECT) to judgment-first", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeHeldRow());
    const result = await makeTool().execute({
      thesis_id: "thesis_held_1",
      rationale: "Prefer agent judgment on this exit.",
      edit_triggers: [{ id: "trig_floor", fire_mode: "TACTICAL" }],
    });

    expect(result.data.trigger_ops[0]).toMatchObject({ id: "trig_floor", ok: false });
    noTriggerWrite();
  });

  it("refuses removing the floor", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeHeldRow());
    const result = await makeTool().execute({
      thesis_id: "thesis_held_1",
      rationale: "Simplifying the ladder.",
      remove_trigger_ids: ["trig_floor"],
    });

    expect(result.data.trigger_ops[0]).toMatchObject({ op: "remove", id: "trig_floor", ok: false });
    noTriggerWrite();
  });

  it("refuses moving the stop the wrong way on a held stock — and the rest of the call lands", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeHeldRow({ stopLoss: 814 }));
    const result = await makeTool().execute({
      thesis_id: "thesis_held_1",
      rationale: "Widening the stop for volatility.",
      stop_loss: 730,
      core_belief: "The belief moved with the market.",
    });

    expect(result.data.ok).not.toBe(false);
    expect(result.data.trigger_ops[0]).toMatchObject({ ok: false, text: "Stop $948 → $730 (loosened)" });
    noTriggerWrite();
    // The belief edit still landed.
    const written = mockThesisUpdate.mock.calls.find((c) => "coreBelief" in (c[0].data as object));
    expect(written).toBeTruthy();
  });

  it("allows raising the floor (more protection) and writes the update", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeHeldRow());
    const result = await makeTool().execute({
      thesis_id: "thesis_held_1",
      rationale: "Locking in more of the gain after the run-up.",
      edit_triggers: [{ id: "trig_floor", level: 980, rationale: "Raised floor." }],
    });

    expect(result.data.ok).not.toBe(false);
    expect(result.data.trigger_ops[0]).toMatchObject({ ok: true, text: "Stop $948 → $980 (tightened)" });
    const data = mockThesisUpdate.mock.calls[0][0].data as { triggers: Array<{ id: string; predicate: { level: number } }> };
    expect(data.triggers.find((t) => t.id === "trig_floor")?.predicate.level).toBe(980);
  });

  it("allows raising the stop_loss column (the legal direction)", async () => {
    // 730 → 814, the legal half of the actual MU edit (shape gate caps a
    // LONG stop below entry, so a raise stays under entryPrice 895.94).
    // The floor TRIGGER starts at 730 too: since L3 `stop_loss` writes the
    // trigger, so a fixture whose column and trigger disagree isn't testing a
    // raise at all — it's testing a drop from whatever the trigger says.
    mockThesisFindUnique.mockResolvedValueOnce(
      makeHeldRow({ stopLoss: 730, triggers: [floorAt(730)] }),
    );
    const result = await makeTool().execute({
      thesis_id: "thesis_held_1",
      rationale: "Tightening the stop after the gain.",
      stop_loss: 814,
      structural_unchanged_reason: "Belief intact; protecting the gain.",
    });

    expect(result.data.ok).not.toBe(false);
    expect(mockThesisUpdate).toHaveBeenCalled();
  });

  it("does not gate WATCHING theses (no position to protect)", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(
      makeHeldRow({
        status: "WATCHING",
        triggers: [
          {
            id: "trig_enter",
            predicate: { kind: "PRICE_ABOVE", level: 950 },
            action: "ENTER",
            rationale: "Entry.",
          },
          FLOOR_948,
        ],
      }),
    );
    const result = await makeTool().execute({
      thesis_id: "thesis_held_1",
      rationale: "Watchlist re-plan; dropping the planned stop.",
      remove_trigger_ids: ["trig_floor"],
    });

    expect(result.data.trigger_ops[0]).toMatchObject({ id: "trig_floor", ok: true });
  });

  it("does not gate the terminal invalidation path (thesis broken → sell path handles the exit)", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(makeHeldRow());
    const result = await makeTool().execute({
      thesis_id: "thesis_held_1",
      rationale: "Core assumption disproven by the guidance cut.",
      change_status: "INVALIDATED",
    });

    expect(result.data.error).not.toBe("protective_level_locked");
  });
});
