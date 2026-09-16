/**
 * update-thesis-rr-refusal-wording.test.ts — a refusal names the ops that
 * exist (DAV-262).
 *
 * MSFT, Secular Compounder daily run, 2026-09-14 08:02:40 ET: the analyst
 * re-affirmed the plan at entry $518 / target $600 / stop $448 — 1.17:1, under
 * the 2:1 floor. The refusal said "set the plan down (resend triggers with
 * the levels removed and keep a REVIEW wake)" — the whole-list `triggers`
 * argument that DAV-242 deleted. The agent recovered by guessing the ids.
 * Now the refusal names the exact `remove_trigger_ids` call.
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
  getStockQuote: jest.fn().mockResolvedValue({ c: 505 }),
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

const ctx = {
  runId: "cmtzr0yb60001v8jrs8tcm0d0",
  userId: "user_1",
  accountId: "account_1",
  analystId: "analyst_1",
  groupId: (phase: string) => phase,
} as ToolContext;

const BUY = "5f1f0d8e-6c1a-4a1c-9c3a-0e1d1c2b3a44";
const FLOOR = "9a7b6c5d-4e3f-4a2b-8c1d-0e9f8a7b6c55";
const TARGET = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e66";
const CADENCE = "1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d77";

// MSFT's ladder as it stood before the 08:02:40 call.
function msft() {
  return {
    id: "cmqmsft00000004jiado1yk0a",
    userId: "user_1",
    accountId: "account_1",
    ticker: "MSFT",
    status: "WATCHING",
    direction: "LONG",
    horizon: "COMPOUNDER",
    entryPrice: 518,
    targetPrice: 600,
    stopLoss: 448,
    coreBelief: "Azure and Copilot compound through the decade.",
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
      { id: BUY, predicate: { kind: "PRICE_ABOVE", level: 518 }, action: "ENTER", rationale: "Buy the reclaim above $518.", source: "AGENT", cooldownDays: 1 },
      { id: FLOOR, predicate: { kind: "PRICE_BELOW", level: 448 }, action: "EXIT", rationale: "Floor — sell if the price drops to $448.", source: "DEFAULT", cooldownDays: 1 },
      { id: TARGET, predicate: { kind: "PRICE_ABOVE", level: 600 }, action: "REVIEW", rationale: "Target $600 — decide here.", source: "AGENT", cooldownDays: 1 },
    ],
    triggerState: {},
  };
}

async function run(args: Record<string, unknown>) {
  const tool = updateThesis(ctx) as unknown as {
    execute: (a: Record<string, unknown>) => Promise<{ data?: Record<string, unknown> }>;
  };
  return tool.execute({
    thesis_id: "cmqmsft00000004jiado1yk0a",
    rationale: "Re-affirming the MSFT plan after the print.",
    structural_unchanged_reason: "The belief is unchanged; the levels are what moved.",
    ...args,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockThesisFindUnique.mockResolvedValue(msft());
});

describe("update_thesis — the 2:1 refusal names the ops that exist (DAV-262)", () => {
  it("MSFT 09-14: a plan under the floor is refused with remove_trigger_ids naming the buy, floor and target", async () => {
    // The stop nudged to $450 with the target left at $600: (600 − 518) / (518 − 450) = 1.21.
    const refused = await run({ stop_loss: 450 });
    expect(refused.data?.ok).toBe(false);
    expect(refused.data?.error).toBe("invalid_thesis_shape");
    expect(mockThesisUpdate).not.toHaveBeenCalled();

    const message = String(refused.data?.message);
    expect(message).toContain("1.21:1");
    expect(message).toContain("remove_trigger_ids");
    expect(message).not.toMatch(/resend triggers|triggers\[\]|pass that array|ACTIVE thesis/);
    // The set-down call names the plan's three levels by id, not the review cadence.
    const named = [...message.matchAll(/"([0-9a-f-]{36})"/g)].map((m) => m[1]);
    expect(named.sort()).toEqual([BUY, FLOOR, TARGET].sort());
  });

  it("following the named set-down lands", async () => {
    const followed = await run({ remove_trigger_ids: [BUY, FLOOR, TARGET] });
    expect(followed.data?.error).toBeUndefined();
    expect(mockThesisUpdate).toHaveBeenCalled();
  });
});
