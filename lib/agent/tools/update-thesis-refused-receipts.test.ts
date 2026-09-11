/**
 * update-thesis-refused-receipts.test.ts — a refused call reports no trigger
 * change as done (DAV-258).
 *
 * VST, Secular Compounder daily run, 2026-09-11 08:07:47 ET: the analyst
 * removed the $165 buy and the review cadence to set the plan down. The plan
 * check refused the whole call (floor + target left with no buy), but the
 * reply carried `{ op: "remove", ok: true, text: "Removed: buy above $165" }`.
 * The analyst believed it, removed the floor and target in its next call, and
 * VST was left with the one trigger it meant to delete.
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
  getStockQuote: jest.fn().mockResolvedValue({ c: 145 }),
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

import { notApplied, updateThesis } from "./update-thesis";
import type { ToolContext } from "@/lib/agent/tool-context";
import type { TriggerOpResult } from "@/lib/agent/triggers/ops";

const ctx = {
  runId: "cmtwwvdpn001o04jrqowvtd54",
  userId: "user_1",
  accountId: "account_1",
  analystId: "analyst_1",
  groupId: (phase: string) => phase,
} as ToolContext;

const BUY = "d7bc759b-9b9d-4416-9168-c6badc4d2fed";
const CADENCE = "7f302e18-1639-4d5d-b874-b2d54f9ef289";
const FLOOR = "11595681-ac8b-4085-9cfe-dc0e93870793";
const TARGET = "dbb4a6f5-6814-4a24-bb97-2c35bbff86c4";

// VST's ladder as it stood before the 08:07:47 call.
function vst() {
  return {
    id: "cmqb2ro9x000004jiado1yk0a",
    userId: "user_1",
    accountId: "account_1",
    ticker: "VST",
    status: "WATCHING",
    direction: "LONG",
    horizon: "COMPOUNDER",
    entryPrice: 165,
    targetPrice: 240,
    stopLoss: 132,
    coreBelief: "AI power demand re-rates contracted generation.",
    keyAssumptions: ["a", "b"],
    invalidationConds: ["c", "d"],
    conviction: "MEDIUM",
    convictionRationale: "Existing medium tier.",
    variantView: null,
    catalystDate: null,
    lastReviewedAt: null,
    researchUpdatedAt: new Date(),
    triggers: [
      { id: CADENCE, predicate: { kind: "REVIEW_CADENCE", days: 30 }, action: "REVIEW", rationale: "Monthly review.", source: "DEFAULT", cooldownDays: 7 },
      { id: BUY, predicate: { kind: "PRICE_ABOVE", level: 165 }, action: "ENTER", rationale: "Only revisit as a buy above $165.", source: "AGENT", cooldownDays: 1 },
      { id: FLOOR, predicate: { kind: "PRICE_BELOW", level: 132 }, action: "EXIT", rationale: "Floor — sell if the price drops to $132.00.", source: "DEFAULT", cooldownDays: 1 },
      { id: TARGET, predicate: { kind: "PRICE_ABOVE", level: 240 }, action: "REVIEW", rationale: "Target $240.00 — decide here.", source: "AGENT", cooldownDays: 1 },
    ],
    triggerState: {},
  };
}

async function run(args: Record<string, unknown>) {
  const tool = updateThesis(ctx) as unknown as {
    execute: (a: Record<string, unknown>) => Promise<{ data?: Record<string, unknown> }>;
  };
  return tool.execute({
    thesis_id: "cmqb2ro9x000004jiado1yk0a",
    rationale: "Setting the VST buy plan down.",
    structural_unchanged_reason: "Not buyable at my standard yet.",
    ...args,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockThesisFindUnique.mockResolvedValue(vst());
});

describe("update_thesis — a refused call claims no change (DAV-258)", () => {
  it("VST 09-11: removing only the buy is refused, and every op says it did not land", async () => {
    const result = await run({ remove_trigger_ids: [BUY, CADENCE] });
    expect(result.data?.ok).toBe(false);
    expect(result.data?.error).toBe("missing_enter_trigger");
    expect(mockThesisUpdate).not.toHaveBeenCalled();

    const ops = result.data?.trigger_ops as TriggerOpResult[];
    expect(ops.map((o) => o.id).sort()).toEqual([BUY, CADENCE].sort());
    for (const op of ops) {
      expect(op.ok).toBe(false);
      expect(op.reason).toContain("Not applied");
    }
  });

  it("the set-down the analyst meant — buy, floor and target in one call — lands", async () => {
    const result = await run({ remove_trigger_ids: [BUY, FLOOR, TARGET] });
    expect(result.data?.error).toBeUndefined();
    expect(mockThesisUpdate).toHaveBeenCalled();
  });
});

describe("notApplied", () => {
  it("flips landed-looking ops and keeps an op's own refusal reason", () => {
    const out = notApplied(
      [
        { op: "remove", id: "a", ok: true, text: "Removed: buy above $165" },
        { op: "edit", id: "b", ok: false, text: "Floor $132 → $120", reason: "Protective levels only tighten." },
      ],
      "missing_enter_trigger",
    );
    expect(out[0]).toMatchObject({ ok: false, reason: "Not applied — the whole update was refused (missing_enter_trigger)." });
    expect(out[1]).toMatchObject({ ok: false, reason: "Protective levels only tighten." });
  });
});
