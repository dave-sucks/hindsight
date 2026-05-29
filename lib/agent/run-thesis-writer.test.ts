/**
 * run-thesis-writer.test.ts — anti-regression for the
 * buildThesisWriterSystemPrompt() branching by existing thesis status.
 *
 * The writer's role is research refresh only. Status decisions belong
 * to the orchestrator (daily / tactical run). 2026-05-26 produced 3
 * production status flips (AVGO, MRVL, TSM) when the WATCHING template
 * fell through for PROMOTED refreshes — the prompt literally told the
 * writer "YOU ARE WRITING A WATCHING THESIS" and it complied by calling
 * update_thesis(change_status: "WATCHING"). GAPS P0-4.
 *
 * The fix adds a PROMOTED branch. This test pins it so a future
 * "simplify the ternary" refactor can't silently regress.
 */

// Stub out modules that the source file imports at load time but the
// pure prompt builder doesn't actually exercise.
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/actions/api-keys.actions", () => ({
  resolveAlpacaCredentials: jest.fn(),
}));
jest.mock("@/lib/agent/watchlist-symbols", () => ({
  getWatchlistSymbols: jest.fn(),
}));
jest.mock("@/lib/agent/tools", () => ({
  createResearchTools: jest.fn(),
}));

import { buildThesisWriterSystemPrompt } from "./run-thesis-writer";

const baseOpts = {
  analystName: "Test Analyst",
  analystPrompt: null,
  ticker: "NVDA",
  reason: "Promotion refresh — write PR #333 PROMOTED triggers",
  minConfidence: 60,
  runDate: "2026-05-27",
};

function existingThesis(status: string) {
  return {
    id: "thesis_test_1",
    status,
    direction: "LONG",
    horizon: "TARGET",
    coreBelief: "Old belief",
    targetPrice: 195,
    stopLoss: 180,
    confidenceScore: 70,
    reasoningSummary: "Old snapshot",
  };
}

describe("buildThesisWriterSystemPrompt — status branching", () => {
  describe("PROMOTED refresh", () => {
    const prompt = buildThesisWriterSystemPrompt({
      ...baseOpts,
      mode: "refresh",
      existingThesis: existingThesis("PROMOTED"),
    });

    it("declares the PROMOTED refresh header", () => {
      expect(prompt).toContain("*** YOU ARE REFRESHING A PROMOTED THESIS ***");
    });

    it("explicitly forbids the writer from calling update_thesis(change_status)", () => {
      expect(prompt).toContain("FORBIDDEN on PROMOTED refresh");
      expect(prompt).toContain("update_thesis(change_status: ...)");
      expect(prompt).toContain("belongs to the next daily run");
    });

    it("names the WATCHING failure shape from 2026-05-26", () => {
      // The anti-regression line: surfaces the failure shape (calling
      // update_thesis(change_status: "WATCHING") on a PROMOTED row) so
      // future prompt refactors keep the explicit prohibition.
      expect(prompt).toContain('update_thesis(change_status: "WATCHING")');
      expect(prompt).toContain("2026-05-26");
    });

    it("points the writer at the PROMOTED trigger template", () => {
      expect(prompt).toContain(
        'defaultTriggersForHorizon(horizon, prices, "PROMOTED")',
      );
    });

    it("does NOT include the WATCHING-thesis header", () => {
      expect(prompt).not.toContain("*** YOU ARE WRITING A WATCHING THESIS ***");
    });

    it("does NOT include the ACTIVE-thesis header", () => {
      expect(prompt).not.toContain(
        "*** YOU ARE REFRESHING AN ACTIVE THESIS ***",
      );
    });
  });

  describe("ACTIVE refresh — pre-existing behavior preserved", () => {
    const prompt = buildThesisWriterSystemPrompt({
      ...baseOpts,
      mode: "refresh",
      existingThesis: existingThesis("ACTIVE"),
    });

    it("declares the ACTIVE refresh header", () => {
      expect(prompt).toContain(
        "*** YOU ARE REFRESHING AN ACTIVE THESIS ***",
      );
    });

    it("does NOT fall through to the PROMOTED or WATCHING headers", () => {
      expect(prompt).not.toContain(
        "*** YOU ARE REFRESHING A PROMOTED THESIS ***",
      );
      expect(prompt).not.toContain("*** YOU ARE WRITING A WATCHING THESIS ***");
    });
  });

  describe("WATCHING refresh — default branch", () => {
    const prompt = buildThesisWriterSystemPrompt({
      ...baseOpts,
      mode: "refresh",
      existingThesis: existingThesis("WATCHING"),
    });

    it("declares the WATCHING-thesis header", () => {
      expect(prompt).toContain("*** YOU ARE WRITING A WATCHING THESIS ***");
    });

    it("does NOT include the PROMOTED or ACTIVE headers", () => {
      expect(prompt).not.toContain(
        "*** YOU ARE REFRESHING A PROMOTED THESIS ***",
      );
      expect(prompt).not.toContain(
        "*** YOU ARE REFRESHING AN ACTIVE THESIS ***",
      );
    });
  });

  describe("mint mode — net-new coverage", () => {
    const prompt = buildThesisWriterSystemPrompt({
      ...baseOpts,
      mode: "mint",
      existingThesis: null,
    });

    it("uses the WATCHING template (net-new mints default to WATCHING)", () => {
      expect(prompt).toContain("*** YOU ARE WRITING A WATCHING THESIS ***");
    });

    it("does NOT include the PROMOTED branch (no existing thesis)", () => {
      expect(prompt).not.toContain(
        "*** YOU ARE REFRESHING A PROMOTED THESIS ***",
      );
    });
  });
});

describe("buildThesisWriterSystemPrompt — date-awareness gate (P1-5 / PR #354)", () => {
  it("renders today's date in the date-awareness header", () => {
    const prompt = buildThesisWriterSystemPrompt({
      ...baseOpts,
      runDate: "2026-08-15",
      mode: "mint",
      existingThesis: null,
    });
    expect(prompt).toContain("DATE-AWARENESS");
    expect(prompt).toContain("Today is 2026-08-15.");
  });

  it("instructs the writer to discard past-tense claims on future-dated catalysts", () => {
    const prompt = buildThesisWriterSystemPrompt({
      ...baseOpts,
      mode: "refresh",
      existingThesis: existingThesis("WATCHING"),
    });
    expect(prompt).toContain("has NOT yet occurred");
    expect(prompt).toContain('"expected" / "anticipated" / "consensus expects"');
    expect(prompt).toContain('NEVER frame it as "reported" / "beat" / "missed"');
    expect(prompt).toContain("treat it as a");
    expect(prompt).toContain("Sonar hallucination and discard it");
  });

  it("names the 2026-05-26 MRVL Sonar fabrication so future refactors keep the anti-regression", () => {
    const prompt = buildThesisWriterSystemPrompt({
      ...baseOpts,
      mode: "refresh",
      existingThesis: existingThesis("PROMOTED"),
    });
    expect(prompt).toContain("Production incident 2026-05-26");
    expect(prompt).toContain("$81.61 billion");
    expect(prompt).toContain("If a number from Sonar looks wrong");
    expect(prompt).toContain("discard the entire claim, do not rewrite it");
  });

  it("renders the date-awareness block BEFORE the WHY YOU WERE DISPATCHED block", () => {
    const prompt = buildThesisWriterSystemPrompt({
      ...baseOpts,
      mode: "refresh",
      existingThesis: existingThesis("ACTIVE"),
    });
    const dateIdx = prompt.indexOf("DATE-AWARENESS");
    const reasonIdx = prompt.indexOf("WHY YOU WERE DISPATCHED");
    expect(dateIdx).toBeGreaterThan(-1);
    expect(reasonIdx).toBeGreaterThan(-1);
    expect(dateIdx).toBeLessThan(reasonIdx);
  });
});
