/**
 * record-thesis-cadence-stamp.test.ts — the W1 cadence opt-in stamp
 * (DAV-216, docs/plans/WATCHLIST_STATES.md §3 invariant 2).
 *
 * WATCHING theses no longer inherit the account's review cadence — a watch
 * item is reviewed iff it carries its own REVIEW_CADENCE rung. Every
 * directional mint through record_thesis — priced or not — must be watched,
 * so the tool stamps the horizon's cadence unless the agent supplied one.
 * These tests pin that stamp: without it, every new discovery dispatch is
 * born silently unreviewed. (The soft watch, direction PASS, is W2.)
 */

const mockPositionFindFirst = jest.fn().mockResolvedValue(null);
const mockAnalystSignalRouteFindMany = jest.fn().mockResolvedValue([]);
const mockThesisCount = jest.fn().mockResolvedValue(0);
const mockThesisFindFirst = jest.fn().mockResolvedValue(null);
const mockThesisUpdateFindFirst = jest.fn().mockResolvedValue(null);
const mockThesisUpdateCreate = jest.fn().mockResolvedValue({ id: "tu_1" });
const mockAgentConfigFindFirst = jest.fn().mockResolvedValue({
  id: "analyst_1",
  enabled: true,
  archetype: "GROWTH",
  holdDurations: ["DAY", "SWING", "POSITION"],
});
const mockThesisCreate = jest.fn().mockResolvedValue({ id: "thesis_new_1" });
const mockThesisUpdate = jest.fn().mockResolvedValue({});

jest.mock("@/lib/prisma", () => ({
  prisma: {
    position: { findFirst: mockPositionFindFirst },
    analystSignalRoute: { findMany: mockAnalystSignalRouteFindMany },
    thesis: {
      count: mockThesisCount,
      findFirst: mockThesisFindFirst,
      create: mockThesisCreate,
      update: mockThesisUpdate,
    },
    thesisUpdate: {
      findFirst: mockThesisUpdateFindFirst,
      create: mockThesisUpdateCreate,
    },
    agentConfig: { findFirst: mockAgentConfigFindFirst },
    runEvent: { create: jest.fn().mockResolvedValue({}) },
  },
}));

import { recordThesis } from "./record-thesis";
import type { ToolContext } from "@/lib/agent/tool-context";
import type { Trigger } from "@/lib/agent/triggers/types";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    runId: "run_test_cadence",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    groupId: (phase: string) => phase,
    ...overrides,
  };
}

function baseLongArgs(overrides: Record<string, unknown> = {}) {
  return {
    ticker: "ANET",
    direction: "LONG",
    horizon: "TARGET",
    entry_price: 186,
    target_price: 215,
    stop_loss: 172,
    core_belief: "ANET drifts to $215 within 60 days of the Q2 print.",
    key_assumptions: ["Estimate revisions continue.", "No guidance walk-back."],
    invalidation_conditions: ["Guidance cut.", "Close below $170."],
    source_kind: "WEB_SEARCH",
    source_rationale: "Discovery batch.",
    conviction: "MEDIUM",
    conviction_rationale: "Clean beat-and-raise drift setup.",
    target_size_pct: 5,
    scoring: {
      trendStrength: { score: 2, note: "Above both SMAs." },
      relativeStrength: { score: 2, note: "Mid-cohort RS." },
      entryQuality: { score: 2, note: "Near the pivot." },
      catalystFreshness: { score: 2, note: "Fresh print." },
    },
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(args: Record<string, unknown>): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = recordThesis(makeCtx()) as unknown as { execute: (a: any) => Promise<any> };
  return tool.execute(args);
}

function createdTriggers(): Trigger[] {
  expect(mockThesisCreate).toHaveBeenCalled();
  const data = mockThesisCreate.mock.calls[0][0].data as { triggers: Trigger[] };
  return data.triggers ?? [];
}

beforeEach(() => {
  mockThesisCreate.mockClear();
  mockThesisFindFirst.mockResolvedValue(null);
});

describe("record_thesis — WATCHING cadence opt-in stamp (W1, DAV-216)", () => {
  it("stamps the horizon cadence on a directional mint with none supplied", async () => {
    const result = await run(baseLongArgs());
    expect(result.ok).toBe(true);

    const cadences = createdTriggers().filter(
      (t) => t.predicate.kind === "REVIEW_CADENCE",
    );
    expect(cadences).toHaveLength(1);
    // TARGET horizon → 7 days, matching CADENCE_DAYS_BY_HORIZON.
    expect(cadences[0].predicate).toEqual({ kind: "REVIEW_CADENCE", days: 7 });
    // A template default, not an agent-authored rung.
    expect(cadences[0].source).toBe("DEFAULT");
  });

  it("uses the horizon's own clock — CATALYST stamps daily", async () => {
    const result = await run(
      baseLongArgs({ horizon: "CATALYST", catalyst_date: "2026-09-30T00:00:00.000Z" }),
    );
    expect(result.ok).toBe(true);

    const cadences = createdTriggers().filter(
      (t) => t.predicate.kind === "REVIEW_CADENCE",
    );
    expect(cadences).toHaveLength(1);
    expect(cadences[0].predicate).toEqual({ kind: "REVIEW_CADENCE", days: 1 });
  });

  it("does not duplicate an agent-supplied cadence — the opt-in wins", async () => {
    const result = await run(
      baseLongArgs({
        triggers: [
          {
            id: "agent-cadence",
            predicate: { kind: "REVIEW_CADENCE", days: 14 },
            action: "REVIEW",
            rationale: "Slow-moving drift; every two weeks is enough.",
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);

    const cadences = createdTriggers().filter(
      (t) => t.predicate.kind === "REVIEW_CADENCE",
    );
    expect(cadences).toHaveLength(1);
    expect(cadences[0].predicate).toEqual({ kind: "REVIEW_CADENCE", days: 14 });
    expect(cadences[0].source).toBe("AGENT");
  });

  it("PASS theses stay trigger-free — terminal rows get no clock", async () => {
    const result = await run({
      ticker: "ACN",
      direction: "PASS",
      reasoning_summary:
        "Sub-5% historical beats and bearish structure; does not fit the drift book right now.",
      source_kind: "WEB_SEARCH",
      source_rationale: "Discovery batch.",
    });
    expect(result.ok).toBe(true);
    expect(createdTriggers()).toEqual([]);
  });
});

describe("record_thesis — a directional view with no entry yet (unpriced LONG)", () => {
  it("mints WATCHING/LONG with no levels: cadence wake stamped, no ENTER rung, no refusal", async () => {
    // BMRN's dispatch note: "entry window opens January 2027". This shape
    // used to be unwritable, so the writer parked the buy level on today's
    // quote. The persist path admits the set-down state (no plan level,
    // ≥1 REVIEW wake) — this pins that a mint can be born in it.
    const result = await run(
      baseLongArgs({
        entry_price: undefined,
        target_price: undefined,
        stop_loss: undefined,
        horizon: "CATALYST",
        catalyst_date: "2027-01-15T00:00:00.000Z",
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.data?.thesis_id).toBe("thesis_new_1");
    const triggers = createdTriggers();
    expect(triggers.some((t) => t.action === "ENTER")).toBe(false);
    expect(triggers.some((t) => t.action === "REVIEW")).toBe(true);
    const data = mockThesisCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.status).toBe("WATCHING");
    expect(data.direction).toBe("LONG");
    expect(data.entryPrice ?? null).toBeNull();
  });
});
