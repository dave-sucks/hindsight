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
 *
 * Since 2026-11-16 a watch's floor is its Stop watching line and needs no
 * buy, so that call lands. A call the ladder check still refuses whole (a
 * floor edited above the buy) is the one the receipts are pinned on.
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
      { id: CADENCE, predicate: { watch: "repeat", value: 30 }, action: "REVIEW", rationale: "Monthly review.", source: "DEFAULT"},
      { id: BUY, predicate: { watch: "price", is: "above", value: 165 }, action: "ENTER", rationale: "Only revisit as a buy above $165.", source: "AGENT"},
      // The watch's floor, as the 2026-11-16 migration stores it.
      { id: FLOOR, predicate: { watch: "price", is: "below", value: 132, settings: { close: true } }, action: "STOP_WATCHING", rationale: "Floor — sell if the price drops to $132.00.", source: "DEFAULT"},
      { id: TARGET, predicate: { watch: "price", is: "above", value: 240 }, action: "REVIEW", rationale: "Target $240.00 — decide here.", source: "AGENT"},
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

/** VST as a holding: its sale, its upside review and its clock. A buy can't sit on a stock we own. */
const HELD_SALE = { id: FLOOR, predicate: { watch: "price", is: "below", value: 132 }, action: "EXIT", rationale: "Sell if below $132.", source: "AGENT"};
const held = () => ({ ...vst(), status: "HOLDING", triggers: vst().triggers.filter((t) => t.id !== BUY && t.id !== FLOOR).concat([HELD_SALE]) });
const ADD_A_BUY = { add_triggers: [{ predicate: { watch: "price", is: "above", value: 170 }, action: "ENTER", rationale: "Buy the reclaim of $170." }] };

describe("update_thesis — a refused call claims no change (DAV-258)", () => {
  it("VST 09-11: removing only the buy lands now — the floor that stays is a Stop watching line, which needs no buy", async () => {
    const result = await run({ remove_trigger_ids: [BUY, CADENCE] });
    expect(result.data?.refused_fields).toBeUndefined();
    expect((result.data?.trigger_ops as TriggerOpResult[]).every((o) => o.ok)).toBe(true);
  });

  it("a call the ladder check refuses (a buy added to a stock we own) is refused whole, and every op says it did not land", async () => {
    mockThesisFindUnique.mockResolvedValue(held());
    const result = await run({ remove_trigger_ids: [CADENCE], ...ADD_A_BUY });
    // The trigger changes are refused together; the note lands as a review.
    expect(result.data?.ok).toBe(true);
    expect(result.data?.refused_fields).toEqual([expect.objectContaining({ field: "triggers", reason: expect.stringContaining("To take them all off") })]);
    expect(mockThesisUpdate.mock.calls.every(([a]) => Object.keys(a.data).every((k) => k === "lastReviewedAt"))).toBe(true);

    const ops = result.data?.trigger_ops as TriggerOpResult[];
    expect(ops).toHaveLength(2);
    expect(ops.map((o) => o.op).sort()).toEqual(["add", "remove"]);
    for (const op of ops) {
      expect(op.ok).toBe(false);
      expect(op.reason).toContain("Not applied");
    }
  });

  it("the refusal names the exact set-down call, and following it lands", async () => {
    mockThesisFindUnique.mockResolvedValue(held());
    const refused = await run({ remove_trigger_ids: [CADENCE], ...ADD_A_BUY });
    const message = String((refused.data?.refused_fields as Array<{ field: string; reason: string }>).find((f) => f.field === "triggers")?.reason);
    expect(message).toContain("To take them all off");
    // The price lines by id, the sale among them — not the review cadence, which survives a set-down.
    const named = [...message.matchAll(/"([0-9a-f-]{36})"/g)].map((m) => m[1]);
    expect(named).toContain(FLOOR);
    expect(named).not.toContain(CADENCE);

    mockThesisUpdate.mockClear();
    const followed = await run({ remove_trigger_ids: named });
    expect(followed.data?.error).toBeUndefined();
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
