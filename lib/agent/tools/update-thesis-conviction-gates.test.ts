/**
 * update-thesis-conviction-gates.test.ts — Layer-1 gates for the
 * Conviction Expression v4 patch path on update_thesis.
 *
 * Covers:
 *   • Coherence: patching `conviction` requires `conviction_rationale`
 *   • Coherence: patching to STRONG/HIGH requires variantView (in patch
 *     OR already on the row)
 *   • Consistency: Gate A (STRONG composite < 7) — both when conviction
 *     is being patched AND when scoring is being patched on an existing
 *     STRONG row
 *   • Consistency: Gate B (STRONG/HIGH entryQuality < 2)
 *   • PENDING → LONG/SHORT promotion requires conviction + rationale +
 *     variantView (for STRONG/HIGH) + target_size_pct
 *
 * See docs/plans/CONVICTION_EXPRESSION.md §3, §3.5.
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
}));

import { updateThesis } from "./update-thesis";
import type { ToolContext } from "@/lib/agent/tool-context";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    runId: "run_test_uc",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    groupId: (phase: string) => phase,
    ...overrides,
  };
}

/**
 * Minimal existing thesis row for the patch path. Override for each test.
 * Status WATCHING / direction LONG so most gates don't fire on the
 * "existing" side.
 */
function makeExistingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "thesis_existing_1",
    userId: "user_1",
    ticker: "TEST",
    status: "WATCHING",
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
    scoring: {
      trendStrength: { score: 2, note: "ok" },
      relativeStrength: { score: 2, note: "ok" },
      entryQuality: { score: 2, note: "ok" },
      catalystFreshness: { score: 2, note: "ok" },
      composite: 8,
    },
    targetPrice: 120,
    stopLoss: 92,
    targetSizePct: 3,
    conviction: "MEDIUM",
    convictionRationale: "Existing medium tier.",
    variantView: null,
    horizon: "TARGET",
    catalystDate: null,
    maxHoldDays: null,
    nextReviewAt: null,
    triggers: [{ kind: "PRICE_BELOW", action: "REVIEW", predicate: { kind: "PRICE_BELOW", level: 90 } }],
    scalingPlan: null,
    ...overrides,
  };
}

describe("update_thesis — Conviction Expression v4 patch gates", () => {
  beforeEach(() => {
    mockThesisFindUnique.mockReset();
    mockThesisUpdate.mockClear();
  });

  describe("coherence gates", () => {
    it("rejects patching conviction without conviction_rationale", async () => {
      mockThesisFindUnique.mockResolvedValueOnce(makeExistingRow());
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = updateThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute({
        thesis_id: "thesis_existing_1",
        rationale: "Upgrading tier; story strengthened.",
        conviction: "HIGH",
        variant_view: "Edge.",
        // conviction_rationale missing
      });

      expect(result.data.ok).toBe(false);
      expect(result.data.error).toBe("conviction_rationale_required");
      expect(mockThesisUpdate).not.toHaveBeenCalled();
    });

    it("rejects patching to STRONG when no variant_view exists (existing+patch both null)", async () => {
      mockThesisFindUnique.mockResolvedValueOnce(
        makeExistingRow({ variantView: null }),
      );
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = updateThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute({
        thesis_id: "thesis_existing_1",
        rationale: "Upgrading to STRONG.",
        conviction: "STRONG",
        conviction_rationale: "Composite 8, R/R 3:1.",
        // variant_view not patched, existing is null
      });

      expect(result.data.ok).toBe(false);
      expect(result.data.error).toBe("variant_view_required");
    });

    it("ALLOWS patching to HIGH when existing variantView is non-null", async () => {
      // The writer is updating tier but the existing row already has a
      // variantView (e.g. from a prior STRONG/HIGH dispatch). Allowed.
      mockThesisFindUnique.mockResolvedValueOnce(
        makeExistingRow({ variantView: "Existing edge claim." }),
      );
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = updateThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute({
        thesis_id: "thesis_existing_1",
        rationale: "Upgrading; edge intact.",
        conviction: "HIGH",
        conviction_rationale: "Composite 8, edge intact.",
        // variant_view not patched — but existing has it
      });

      // Coherence gate passes (existing variantView carries through).
      expect(result.data?.error).not.toBe("variant_view_required");
    });
  });

  describe("conviction-composite independence (gates removed 2026-05-31)", () => {
    // Gates A + B were dropped — conviction is the writer's view, not
    // a derived field. These tests prove the gates are gone.

    it("ALLOWS patching to STRONG with existing composite < 7", async () => {
      mockThesisFindUnique.mockResolvedValueOnce(
        makeExistingRow({
          scoring: { composite: 6, entryQuality: { score: 2 } },
          variantView: "Existing edge.",
        }),
      );
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = updateThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute({
        thesis_id: "thesis_existing_1",
        rationale: "Upgrading on the strength of the variant view.",
        conviction: "STRONG",
        conviction_rationale: "Urgent buy. Variant view is sharp and composite undersells what's coming.",
      });

      // Pre-fix: Gate A would have rejected. Now allowed.
      expect(result.data?.error).not.toBe("gate_a_strong_requires_composite_7");
    });

    it("ALLOWS lowering scoring on an existing STRONG thesis (writer's call, no auto-reject)", async () => {
      mockThesisFindUnique.mockResolvedValueOnce(
        makeExistingRow({
          conviction: "STRONG",
          convictionRationale: "Was top-tier.",
          variantView: "Existing edge.",
          scoring: { composite: 8, entryQuality: { score: 2 } },
        }),
      );
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = updateThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute({
        thesis_id: "thesis_existing_1",
        rationale: "Scoring drift — trend weakened.",
        scoring: {
          trendStrength: { score: 1, note: "weakened" },
          relativeStrength: { score: 2, note: "ok" },
          entryQuality: { score: 2, note: "ok" },
          catalystFreshness: { score: 1, note: "ok" },
          // patched composite would be 6; existing conviction STRONG stays
        },
      });

      // Pre-fix: Gate A would have rejected. Now allowed — the writer
      // can lower scoring and keep STRONG if their variant view still
      // supports it. The composite and the conviction are independent.
      expect(result.data?.error).not.toBe("gate_a_strong_requires_composite_7");
    });
  });

  describe("PENDING promotion gates", () => {
    it("rejects PENDING → LONG promotion missing conviction", async () => {
      mockThesisFindUnique.mockResolvedValueOnce(
        makeExistingRow({
          direction: null,
          scoring: {},
          coreBelief: null,
          keyAssumptions: [],
          invalidationConds: [],
          targetPrice: null,
          stopLoss: null,
          conviction: null,
          convictionRationale: null,
        }),
      );
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = updateThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute({
        thesis_id: "thesis_existing_1",
        rationale: "First commit on a PENDING seed.",
        direction: "LONG",
        horizon: "TARGET",
        target_price: 150,
        stop_loss: 95,
        entry_price: 110,
        core_belief: "TEST reaches 150 within 60 days on PEAD.",
        key_assumptions: ["a1", "a2"],
        invalidation_conditions: ["i1", "i2"],
        // conviction, conviction_rationale, variant_view, target_size_pct all missing
      });

      expect(result.data.ok).toBe(false);
      expect(result.data.error).toBe("pending_promotion_missing_fields");
      expect(result.data.missing).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/conviction \(STRONG/),
          "conviction_rationale",
          "target_size_pct",
        ]),
      );
    });

    it("PENDING → LONG with STRONG requires variant_view in the same call", async () => {
      mockThesisFindUnique.mockResolvedValueOnce(
        makeExistingRow({
          direction: null,
          scoring: {},
          coreBelief: null,
          keyAssumptions: [],
          invalidationConds: [],
          targetPrice: null,
          stopLoss: null,
          conviction: null,
          convictionRationale: null,
        }),
      );
      const ctx = makeCtx();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tool = updateThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
      const result = await tool.execute({
        thesis_id: "thesis_existing_1",
        rationale: "Committing STRONG on first research.",
        direction: "LONG",
        horizon: "TARGET",
        target_price: 150,
        stop_loss: 95,
        entry_price: 110,
        core_belief: "TEST reaches 150 within 60 days on PEAD.",
        key_assumptions: ["a1", "a2"],
        invalidation_conditions: ["i1", "i2"],
        conviction: "STRONG",
        conviction_rationale: "Composite 8, R/R 3:1, clear edge.",
        target_size_pct: 5,
        // variant_view missing — STRONG requires it
      });

      expect(result.data.ok).toBe(false);
      expect(result.data.error).toBe("pending_promotion_missing_fields");
      expect(result.data.missing).toContain("variant_view (required for STRONG/HIGH)");
    });
  });
});
