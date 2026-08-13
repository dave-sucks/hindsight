/**
 * run-thesis-writer.test.ts — V2 writer anti-regression coverage.
 *
 * 1. buildWriterResearchPrompt() status branching: the trigger-template
 *    block MUST match the position state. 2026-05-26 produced 3
 *    production status flips (AVGO, MRVL, TSM) when the WATCHING
 *    template fell through for PROMOTED refreshes (GAPS P0-4); in V2 the
 *    writer can't call update_thesis at all, but the prompt's
 *    state-branching still drives which trigger actions the model
 *    proposes — pin it.
 *
 * 2. Date-awareness gate (P1-5 / PR #354): the MRVL Sonar-fabrication
 *    guardrails must survive prompt refactors.
 *
 * 3. writerIdempotencyCheck / runThesisWriterAgent: Inngest retry
 *    idempotency (P1-17, PR #383) — a COMPLETE prior attempt no-ops, a
 *    FAILED one retries, guard read errors fail open.
 */

// Stub prisma — the prompt-builder tests are pure; the idempotency tests
// configure reads per-case (the guard short-circuits before any phase
// work, so only prisma is exercised).
jest.mock("@/lib/prisma", () => ({
  prisma: {
    researchRun: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    thesis: { findFirst: jest.fn(), findUnique: jest.fn() },
    thesisUpdate: { findFirst: jest.fn() },
    agentConfig: { findUnique: jest.fn() },
    runMessage: { deleteMany: jest.fn(), create: jest.fn() },
    runEvent: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));
// Keep the deep data-layer import chain out of the test runtime — the
// idempotency fall-through cases exit on "analyst not found" before any
// pull runs, so the module only needs to exist.
jest.mock("@/lib/agent/thesis-research/pull-data", () => ({
  pullThesisData: jest.fn(),
}));
jest.mock("@/lib/agent/tools/record-thesis", () => ({
  recordThesis: jest.fn(),
}));
jest.mock("@/lib/agent/tools/update-thesis", () => ({
  updateThesis: jest.fn(),
}));

import {
  buildWriterResearchPrompt,
  runThesisWriterAgent,
  type WriterResearchPromptOpts,
} from "./run-thesis-writer";
import { prisma } from "@/lib/prisma";
import { pullThesisData } from "@/lib/agent/thesis-research/pull-data";

const baseOpts: Omit<WriterResearchPromptOpts, "mode" | "existingThesis"> = {
  analystName: "Test Analyst",
  analystPrompt: null,
  ticker: "NVDA",
  reason: "Promotion refresh — write PROMOTED triggers",
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
    composite: 7,
    snapshotText: "Old snapshot",
    hasTriggers: true,
  };
}

describe("buildWriterResearchPrompt — status branching", () => {
  describe("PROMOTED refresh", () => {
    const prompt = buildWriterResearchPrompt({
      ...baseOpts,
      mode: "refresh",
      existingThesis: existingThesis("PROMOTED"),
    });

    it("declares the PROMOTED trigger block", () => {
      expect(prompt).toContain("REFRESHING A PROMOTED THESIS");
    });

    it("forbids position-management trigger actions (no position exists)", () => {
      expect(prompt).toContain("NEVER EXIT/TRIM/ADD/MOVE_STOP");
    });

    it("keeps the role split — the writer does not decide re-entry, status stays PROMOTED", () => {
      expect(prompt).toContain("You do NOT decide re-entry");
      expect(prompt).toContain("Status stays PROMOTED");
    });

    it("does NOT include the HELD or WATCHING trigger blocks", () => {
      expect(prompt).not.toContain("REFRESHING A HELD THESIS");
      expect(prompt).not.toContain("WATCHING thesis (no position");
    });
  });

  describe("HELD (HOLDING) refresh", () => {
    const prompt = buildWriterResearchPrompt({
      ...baseOpts,
      mode: "refresh",
      existingThesis: existingThesis("HOLDING"),
    });

    it("declares the HELD trigger block and forbids ENTER", () => {
      expect(prompt).toContain("REFRESHING A HELD THESIS");
      expect(prompt).toContain("NEVER ENTER");
    });

    it("requires a protective EXIT rung on the stop", () => {
      expect(prompt).toContain("At least one EXIT rung on the stop");
    });

    it("does NOT fall through to the PROMOTED or WATCHING blocks", () => {
      expect(prompt).not.toContain("REFRESHING A PROMOTED THESIS");
      expect(prompt).not.toContain("WATCHING thesis (no position");
    });
  });

  describe("WATCHING refresh — default branch", () => {
    const prompt = buildWriterResearchPrompt({
      ...baseOpts,
      mode: "refresh",
      existingThesis: existingThesis("WATCHING"),
    });

    it("declares the WATCHING trigger block", () => {
      expect(prompt).toContain("WATCHING thesis (no position");
      expect(prompt).toContain("NEVER EXIT/TRIM/ADD/MOVE_STOP");
    });

    it("does NOT include the PROMOTED or HELD blocks", () => {
      expect(prompt).not.toContain("REFRESHING A PROMOTED THESIS");
      expect(prompt).not.toContain("REFRESHING A HELD THESIS");
    });
  });

  describe("mint mode — net-new coverage", () => {
    const prompt = buildWriterResearchPrompt({
      ...baseOpts,
      mode: "mint",
      existingThesis: null,
    });

    it("frames the mint as WATCHING, entry-gated coverage", () => {
      expect(prompt).toContain("MODE: MINT");
      expect(prompt.replace(/\s+/g, " ")).toContain(
        "persisted as WATCHING (entry-gated)",
      );
    });

    it("uses the WATCHING trigger block", () => {
      expect(prompt).toContain("WATCHING thesis (no position");
    });

    it("does NOT include the PROMOTED block (no existing thesis)", () => {
      expect(prompt).not.toContain("REFRESHING A PROMOTED THESIS");
    });
  });

  describe("workflow contract", () => {
    const prompt = buildWriterResearchPrompt({
      ...baseOpts,
      mode: "mint",
      existingThesis: null,
    });

    it("names every section header the server-side parser keys on", () => {
      for (const header of [
        "## Snapshot",
        "## Recent Catalysts",
        "## Fundamentals",
        "## Latest Earnings",
        "## Catalysts & Events",
        "## Bull Case",
        "## Bear Case",
        "## Analyst Consensus",
        "## Insider & Technical",
      ]) {
        expect(prompt).toContain(header);
      }
    });

    it("instructs one submit_thesis call and the R/R floor", () => {
      expect(prompt).toContain("submit_thesis");
      expect(prompt).toContain("R/R FLOOR — 2:1 MANDATORY");
    });

    it("tells the model repairs are field-fixes, not note rewrites", () => {
      expect(prompt).toContain("do NOT rewrite the research note");
    });
  });
});

describe("buildWriterResearchPrompt — date-awareness gate (P1-5 / PR #354)", () => {
  it("renders today's date in the date-awareness header", () => {
    const prompt = buildWriterResearchPrompt({
      ...baseOpts,
      runDate: "2026-08-15",
      mode: "mint",
      existingThesis: null,
    });
    expect(prompt).toContain("DATE-AWARENESS");
    expect(prompt).toContain("Today is 2026-08-15.");
  });

  it("instructs the writer to discard hallucinated past-tense claims on future catalysts", () => {
    const prompt = buildWriterResearchPrompt({
      ...baseOpts,
      mode: "refresh",
      existingThesis: existingThesis("WATCHING"),
    });
    // Whitespace-normalized — the template wraps these phrases across lines.
    const flat = prompt.replace(/\s+/g, " ");
    expect(flat).toContain("has NOT yet occurred");
    expect(flat).toContain("discard the ENTIRE claim");
    expect(flat).toContain('do not "fix" the number');
  });

  it("names the 2026-05-26 incident so future refactors keep the anti-regression", () => {
    const prompt = buildWriterResearchPrompt({
      ...baseOpts,
      mode: "refresh",
      existingThesis: existingThesis("PROMOTED"),
    });
    expect(prompt).toContain("production incident 2026-05-26, PR #354");
  });

  it("renders the date-awareness block BEFORE the job instructions", () => {
    const prompt = buildWriterResearchPrompt({
      ...baseOpts,
      mode: "refresh",
      existingThesis: existingThesis("HOLDING"),
    });
    const dateIdx = prompt.indexOf("DATE-AWARENESS");
    const jobIdx = prompt.indexOf("YOUR JOB");
    expect(dateIdx).toBeGreaterThan(-1);
    expect(jobIdx).toBeGreaterThan(-1);
    expect(dateIdx).toBeLessThan(jobIdx);
  });
});

describe("runThesisWriterAgent — idempotency guard on Inngest retries (P1-17)", () => {
  const researchRunFindUnique = prisma.researchRun.findUnique as jest.Mock;
  const thesisFindFirst = prisma.thesis.findFirst as jest.Mock;
  const thesisUpdateFindFirst = prisma.thesisUpdate.findFirst as jest.Mock;
  const agentConfigFindUnique = prisma.agentConfig.findUnique as jest.Mock;
  const researchRunUpdateMany = prisma.researchRun.updateMany as jest.Mock;
  const researchRunUpdate = prisma.researchRun.update as jest.Mock;
  const runEventCreate = prisma.runEvent.create as jest.Mock;
  const pullData = pullThesisData as jest.Mock;

  // `agentConfig.findUnique` is the first DB read AFTER the guard (the
  // pull phase's analyst load). If the guard short-circuits it's never
  // reached; returning null sends the fall-through to the cheap
  // "Analyst not found" FAILED exit — no pulls, no model call.
  beforeEach(() => {
    jest.resetAllMocks();
    researchRunUpdateMany.mockResolvedValue({ count: 1 });
    researchRunUpdate.mockResolvedValue({});
    runEventCreate.mockResolvedValue({});
  });

  const mintArgs = {
    childRunId: "run_child_1",
    analystId: "analyst_1",
    ticker: "nvda",
    mode: "mint" as const,
    reason: "test dispatch",
  };

  it("no-ops a retry when the child run is already COMPLETE (mint) and returns the existing thesisId", async () => {
    researchRunFindUnique.mockResolvedValue({ status: "COMPLETE" });
    thesisFindFirst.mockResolvedValue({ id: "thesis_minted_1" });

    const result = await runThesisWriterAgent(mintArgs);

    expect(result.status).toBe("COMPLETE");
    expect(result.thesisId).toBe("thesis_minted_1");
    expect(result.steps).toBe(0);
    expect(result.toolCalls).toBe(0);
    // Short-circuited BEFORE the pull phase's analyst load + model call.
    expect(agentConfigFindUnique).not.toHaveBeenCalled();
    expect(pullData).not.toHaveBeenCalled();
    // Looked the minted thesis up by the child run id (uppercased ticker).
    expect(thesisFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { researchRunId: "run_child_1", ticker: "NVDA" },
      }),
    );
  });

  it("no-ops a COMPLETE refresh via the ThesisUpdate audit row", async () => {
    researchRunFindUnique.mockResolvedValue({ status: "COMPLETE" });
    thesisUpdateFindFirst.mockResolvedValue({ thesisId: "thesis_existing_9" });

    const result = await runThesisWriterAgent({
      childRunId: "run_child_2",
      analystId: "analyst_1",
      ticker: "AMD",
      mode: "refresh",
      existingThesisId: "thesis_existing_9",
      reason: "refresh dispatch",
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.thesisId).toBe("thesis_existing_9");
    expect(thesisUpdateFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: "run_child_2", thesisId: "thesis_existing_9" },
      }),
    );
    expect(agentConfigFindUnique).not.toHaveBeenCalled();
    expect(pullData).not.toHaveBeenCalled();
  });

  it("does NOT short-circuit a genuinely FAILED first attempt — the retry re-runs", async () => {
    researchRunFindUnique.mockResolvedValue({ status: "FAILED" });
    // Fall-through reaches the analyst load; null sends it to the cheap
    // "Analyst not found" FAILED exit instead of a real model run.
    agentConfigFindUnique.mockResolvedValue(null);

    const result = await runThesisWriterAgent(mintArgs);

    expect(agentConfigFindUnique).toHaveBeenCalled();
    expect(thesisFindFirst).not.toHaveBeenCalled();
    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("not found");
  });

  it("does NOT short-circuit while the run is still RUNNING (pre-created initial state)", async () => {
    researchRunFindUnique.mockResolvedValue({ status: "RUNNING" });
    agentConfigFindUnique.mockResolvedValue(null);

    const result = await runThesisWriterAgent(mintArgs);

    expect(agentConfigFindUnique).toHaveBeenCalled();
    expect(result.status).toBe("FAILED");
  });

  it("fails open — a guard read error falls through to a normal run instead of blocking", async () => {
    researchRunFindUnique.mockRejectedValue(new Error("db blip"));
    agentConfigFindUnique.mockResolvedValue(null);

    const result = await runThesisWriterAgent(mintArgs);

    // The thrown guard read did not abort the function; it proceeded.
    expect(agentConfigFindUnique).toHaveBeenCalled();
    expect(result.status).toBe("FAILED");
  });

  it("a failed run still gets a terminal status write and a run_failed event", async () => {
    researchRunFindUnique.mockResolvedValue({ status: "RUNNING" });
    agentConfigFindUnique.mockResolvedValue(null);

    await runThesisWriterAgent(mintArgs);

    expect(researchRunUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run_child_1", status: "RUNNING" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    expect(runEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "run_failed" }),
      }),
    );
  });
});
