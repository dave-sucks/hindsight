/**
 * run-thesis-writer.save-check.test.ts — the writer's own check is the save.
 *
 * Replays two production refresh runs from 2026-09-15 (PEAD Specialist):
 *   - FIVE: the writer explained its stop and target in 264 / 266 chars; the
 *     save caps both at 240 and refused after the research was done.
 *   - DOCU: the writer took the buy level off but kept the $76 review above
 *     the price; the save refuses a target with no buy level.
 * Both decisions passed the writer's own rules (validateThesisDecision) and
 * were thrown away at the save. The submit step now runs the save itself in
 * check-only mode, so the model hears the refusal while it can still fix it.
 */

const mockThesisFindUnique = jest.fn();
const mockThesisUpdate = jest.fn().mockResolvedValue({});
const mockPositionFindFirst = jest.fn().mockResolvedValue(null);
const mockThesisUpdateFindFirst = jest.fn().mockResolvedValue(null);
const mockWriteThesisUpdate = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/prisma", () => ({
  prisma: {
    thesis: { findUnique: mockThesisFindUnique, findFirst: jest.fn().mockResolvedValue(null), update: mockThesisUpdate },
    position: { findFirst: mockPositionFindFirst },
    thesisUpdate: { findFirst: mockThesisUpdateFindFirst },
    gateRejection: { create: jest.fn() },
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
  horizonFor: () => "TARGET",
}));
jest.mock("@/lib/agent/thesis-research/pull-data", () => ({ pullThesisData: jest.fn() }));

import rawFixtures from "@/lib/agent/__fixtures__/writer-save-refusals-2026-09-15.json";
import { setupsForSeat } from "@/lib/agent/knowledge/setups";
import { validateThesisDecision, type ValidatedThesisDecision } from "@/lib/agent/thesis-research/decision";
import { checkDecisionAgainstSave, makeSubmitThesisTool, type RunThesisWriterArgs } from "./run-thesis-writer";
import type { ToolContext } from "@/lib/agent/tool-context";

/** The production rows as read from JSON; the submit is what the model sent. */
type RawDecision = Parameters<typeof validateThesisDecision>[0];
const fixtures = rawFixtures as unknown as Record<"FIVE" | "DOCU", {
  runId: string;
  submit: RawDecision & { remove_trigger_ids: string[] };
  thesis: { id: string; ticker: string; status: string; direction: string; entryPrice: number | null; targetPrice: number | null; stopLoss: number | null; horizon: string; triggers: unknown[]; triggerState: unknown };
}>;


const PEAD = "cmnhxpjio000004jvox6kl6c7";
const ctx = {
  runId: "writer_child_run",
  userId: "user_1",
  accountId: "account_1",
  analystId: PEAD,
  runMode: "THESIS_WRITER",
  groupId: (phase: string) => phase,
  calledTickers: new Map(),
  signalsByTicker: new Map(),
} as unknown as ToolContext;

type Fx = (typeof fixtures)["DOCU"];

function storedRow(fx: Fx) {
  return {
    ...fx.thesis,
    userId: "user_1",
    accountId: "account_1",
    retiredReason: null,
    researchData: null,
    researchRun: { agentConfigId: PEAD },
    snapshot: null,
    bullCase: null,
    bearCase: null,
    recentCatalysts: null,
    fundamentals: null,
    latestEarnings: null,
    catalystsAndEvents: null,
    analystConsensus: null,
    insiderTechnical: null,
    coreBelief: "Post-earnings drift continues.",
    keyAssumptions: ["a", "b"],
    invalidationConds: ["c", "d"],
    scoring: null,
    conviction: "MEDIUM",
    convictionRationale: "Medium.",
    variantView: null,
    catalystDate: null,
    lastReviewedAt: null,
    researchUpdatedAt: new Date(),
  };
}

function writerArgs(fx: Fx, ticker: string): RunThesisWriterArgs {
  return {
    childRunId: "writer_child_run",
    analystId: PEAD,
    ticker,
    mode: "refresh",
    existingThesisId: fx.thesis.id,
    reason: "Refresh under the new writer rules — live check.",
  };
}

const livePrice = { FIVE: 236.57, DOCU: 72.87 } as const;

function validateOpts(fx: Fx, ticker: keyof typeof livePrice) {
  return {
    mode: "refresh" as const,
    existingStatus: fx.thesis.status,
    currentPrice: livePrice[ticker],
    existingTargetPrice: fx.thesis.targetPrice,
    setups: setupsForSeat("PEAD Specialist"),
    chart: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("FIVE 2026-09-15 — stop and target explanations over the save's limit", () => {
  const fx = fixtures.FIVE;

  it("passes the writer's own rules (the gap that threw the research away)", () => {
    expect(validateThesisDecision(fx.submit, validateOpts(fx, "FIVE")).ok).toBe(true);
  });

  it("is refused by the save check, with the save's own reason, before anything is written", async () => {
    mockThesisFindUnique.mockResolvedValue(storedRow(fx));
    const v = validateThesisDecision(fx.submit, validateOpts(fx, "FIVE"));
    const outcome = await checkDecisionAgainstSave({
      args: writerArgs(fx, "FIVE"),
      pull: null,
      decision: v.decision as ValidatedThesisDecision,
      ctx,
      existingDirection: "LONG",
    });
    expect(outcome.wouldSave).toBe(false);
    expect(outcome.fixable).toBe(true);
    expect(outcome.error).toMatch(/stop_basis/);
    expect(outcome.error).toMatch(/240/);
    expect(mockThesisUpdate).not.toHaveBeenCalled();
    expect(mockWriteThesisUpdate).not.toHaveBeenCalled();
  });
});

describe("DOCU 2026-09-15 — buy level removed, the $76 review left behind", () => {
  const fx = fixtures.DOCU;

  it("passes the writer's own rules (the gap that threw the research away)", () => {
    expect(validateThesisDecision(fx.submit, validateOpts(fx, "DOCU")).ok).toBe(true);
  });

  it("is refused by the save check with the save's plan rule, before anything is written", async () => {
    mockThesisFindUnique.mockResolvedValue(storedRow(fx));
    const v = validateThesisDecision(fx.submit, validateOpts(fx, "DOCU"));
    const outcome = await checkDecisionAgainstSave({
      args: writerArgs(fx, "DOCU"),
      pull: null,
      decision: v.decision as ValidatedThesisDecision,
      ctx,
      existingDirection: "LONG",
    });
    expect(outcome.wouldSave).toBe(false);
    expect(outcome.fixable).toBe(true);
    expect(outcome.error).toMatch(/no buy level/);
    expect(mockThesisUpdate).not.toHaveBeenCalled();
    expect(mockWriteThesisUpdate).not.toHaveBeenCalled();
  });

  it("the fix the refusal asks for (take the $76 review off too) passes the check and writes nothing", async () => {
    mockThesisFindUnique.mockResolvedValue(storedRow(fx));
    const fixed = {
      ...fx.submit,
      edit_triggers: [],
      remove_trigger_ids: [...fx.submit.remove_trigger_ids, "d516a881-b59c-45fe-8897-0720fe8687df"],
    };
    const v = validateThesisDecision(fixed, validateOpts(fx, "DOCU"));
    expect(v.ok).toBe(true);
    const outcome = await checkDecisionAgainstSave({
      args: writerArgs(fx, "DOCU"),
      pull: null,
      decision: v.decision as ValidatedThesisDecision,
      ctx,
      existingDirection: "LONG",
    });
    expect(outcome).toMatchObject({ wouldSave: true, error: null });
    expect(mockThesisUpdate).not.toHaveBeenCalled();
    expect(mockWriteThesisUpdate).not.toHaveBeenCalled();
  });
});

describe("submit_thesis runs the save check", () => {
  const fx = fixtures.DOCU;

  function submitTool(onAccept = jest.fn()) {
    let attempts = 0;
    const t = makeSubmitThesisTool({
      ticker: "DOCU",
      validate: validateOpts(fx, "DOCU"),
      check: (d) =>
        checkDecisionAgainstSave({ args: writerArgs(fx, "DOCU"), pull: null, decision: d, ctx, existingDirection: "LONG" }),
      onAttempt: () => ++attempts,
      onAccept,
    }) as unknown as { execute: (raw: unknown) => Promise<{ accepted: boolean; errors?: string[] }> };
    return { t, onAccept };
  }

  it("hands DOCU's refusal back instead of accepting, then accepts the fix", async () => {
    mockThesisFindUnique.mockResolvedValue(storedRow(fx));
    const { t, onAccept } = submitTool();
    const first = await t.execute(fx.submit);
    expect(first.accepted).toBe(false);
    expect(first.errors?.[0]).toMatch(/The save refused this decision/);
    expect(onAccept).not.toHaveBeenCalled();

    const second = await t.execute({
      ...fx.submit,
      edit_triggers: [],
      remove_trigger_ids: [...fx.submit.remove_trigger_ids, "d516a881-b59c-45fe-8897-0720fe8687df"],
    });
    expect(second.accepted).toBe(true);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("after two save refusals it lets the decision through, so the save reports rather than the loop spinning", async () => {
    mockThesisFindUnique.mockResolvedValue(storedRow(fx));
    const { t, onAccept } = submitTool();
    expect((await t.execute(fx.submit)).accepted).toBe(false);
    expect((await t.execute(fx.submit)).accepted).toBe(false);
    expect((await t.execute(fx.submit)).accepted).toBe(true);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
});

describe("FIVE 2026-09-15 — the same decision with the explanations cut to fit", () => {
  const fx = fixtures.FIVE;
  it("passes the save check (nothing else in FIVE's decision is refused)", async () => {
    mockThesisFindUnique.mockResolvedValue(storedRow(fx));
    mockPositionFindFirst.mockResolvedValue({ avgCost: 248.05 });
    const short = {
      ...fx.submit,
      stop_basis: "Under the 38.2% retracement $229.20 — $226.80 is 1.0 ATR ($9.91) below price; a gap fill toward the 50-day $224.67 breaks the drift.",
      target_basis: "1.272 extension of the $173.10 → $263.88 leg = $288.57; 5.3R from $236.57 with a $9.77 risk.",
    };
    const v = validateThesisDecision(short, validateOpts(fx, "FIVE"));
    expect(v.ok).toBe(true);
    const outcome = await checkDecisionAgainstSave({
      args: writerArgs(fx, "FIVE"),
      // The writer's pull carries the live price the research was done at.
      pull: { currentPrice: livePrice.FIVE } as never,
      decision: v.decision as ValidatedThesisDecision,
      ctx,
      existingDirection: "LONG",
    });
    expect(outcome.error).toBeNull();
    expect(outcome.wouldSave).toBe(true);
    expect(mockThesisUpdate).not.toHaveBeenCalled();
  });
});
