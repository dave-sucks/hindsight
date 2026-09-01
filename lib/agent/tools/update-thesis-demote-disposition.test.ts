/**
 * update-thesis-demote-disposition.test.ts — the §5 demote verdict
 * (DAV-224, WATCHLIST_STATES.md §5).
 *
 * A review may conclude "set the plan down": resend `triggers` with the
 * plan levels AND the review clock removed, keeping ≥1 REVIEW-action wake.
 * Two things used to silently block that exact edit:
 *
 *   1. the plan ⇒ cadence stamp keyed on DIRECTION, so any directional
 *      resend without a REVIEW_CADENCE was re-clocked — even one whose
 *      whole point was removing the clock. It now keys on the PLAN
 *      (isPlanLevel on the final ladder, or a level arg on the call).
 *   2. the enter-guard refused any directional WATCHING array without an
 *      ENTER. It now admits the set-down shape (no plan level, ≥1 REVIEW
 *      wake) — the same state the automatic DEMOTE fire already produces.
 *
 * Invariant 2 (plan ⇒ cadence) must be UNCHANGED for any resend whose
 * ladder still carries a plan — those cases stay pinned in
 * update-thesis-cadence-stamp.test.ts and are re-pinned here from the
 * level-arg side.
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
    runId: "run_test_demote",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    groupId: (phase: string) => phase,
  } as ToolContext;
}

const planTriggers: Trigger[] = [
  {
    id: "enter-1",
    predicate: { kind: "PRICE_ABOVE", level: 190 },
    action: "ENTER",
    rationale: "Breakout entry.",
    source: "AGENT",
  },
  {
    id: "floor-1",
    predicate: { kind: "PRICE_BELOW", level: 172 },
    action: "EXIT",
    rationale: "Below this the setup is wrong.",
    source: "AGENT",
  },
  {
    id: "clock-1",
    predicate: { kind: "REVIEW_CADENCE", days: 7 },
    action: "REVIEW",
    rationale: "Weekly while the plan is live.",
    source: "AGENT",
  },
];

const wakeTriggers = [
  {
    id: "wake-pullback",
    predicate: { kind: "PRICE_BELOW", level: 160 },
    action: "REVIEW",
    rationale: "Interesting again on the pullback.",
  },
  {
    id: "wake-earnings",
    predicate: { kind: "EARNINGS_BEAT" },
    action: "REVIEW",
    rationale: "A beat re-opens the question.",
  },
];

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "thesis_demote_1",
    userId: "user_1",
    accountId: "account_1",
    ticker: "HWM",
    status: "WATCHING",
    direction: "LONG",
    horizon: "TARGET",
    entryPrice: 186,
    targetPrice: 215,
    stopLoss: 172,
    triggers: planTriggers,
    triggerState: {},
    researchRun: { agentConfigId: "analyst_1" },
    createdAt: new Date(Date.now() - 30 * 86_400_000),
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(args: Record<string, unknown>): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = updateThesis(makeCtx()) as unknown as { execute: (a: any) => Promise<any> };
  return tool.execute(args);
}

function patchedData(): Record<string, unknown> {
  expect(mockThesisUpdate).toHaveBeenCalled();
  return mockThesisUpdate.mock.calls[0][0].data as Record<string, unknown>;
}

beforeEach(() => {
  mockThesisFindUnique.mockReset();
  mockThesisUpdate.mockClear();
});

describe("update_thesis — the demote disposition (DAV-224)", () => {
  it("a wakes-only resend on a priced directional watch goes through: no re-clock, columns clear, direction kept", async () => {
    mockThesisFindUnique.mockResolvedValue(makeRow());
    const result = await run({
      thesis_id: "thesis_demote_1",
      rationale:
        "Four weekly reviews with nothing to say — setting the plan down. Wake on the pullback to $160 or the next beat.",
      triggers: wakeTriggers,
    });
    expect(result.data?.error).toBeUndefined();

    const data = patchedData();
    const triggers = (data.triggers ?? []) as Trigger[];
    // The clock the agent removed stays removed — no silent re-stamp.
    expect(triggers.some((t) => t.predicate.kind === "REVIEW_CADENCE")).toBe(
      false,
    );
    // The wakes survive.
    expect(triggers.filter((t) => t.action === "REVIEW")).toHaveLength(2);
    // Derive-on-write clears the cached plan columns with the plan.
    expect(data.targetPrice).toBeNull();
    expect(data.stopLoss).toBeNull();
    expect(data.entryPrice).toBeNull();
    // Not a direction change — the analyst's stance stays on record.
    expect(data.direction).toBeUndefined();
  });

  it("keeping the plan while dropping the clock is legal — the two are independent", async () => {
    // Was pinned the other way ("plan ⇒ cadence"). The principal deleted
    // that invariant 2026-08-30: a buy level, a target and a floor cost
    // nothing standing, so keeping them while stopping the weekly review
    // is the ordinary case, not a violation.
    mockThesisFindUnique.mockResolvedValue(makeRow());
    const result = await run({
      thesis_id: "thesis_demote_1",
      rationale: "Levels stand; stopping the weekly review.",
      triggers: planTriggers.filter(
        (t) => t.predicate.kind !== "REVIEW_CADENCE",
      ),
    });
    expect(result.data?.error).toBeUndefined();
    const triggers = (patchedData().triggers ?? []) as Trigger[];
    expect(triggers.some((t) => t.predicate.kind === "REVIEW_CADENCE")).toBe(
      false,
    );
    // The plan is untouched — entry and floor both survive.
    expect(triggers.some((t) => t.action === "ENTER")).toBe(true);
    expect(triggers.some((t) => t.action === "EXIT")).toBe(true);
  });

  it("setting a price level does not drag a review clock along with it", async () => {
    // Re-anchoring a buy level is a levels decision. It says nothing about
    // how often a human-equivalent analyst wants to re-read the name.
    mockThesisFindUnique.mockResolvedValue(makeRow());
    const result = await run({
      thesis_id: "thesis_demote_1",
      rationale: "Re-anchored the buy level; still not reviewing weekly.",
      triggers: wakeTriggers,
      entry_price: 165,
    });
    expect(result.data?.error).toBeUndefined();
    const triggers = (patchedData().triggers ?? []) as Trigger[];
    expect(triggers.some((t) => t.predicate.kind === "REVIEW_CADENCE")).toBe(
      false,
    );
  });

  it("an empty resend on a directional watch is still refused — demote keeps a wake, inert stays illegal", async () => {
    mockThesisFindUnique.mockResolvedValue(makeRow());
    const result = await run({
      thesis_id: "thesis_demote_1",
      rationale: "Clearing everything.",
      triggers: [],
    });
    // ToolResult envelope: the CALL succeeds, the payload carries the refusal.
    expect(result.data?.ok).toBe(false);
    expect(result.data?.error).toBe("missing_enter_trigger");
    expect(mockThesisUpdate).not.toHaveBeenCalled();
  });

  it("promote: a soft watch commits to a full plan through the direction path", async () => {
    mockThesisFindUnique.mockResolvedValue(
      makeRow({
        direction: null,
        entryPrice: null,
        targetPrice: null,
        stopLoss: null,
        horizon: null,
        triggers: [
          {
            id: "wake-0",
            predicate: { kind: "PRICE_BELOW", level: 160 },
            action: "REVIEW",
            rationale: "Original wake.",
            source: "AGENT",
          },
        ],
      }),
    );
    const result = await run({
      thesis_id: "thesis_demote_1",
      direction: "LONG",
      horizon: "TARGET",
      entry_price: 165,
      target_price: 210,
      stop_loss: 150,
      core_belief: "Aerospace cycle demand outruns supply through 2027.",
      key_assumptions: [
        "Build rates keep rising into 2027.",
        "Pricing power holds through supplier negotiations.",
      ],
      invalidation_conditions: [
        "Build-rate cuts at either major airframer.",
        "Two quarters of margin compression.",
      ],
      conviction: "MEDIUM",
      conviction_rationale: "Setup confirmed by the wake, sizing standard.",
      target_size_pct: 5,
      rationale: "The wake fired and the setup is now worth a full plan.",
    });
    expect(result.data?.error).toBeUndefined();
    const data = patchedData();
    expect(data.direction).toBe("LONG");
    // Committing a plan puts it on a clock (plan ⇒ cadence).
    const triggers = (data.triggers ?? []) as Trigger[];
    expect(triggers.some((t) => t.action === "ENTER")).toBe(true);
  });
});
