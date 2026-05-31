/**
 * record-thesis-conviction-gates.test.ts — Layer-1 gates for the
 * Conviction Expression v4 writer-side fields.
 *
 * Covers:
 *   • Field-presence gates (required-when-directional):
 *     - conviction tier required on LONG/SHORT
 *     - conviction_rationale required whenever conviction set
 *     - variant_view required for STRONG/HIGH
 *     - target_size_pct required on LONG/SHORT
 *   • Consistency gates (§3.5):
 *     - Gate A: STRONG requires composite ≥ 7
 *     - Gate B: STRONG/HIGH require entryQuality.score ≥ 2
 *   • PASS theses bypass conviction gates entirely
 *
 * See docs/plans/CONVICTION_EXPRESSION.md §3, §3.5.
 */

const mockPositionFindFirst = jest.fn().mockResolvedValue(null);
const mockAnalystSignalRouteFindMany = jest.fn().mockResolvedValue([]);
const mockThesisCount = jest.fn().mockResolvedValue(0);
const mockThesisFindFirst = jest.fn().mockResolvedValue(null);
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
    agentConfig: { findFirst: mockAgentConfigFindFirst },
  },
}));

import { recordThesis } from "./record-thesis";
import type { ToolContext } from "@/lib/agent/tool-context";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    runId: "run_test_conviction",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    groupId: (phase: string) => phase,
    ...overrides,
  };
}

/**
 * Minimal valid LONG record_thesis args. Includes all the structural
 * fields the earlier gates require so the call reaches the conviction
 * gates. Override the conviction-related fields per test.
 */
function baseLongArgs(overrides: Record<string, unknown> = {}) {
  return {
    ticker: "TEST",
    direction: "LONG",
    horizon: "TARGET",
    entry_price: 100,
    target_price: 120,
    stop_loss: 92,
    core_belief: "TEST reaches 120 within 60 days on sustained beat-and-raise.",
    key_assumptions: ["Demand growth holds through next print.", "Margins stable above 35%."],
    invalidation_conditions: ["Guidance cut on next print.", "Gross margin below 30%."],
    source_kind: "WATCHLIST_REVIEW",
    source_rationale: "Reviewed during watchlist sweep; setup tightened.",
    scoring: {
      trendStrength: { score: 3, note: "Multi-week uptrend, rising 20d/50d." },
      relativeStrength: { score: 2, note: "Mid-cohort RS." },
      entryQuality: { score: 2, note: "Clean breakout pullback." },
      catalystFreshness: { score: 1, note: "Catalyst already played." },
    },
    ...overrides,
  };
}

describe("record_thesis — Conviction Expression v4 Layer-1 gates", () => {
  beforeEach(() => {
    mockPositionFindFirst.mockClear();
    mockThesisCreate.mockClear();
  });

  describe("field-presence gates", () => {
    it("rejects LONG without conviction", async () => {
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = recordThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute(baseLongArgs({ target_size_pct: 4 }));

      expect(result.data.status).toBe("FAILED");
      expect(result.summary).toMatch(/conviction tier required/i);
      expect(mockThesisCreate).not.toHaveBeenCalled();
    });

    it("rejects LONG with conviction but no conviction_rationale", async () => {
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = recordThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute(
        baseLongArgs({
          conviction: "MEDIUM",
          target_size_pct: 2,
          // conviction_rationale missing
        }),
      );

      expect(result.data.status).toBe("FAILED");
      expect(result.summary).toMatch(/conviction_rationale required/i);
      expect(mockThesisCreate).not.toHaveBeenCalled();
    });

    it("rejects STRONG without variant_view", async () => {
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = recordThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute(
        baseLongArgs({
          conviction: "STRONG",
          conviction_rationale: "Composite 8, R/R 3:1, clear edge.",
          target_size_pct: 5,
          scoring: {
            trendStrength: { score: 3, note: "ok" },
            relativeStrength: { score: 3, note: "ok" },
            entryQuality: { score: 2, note: "ok" },
            catalystFreshness: { score: 0, note: "ok" },
          },
          // variant_view missing
        }),
      );

      expect(result.data.status).toBe("FAILED");
      expect(result.summary).toMatch(/STRONG conviction requires variant_view/i);
      expect(mockThesisCreate).not.toHaveBeenCalled();
    });

    it("rejects HIGH without variant_view", async () => {
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = recordThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute(
        baseLongArgs({
          conviction: "HIGH",
          conviction_rationale: "Composite 7, R/R 2.6:1.",
          target_size_pct: 4,
          // variant_view missing
        }),
      );

      expect(result.data.status).toBe("FAILED");
      expect(result.summary).toMatch(/HIGH conviction requires variant_view/i);
    });

    it("does NOT require variant_view for MEDIUM", async () => {
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = recordThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute(
        baseLongArgs({
          conviction: "MEDIUM",
          conviction_rationale: "Decent setup, no edge.",
          target_size_pct: 2,
          // variant_view intentionally omitted — should be allowed
        }),
      );

      // The conviction gates pass — call proceeds past Gate B. Downstream
      // logic (triggers, persistence) may or may not succeed in this mock,
      // but the key invariant is the conviction-specific gates did NOT fire.
      expect(result.summary).not.toMatch(/variant_view/i);
    });

    it("rejects LONG without target_size_pct (promoted-to-required)", async () => {
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = recordThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute(
        baseLongArgs({
          conviction: "MEDIUM",
          conviction_rationale: "Decent setup.",
          // target_size_pct missing
        }),
      );

      expect(result.data.status).toBe("FAILED");
      expect(result.summary).toMatch(/target_size_pct required/i);
    });
  });

  describe("consistency gates (§3.5)", () => {
    it("Gate A: rejects STRONG when composite < 7", async () => {
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = recordThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute(
        baseLongArgs({
          conviction: "STRONG",
          conviction_rationale: "Trying to claim STRONG.",
          variant_view: "Some edge.",
          target_size_pct: 5,
          scoring: {
            trendStrength: { score: 2, note: "ok" },
            relativeStrength: { score: 1, note: "ok" },
            entryQuality: { score: 2, note: "ok" },
            catalystFreshness: { score: 1, note: "ok" },
            // composite computed = 2+1+2+1 = 6 (below 7)
          },
        }),
      );

      expect(result.data.status).toBe("FAILED");
      expect(result.summary).toMatch(/STRONG conviction requires composite ≥ 7/);
      expect(result.summary).toMatch(/current: 6/i);
    });

    it("Gate A: ALLOWS STRONG when composite = 7", async () => {
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = recordThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute(
        baseLongArgs({
          conviction: "STRONG",
          conviction_rationale: "Just at threshold.",
          variant_view: "Edge.",
          target_size_pct: 5,
          scoring: {
            trendStrength: { score: 3, note: "ok" },
            relativeStrength: { score: 0, note: "ok" },
            entryQuality: { score: 2, note: "ok" },
            catalystFreshness: { score: 2, note: "ok" },
            // composite = 7 (at threshold — Gate A allows ≥ 7)
          },
        }),
      );

      // Gate A passed (composite = 7 is exactly at the threshold).
      expect(result.summary).not.toMatch(/STRONG conviction requires composite/);
      // Gate B also passes (entryQuality = 2).
      expect(result.summary).not.toMatch(/entryQuality/i);
    });

    it("Gate B: rejects STRONG when entryQuality.score < 2", async () => {
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = recordThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute(
        baseLongArgs({
          conviction: "STRONG",
          conviction_rationale: "STRONG on trend + RS but bad entry.",
          variant_view: "Trainium underweighting.",
          target_size_pct: 5,
          scoring: {
            trendStrength: { score: 3, note: "ok" },
            relativeStrength: { score: 3, note: "ok" },
            entryQuality: { score: 1, note: "extended, RSI 75" },
            catalystFreshness: { score: 1, note: "ok" },
            // composite = 8 (passes Gate A), but entryQuality = 1 (fails Gate B)
          },
        }),
      );

      expect(result.data.status).toBe("FAILED");
      expect(result.summary).toMatch(/STRONG conviction requires entryQuality ≥ 2/);
      expect(result.summary).toMatch(/current: 1/i);
    });

    it("Gate B: rejects HIGH when entryQuality.score < 2", async () => {
      // This is tonight's OKTA case: composite 7, entryQuality 1.
      // Under the §4 rubric this would map to MEDIUM, but a writer could
      // still try to claim HIGH. Gate B prevents that.
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = recordThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute(
        baseLongArgs({
          conviction: "HIGH",
          conviction_rationale: "HIGH on trend + catalyst even though entry is late.",
          variant_view: "Consensus underestimates next print.",
          target_size_pct: 4,
          scoring: {
            trendStrength: { score: 2, note: "ok" },
            relativeStrength: { score: 2, note: "ok" },
            entryQuality: { score: 1, note: "RSI 70, late chase" },
            catalystFreshness: { score: 2, note: "ok" },
            // composite = 7 (passes Gate A — STRONG floor), entryQuality = 1 (Gate B)
          },
        }),
      );

      expect(result.data.status).toBe("FAILED");
      expect(result.summary).toMatch(/HIGH conviction requires entryQuality ≥ 2/);
    });

    it("Gate B: ALLOWS MEDIUM with entryQuality < 2 (gate only applies to STRONG/HIGH)", async () => {
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = recordThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute(
        baseLongArgs({
          conviction: "MEDIUM",
          conviction_rationale: "Honest middle; late entry but tracking.",
          target_size_pct: 2,
          scoring: {
            trendStrength: { score: 2, note: "ok" },
            relativeStrength: { score: 2, note: "ok" },
            entryQuality: { score: 1, note: "late chase" },
            catalystFreshness: { score: 1, note: "ok" },
          },
        }),
      );

      // No conviction-gate rejection.
      expect(result.summary).not.toMatch(/entryQuality/i);
      expect(result.summary).not.toMatch(/composite/i);
    });
  });

  describe("PASS bypass", () => {
    it("PASS theses do NOT require conviction (gates bypass on non-directional)", async () => {
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = recordThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      // PASS theses have a different required-field shape (invalidation_conditions
      // ≥ 1 instead of ≥ 2). The conviction gates should not fire regardless.
      const result = await tool.execute({
        ticker: "PASS_TEST",
        direction: "PASS",
        horizon: "TRADE",
        max_hold_days: 14,
        entry_price: 100,
        reasoning_summary: "Passed — does not fit strategy right now.",
        risk_flags: ["Late stage chase", "RSI too high"],
        invalidation_conditions: ["Revisit if pullback to 20d on volume."],
        source_kind: "WATCHLIST_REVIEW",
        source_rationale: "Watchlist review; passing.",
        // NO conviction, NO conviction_rationale, NO variant_view, NO target_size_pct
        // PASS bypasses all four conviction gates.
      });

      // The conviction-specific gates did NOT fire on PASS.
      expect(result.summary ?? "").not.toMatch(/conviction tier required/i);
      expect(result.summary ?? "").not.toMatch(/conviction_rationale required/i);
      expect(result.summary ?? "").not.toMatch(/variant_view/i);
      expect(result.summary ?? "").not.toMatch(/target_size_pct required/i);
    });
  });
});
