/**
 * run-thesis-writer.save-check.test.ts — the writer's own check is the save.
 *
 * Replays two production refresh runs from 2026-09-15 (PEAD Specialist):
 *   - FIVE: the writer explained its stop and target in 264 / 266 chars; the
 *     save caps both at 240 and refused after the research was done.
 *   - DOCU: the writer took the buy level off but kept the $76 review above
 *     the price; the save refused it as a target with no buy level. Since the
 *     QB ruling of 2026-09-29 (DAV-335) a review at any price on a stock we
 *     only watch is a wake, so DOCU's decision now saves, and since
 *     2026-11-16 so does a watch with its floor and no buy. The refusal these
 *     tests exercise is the same decision with its floor kept and turned into
 *     a sale (an edit to action EXIT): there is nothing to sell on a watch.
 * Both decisions passed the writer's own rules (validateThesisDecision) and
 * were thrown away at the save. The submit step now runs the save itself in
 * check-only mode, so the model hears the refusal while it can still fix it.
 * Since T1 the decision carries no trigger edit: a sale on a watch is refused
 * by edit_triggers after the save, as for every agent.
 */

/** DOCU's 09-15 decision with its floor ($57.50) kept. */
const FLOOR_ID = "85cba008";
const withFloorKept = <T extends { remove_trigger_ids: string[] }>(submit: T): T => ({
  ...submit,
  remove_trigger_ids: submit.remove_trigger_ids.filter((id) => !id.startsWith(FLOOR_ID)),
});

const mockThesisFindUnique = jest.fn();
const mockThesisUpdate = jest.fn().mockResolvedValue({});
const mockPositionFindFirst = jest.fn().mockResolvedValue(null);
const mockThesisUpdateFindFirst = jest.fn().mockResolvedValue(null);
const mockWriteThesisUpdate = jest.fn().mockResolvedValue(undefined);
const mockRecordGateRejection = jest.fn().mockResolvedValue(undefined);
const mockGetStockQuote = jest.fn().mockResolvedValue(null);
const mockThesisCreate = jest.fn();
const mockThesisCount = jest.fn().mockResolvedValue(0);

jest.mock("@/lib/prisma", () => ({
  prisma: {
    thesis: {
      findUnique: mockThesisFindUnique,
      findFirst: jest.fn().mockResolvedValue(null),
      update: mockThesisUpdate,
      create: mockThesisCreate,
      count: mockThesisCount,
    },
    agentConfig: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
    analystSignalRoute: { findMany: jest.fn().mockResolvedValue([]) },
    position: { findFirst: mockPositionFindFirst },
    thesisUpdate: { findFirst: mockThesisUpdateFindFirst },
    gateRejection: { create: jest.fn() },
  },
}));
jest.mock("@/lib/actions/finnhub.actions", () => ({ getStockQuote: mockGetStockQuote }));
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
jest.mock("@/lib/agent/gate-rejections", () => ({
  recordGateRejection: mockRecordGateRejection,
  detectGateRejection: jest.requireActual("@/lib/agent/gate-rejections").detectGateRejection,
  detailFromData: jest.requireActual("@/lib/agent/gate-rejections").detailFromData,
  resolveGateRejections: jest.fn(async () => undefined),
}));

import rawFixtures from "@/lib/agent/__fixtures__/writer-save-refusals-2026-09-15.json";
import { setupsForAnalyst } from "@/lib/agent/knowledge/setups";
import { validateThesisDecision, type ValidatedThesisDecision } from "@/lib/agent/thesis-research/decision";
import { checkDecisionAgainstSave, type RunThesisWriterArgs } from "./run-thesis-writer";
import { prisma } from "@/lib/prisma";
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
  // The pull phase called get_stock_data for the ticker, as the writer ctx records.
  calledTickers: new Map([["DOCU", new Set(["get_stock_data"])], ["FIVE", new Set(["get_stock_data"])]]),
} as unknown as ToolContext;

type Fx = (typeof fixtures)["DOCU"];

/** The stored row, its watch's floor as the 2026-11-16 migration stores it (STOP_WATCHING, on the close). */
function storedRow(fx: Fx) {
  const migrated = (t: unknown) => {
    const r = t as { action: string; predicate: Record<string, unknown> };
    return fx.thesis.status !== "HOLDING" && r.action === "EXIT" ? { ...r, action: "STOP_WATCHING", predicate: { ...r.predicate, settings: { close: true } } } : r;
  };
  return {
    ...fx.thesis,
    triggers: fx.thesis.triggers.map(migrated),
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

/** The stock as the save reads it (stockForSave): its view, its status and its triggers. */
const stockOf = (fx: Fx) => ({ direction: "LONG", status: fx.thesis.status, triggers: storedRow(fx).triggers as never });

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
    existingTriggers: fx.thesis.triggers as never,
    setups: setupsForAnalyst(["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"]),
    chart: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("FIVE 2026-09-15 — stop and target explanations of 264 and 266 characters", () => {
  const fx = fixtures.FIVE;

  it("passes the writer's own rules", () => {
    expect(validateThesisDecision(fx.submit, validateOpts(fx, "FIVE")).ok).toBe(true);
  });

  it("passes the save check too — a long explanation is a detail, not a refusal (DAV-316)", async () => {
    // The save used to refuse these against a 240-character cap on
    // stop_basis / target_basis and the research was lost. The cap is gone.
    mockThesisFindUnique.mockResolvedValue(storedRow(fx));
    const v = validateThesisDecision(fx.submit, validateOpts(fx, "FIVE"));
    const outcome = await checkDecisionAgainstSave({
      args: writerArgs(fx, "FIVE"),
      pull: null,
      decision: v.decision as ValidatedThesisDecision,
      ctx,
      existing: stockOf(fx),
    });
    expect(outcome).toMatchObject({ wouldSave: true, error: null });
    expect(mockThesisUpdate).not.toHaveBeenCalled();
    expect(mockWriteThesisUpdate).not.toHaveBeenCalled();
  });
});

describe("DOCU 2026-09-15 — buy level removed, the $76 review left behind", () => {
  const fx = fixtures.DOCU;

  it("passes the writer's own rules (the gap that threw the research away)", () => {
    expect(validateThesisDecision(fx.submit, validateOpts(fx, "DOCU")).ok).toBe(true);
  });

  it("passes the save check: the $76 review it kept is a wake, not a target (QB ruling 2026-09-29)", async () => {
    mockThesisFindUnique.mockResolvedValue(storedRow(fx));
    const v = validateThesisDecision(fx.submit, validateOpts(fx, "DOCU"));
    const outcome = await checkDecisionAgainstSave({
      args: writerArgs(fx, "DOCU"),
      pull: null,
      decision: v.decision as ValidatedThesisDecision,
      ctx,
      existing: stockOf(fx),
    });
    expect(outcome).toMatchObject({ wouldSave: true, error: null });
    expect(mockThesisUpdate).not.toHaveBeenCalled();
    expect(mockWriteThesisUpdate).not.toHaveBeenCalled();
  });

  it("with its floor kept it saves: a watch's Stop watching line needs no buy", async () => {
    mockThesisFindUnique.mockResolvedValue(storedRow(fx));
    const v = validateThesisDecision(withFloorKept(fx.submit), validateOpts(fx, "DOCU"));
    const outcome = await checkDecisionAgainstSave({
      args: writerArgs(fx, "DOCU"),
      pull: null,
      decision: v.decision as ValidatedThesisDecision,
      ctx,
      existing: stockOf(fx),
    });
    expect(outcome).toMatchObject({ wouldSave: true, error: null });
  });

  it("DOCU's real call (the floor taken off) passes the check and writes nothing", async () => {
    mockThesisFindUnique.mockResolvedValue(storedRow(fx));
    const v = validateThesisDecision(fx.submit, validateOpts(fx, "DOCU"));
    expect(v.ok).toBe(true);
    const outcome = await checkDecisionAgainstSave({
      args: writerArgs(fx, "DOCU"),
      pull: null,
      decision: v.decision as ValidatedThesisDecision,
      ctx,
      existing: stockOf(fx),
    });
    expect(outcome).toMatchObject({ wouldSave: true, error: null });
    expect(mockThesisUpdate).not.toHaveBeenCalled();
    expect(mockWriteThesisUpdate).not.toHaveBeenCalled();
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
      existing: stockOf(fx),
    });
    expect(outcome.error).toBeNull();
    expect(outcome.wouldSave).toBe(true);
    expect(mockThesisUpdate).not.toHaveBeenCalled();
    // The run already pulled the price — a check on a refresh spends no quote
    // of its own. The shared key is the trigger check's first.
    expect(mockGetStockQuote).not.toHaveBeenCalled();
  });
});


describe("a new thesis (mint) is checked the same way", () => {
  const fx = fixtures.DOCU;
  const mintArgs = { ...writerArgs(fx, "DOCU"), mode: "mint" as const, existingThesisId: null };
  const mintOpts = { ...validateOpts(fx, "DOCU"), mode: "mint" as const, existingStatus: null, existingTriggers: undefined };
  // DOCU's decision as a mint: levels priced, no trigger-edit ops.
  const mintDecision = {
    ...fx.submit,
    // The buy, the floor and the take-profit, as the writer writes them now: triggers.
    triggers: [
      { predicate: { watch: "price", is: "below", value: 67.28 }, action: "ENTER", rationale: "I buy the pullback to the gap-day midpoint, $67.28." },
      { predicate: { watch: "price", is: "below", value: 64.16, settings: { close: true } }, action: "STOP_WATCHING", rationale: "Under the September 4 gap-day low $64.16 — 1.1 ATR below the $67.28 entry." },
      { predicate: { watch: "price", is: "above", value: 78.3 }, action: "REVIEW", rationale: "1.272 extension of the gap leg = $78.30, 3.5R on a $3.12 risk." },
    ] as never,
    add_triggers: undefined,
    edit_triggers: undefined,
    remove_trigger_ids: undefined,
    // The decision carries no trigger since #1051, and a view that would save with nothing that can fire is refused:
    // this one names when to look again.
    look_again: { after_next_report: true, why: "Whether the next report keeps the drift going." },
  };

  it("would save, and creates nothing while checking", async () => {
    const v = validateThesisDecision(mintDecision, mintOpts);
    expect(v.ok).toBe(true);
    const outcome = await checkDecisionAgainstSave({
      args: mintArgs,
      pull: { currentPrice: livePrice.DOCU } as never,
      decision: v.decision as ValidatedThesisDecision,
      ctx,
      existing: null,
    });
    expect(outcome).toMatchObject({ wouldSave: true, error: null });
    expect(mockThesisCreate).not.toHaveBeenCalled();
    expect(mockWriteThesisUpdate).not.toHaveBeenCalled();
    expect(mockRecordGateRejection).not.toHaveBeenCalled();
  });

  it("a mint the save would refuse is refused at the check, in the save's words, with nothing created", async () => {
    // The same name is already covered — record_thesis sends the writer to
    // update_thesis rather than minting a second row.
    (prisma.thesis.findFirst as jest.Mock).mockResolvedValue({ id: fx.thesis.id, direction: "LONG", status: "WATCHING" });
    const v = validateThesisDecision(mintDecision, mintOpts);
    const outcome = await checkDecisionAgainstSave({
      args: mintArgs,
      pull: { currentPrice: livePrice.DOCU } as never,
      decision: v.decision as ValidatedThesisDecision,
      ctx,
      existing: null,
    });
    expect(outcome.wouldSave).toBe(false);
    expect(outcome.error).toMatch(/edit_triggers/);
    expect(mockThesisCreate).not.toHaveBeenCalled();
    expect(mockRecordGateRejection).not.toHaveBeenCalled();
  });
});
