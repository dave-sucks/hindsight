/**
 * update-thesis-promoted-writer.test.ts — Layer-1 backstop for the
 * thesis-writer role's research-only boundary (GAPS P0-4).
 *
 * When `ctx.runMode === "THESIS_WRITER"` and the existing thesis is
 * PROMOTED, ANY `change_status` arg is refused. Belt-and-suspenders on
 * top of the prompt-side PROMOTED branch in run-thesis-writer.ts so
 * even a model that ignores the FORBIDDEN clause can't flip status
 * from the writer. See docs/THESIS_ARCHITECTURE.md §0 (the role split).
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
    // The trigger cascade (lib/agent/triggers/load-levels) reads the
    // ANALYST + ACCOUNT levels on every update_thesis call. Empty rows
    // here ⇒ the thesis resolves against the code defaults alone, which
    // is what these role-gate tests care about.
    agentConfig: { findMany: jest.fn().mockResolvedValue([]) },
    account: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));
jest.mock("@/lib/actions/finnhub.actions", () => ({
  getStockQuote: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/agent/thesis-updates", () => ({
  writeThesisUpdate: mockWriteThesisUpdate,
  diffThesisFields: jest.fn().mockReturnValue({}),
  compactFieldChanges: jest.fn((fc: unknown) => fc),
}));

import { updateThesis } from "./update-thesis";
import type { ToolContext } from "@/lib/agent/tool-context";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    runId: "run_test_1",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    groupId: (phase: string) => phase,
    ...overrides,
  };
}

const promotedThesisRow = {
  id: "thesis_promoted_1",
  userId: "user_1",
  ticker: "NVDA",
  status: "PROMOTED",
  direction: "LONG",
  entryPrice: 100,
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
  scoring: {},
  targetPrice: 195,
  stopLoss: 180,
  targetSizePct: 5,
  horizon: "TARGET",
  catalystDate: null,
  maxHoldDays: null,
  lastReviewedAt: null,
  // Real PROMOTED rows always carry the standing ladder (stamped at mint);
  // a zero-trigger fixture would trip the unrelated zero_trigger_thesis
  // gate on the accept-path test below.
  triggers: [
    {
      id: "t1",
      condition: { type: "PRICE_ABOVE", value: 110 },
      action: "ENTER",
    },
    {
      id: "t2",
      condition: { type: "PRICE_BELOW", value: 180 },
      action: "REVIEW",
    },
  ],
};

describe("update_thesis Layer-1 backstop — THESIS_WRITER role on PROMOTED rows", () => {
  beforeEach(() => {
    mockThesisFindUnique.mockReset();
  });

  it("refuses change_status: WATCHING from runMode=THESIS_WRITER on PROMOTED thesis", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(promotedThesisRow);
    const ctx = makeCtx({ runMode: "THESIS_WRITER" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = updateThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };

    const result = await tool.execute({
      thesis_id: "thesis_promoted_1",
      rationale: "Refreshing research after promotion",
      change_status: "WATCHING",
    });

    expect(result.data.ok).toBe(false);
    expect(result.data.error).toBe("thesis_writer_cannot_change_promoted_status");
    expect(result.data.attempted).toBe("WATCHING");
    expect(result.data.current_status).toBe("PROMOTED");
    expect(result.summary).toMatch(/writer is research-only/i);
  });

  it("refuses any change_status from runMode=THESIS_WRITER on PROMOTED thesis", async () => {
    // The writer is research-only — it can't change PROMOTED status at all.
    // Only the orchestrator decides re-entry (place_trade) or defer (WATCHING).
    mockThesisFindUnique.mockResolvedValueOnce(promotedThesisRow);
    const ctx = makeCtx({ runMode: "THESIS_WRITER" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = updateThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };

    const result = await tool.execute({
      thesis_id: "thesis_promoted_1",
      rationale: "Refresh says the view broke",
      change_status: "INVALIDATED",
    });

    expect(result.data.ok).toBe(false);
    expect(result.data.error).toBe("thesis_writer_cannot_change_promoted_status");
  });

  // P1-24 contract: the tool-owned ACTIVE/CLOSED change_status verbs were
  // removed from update_thesis's input enum entirely (entering is place_trade →
  // HOLDING; exiting is close_position → RETIRED-sold). The agent can no longer
  // even express those transitions here — Zod rejects them at parse — so the
  // old runtime "status_is_tool_owned" rejection tests were dropped.

  it("ACCEPTS runMode=THESIS_WRITER on PROMOTED thesis WITHOUT change_status (research-only refresh)", async () => {
    // The legitimate writer path: refresh research, leave status alone,
    // the NEXT orchestrator run resolves PROMOTED. Before 2026-08-13 the
    // resolution gate also fired on this status-less call (undefined !==
    // "WATCHING"), which combined with the writer-role gate to make every
    // writer refresh on a PROMOTED row structurally impossible — no legal
    // call existed. See docs/plans/AGENT_PERF_COST_FIX.md §1.
    mockThesisFindUnique.mockResolvedValueOnce(promotedThesisRow);
    const ctx = makeCtx({ runMode: "THESIS_WRITER" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = updateThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };

    const result = await tool.execute({
      thesis_id: "thesis_promoted_1",
      rationale: "Research refresh; leave status to next daily run",
      core_belief: "Refreshed belief",
      key_assumptions: ["a1 refreshed", "a2 refreshed"],
      invalidation_conditions: ["i1 refreshed", "i2 refreshed"],
    });

    // Neither PROMOTED gate fires — the refresh persists.
    expect(result.data.error).not.toBe(
      "thesis_writer_cannot_change_promoted_status",
    );
    expect(result.data.error).not.toBe("promoted_thesis_requires_resolution");
    expect(result.data.ok).not.toBe(false);
    expect(mockThesisUpdate).toHaveBeenCalled();
    // The refresh must not touch status — PROMOTED persists until the
    // orchestrator acts.
    const updateArg = mockThesisUpdate.mock.calls.at(-1)?.[0];
    expect(updateArg?.data?.status).toBeUndefined();
  });

  it("still REFUSES a status-less update on PROMOTED from an orchestrator run", async () => {
    // The resolution requirement is orchestrator-scoped: a daily/tactical
    // run touching a PROMOTED thesis must resolve it (place_trade to
    // re-enter, or change_status: "WATCHING" to defer). Reasoning-only
    // patches don't count. The 2026-08-13 fix must NOT have loosened this.
    mockThesisFindUnique.mockResolvedValueOnce(promotedThesisRow);
    const ctx = makeCtx({ runMode: "MORNING_PLAN" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = updateThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };

    const result = await tool.execute({
      thesis_id: "thesis_promoted_1",
      rationale: "Just refreshing the reasoning",
      core_belief: "Patched belief",
    });

    expect(result.data.ok).toBe(false);
    expect(result.data.error).toBe("promoted_thesis_requires_resolution");
  });

  it("allows change_status: WATCHING from runMode=DAILY (orchestrator) on PROMOTED thesis", async () => {
    // Orchestrators (daily / tactical) are allowed to flip PROMOTED →
    // WATCHING. The Layer-1 writer gate must NOT fire for them.
    mockThesisFindUnique.mockResolvedValueOnce(promotedThesisRow);
    const ctx = makeCtx({ runMode: "MORNING_PLAN" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = updateThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };

    const result = await tool.execute({
      thesis_id: "thesis_promoted_1",
      rationale: "Defer live entry; re-evaluate on pullback",
      change_status: "WATCHING",
    });

    // The writer-role gate did not fire — downstream logic took over.
    expect(result.data.error).not.toBe(
      "thesis_writer_cannot_change_promoted_status",
    );
  });

  it("does not fire the writer gate on non-PROMOTED theses", async () => {
    // Sanity: a writer refreshing a WATCHING thesis still has change_status
    // available (e.g. PASS-like terminal flows are handled by other gates).
    mockThesisFindUnique.mockResolvedValueOnce({
      ...promotedThesisRow,
      status: "WATCHING",
    });
    const ctx = makeCtx({ runMode: "THESIS_WRITER" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tool = updateThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };

    const result = await tool.execute({
      thesis_id: "thesis_promoted_1",
      rationale: "Archive — name fell out of theme",
      change_status: "ARCHIVED",
    });

    // The writer-role gate is PROMOTED-scoped; on WATCHING it doesn't fire.
    expect(result.data.error).not.toBe(
      "thesis_writer_cannot_change_promoted_status",
    );
  });
});
