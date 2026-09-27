/**
 * fire-streak.replay.test.ts — DAV-323 / DAV-329, from ABT's real rows.
 *
 * Production, 2026-09-15 → 09-25 (live account 34f5c589). ABT was bought
 * on 09-11 at $103.66 and fell under its 200-day. The Secular Compounder's
 * "below the 200-day → review" rung (cf39ff35, `cooldownDays: 1`) fired on
 * all nine trading days. The morning runs answered it with, in order: an
 * empty row, a real edit (added a 10-day review), an empty row, an empty
 * row, an empty row — none of them naming the rung. Every one cleared the
 * obligation, so the ninth fire reached the run indistinguishable from the
 * first.
 *
 * Three cases, three parts of the ruling:
 *   1. the count reaches the run as words                 (get_theses)
 *   2. a state rung asks weekly, a buy on one still daily (shouldFire)
 *   3. an empty row that names nothing does not answer    (complete_run)
 *
 * Every case asserts through the tool's real entry point, and `crashed`
 * is checked before the refusal — complete_run catches its own crash and
 * a thrown preflight would otherwise read as a pass.
 */
import { shouldFire } from "@/lib/agent/triggers/evaluate";
import type { Trigger } from "@/lib/agent/triggers/types";
import {
  replayTool,
  thesisRow,
  positionRow,
  thesisUpdateRow,
  REPLAY_ANALYST_ID,
  REPLAY_RUN_ID,
} from "@/lib/replay";

/** The Compounder's rung, exactly as it is stored on the live account. */
const REVIEW_RUNG_ID = "cf39ff35-5a15-43d4-a0f1-911cb5fd519b";
const AVG_COST = 103.66;
const PRICE = 99.4;

/** A timestamp `days` back at `hour` local — the runs land ~12:0x, the fires ~13:3x. */
const at = (days: number, hour: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 30, 0, 0);
  return d;
};

const reviewRung = {
  id: REVIEW_RUNG_ID,
  predicate: { kind: "VS_SMA", period: 200, direction: "BELOW" },
  action: "REVIEW",
  rationale: "Below the 200-day — review",
  cooldownDays: 1,
  source: "ANALYST",
};

const abtThesis = (over: Record<string, unknown> = {}) =>
  thesisRow({
    id: "t_abt",
    ticker: "ABT",
    status: "HOLDING",
    horizon: "COMPOUNDER",
    entryPrice: AVG_COST,
    targetPrice: 130,
    stopLoss: 92,
    lastReviewedAt: at(1, 12),
    triggers: [reviewRung],
    ...over,
  });

const abtPosition = () =>
  positionRow({ id: "pos_abt", symbol: "ABT", avgCost: AVG_COST, quantity: 88 });

/**
 * ABT's log from the 09-18 edit onward: one real change, six fires of the
 * same rung, and three empty rows that changed and named nothing. The
 * empty rows must not reset the count — that is the whole finding.
 */
const fire = (days: number) =>
  thesisUpdateRow({
    id: `fire_${days}`,
    thesisId: "t_abt",
    type: "TRIGGER_FIRED",
    triggerId: REVIEW_RUNG_ID,
    runId: null,
    summary: "Price below the 200-day — review — deferred to the next daily review",
    timestamp: at(days, 13),
  });

const emptyRow = (days: number) =>
  thesisUpdateRow({
    id: `empty_${days}`,
    thesisId: "t_abt",
    type: "UPDATED",
    triggerId: null,
    fieldChanges: {},
    summary: "Updated ABT thesis",
    timestamp: at(days, 12),
  });

const abtLog = () => [
  // 09-18 12:06 — the last thing that actually changed.
  thesisUpdateRow({
    id: "edit_9",
    thesisId: "t_abt",
    type: "UPDATED",
    triggerId: null,
    fieldChanges: { triggerOps: { from: null, to: "added: review every 10 days" } },
    summary: "Updated ABT: Added: review every 10 days",
    timestamp: at(9, 12),
  }),
  fire(9),
  emptyRow(6),
  fire(6),
  fire(5),
  emptyRow(4),
  fire(4),
  fire(3),
  emptyRow(2),
  fire(2),
];

/** `data.theses` carries `needsAction`; `data.cards` carries `needs_action`. */
type ThesisOut = {
  ticker: string;
  needsAction?: { kind?: string; repeatCount?: number; repeatLine?: string } | null;
};
const rowsFrom = (result: unknown): ThesisOut[] =>
  (result as { data?: { theses?: ThesisOut[] } }).data?.theses ?? [];

describe("DAV-323 — the run is told how long this has been asking", () => {
  it("1. get_theses carries the repeat count and the date nothing changed since", async () => {
    const { result, crashed } = await replayTool("get-theses", "getTheses", {
      seed: {
        thesis: [abtThesis()],
        position: [abtPosition()],
        thesisUpdate: abtLog(),
      },
      args: {},
      quotes: { ABT: PRICE },
    });

    expect(crashed).toBe(false);
    const abt = rowsFrom(result).find((t) => t.ticker === "ABT");
    expect(abt?.needsAction?.kind).toBe("TRIGGER_FIRED");
    // Six fires since the 09-18 edit. The three empty rows in between
    // changed nothing, so they don't reset it.
    expect(abt?.needsAction?.repeatCount).toBe(6);
    expect(abt?.needsAction?.repeatLine ?? "").toMatch(/fired 6 times/);
  });

  it("2. a first ask gets no repeat line — there is no history to report", async () => {
    const { result, crashed } = await replayTool("get-theses", "getTheses", {
      seed: {
        thesis: [abtThesis()],
        position: [abtPosition()],
        thesisUpdate: [
          thesisUpdateRow({
            id: "edit_9",
            thesisId: "t_abt",
            type: "UPDATED",
            fieldChanges: { stopLoss: { from: 90, to: 92 } },
            timestamp: at(3, 12),
          }),
          fire(2),
        ],
      },
      args: {},
      quotes: { ABT: PRICE },
    });

    expect(crashed).toBe(false);
    const abt = rowsFrom(result).find((t) => t.ticker === "ABT");
    expect(abt?.needsAction?.kind).toBe("TRIGGER_FIRED");
    expect(abt?.needsAction?.repeatCount).toBeUndefined();
    expect(abt?.needsAction?.repeatLine).toBeUndefined();
  });
});

describe("DAV-329 — a state asks weekly; a buy on the same state still asks daily", () => {
  const ctx = (days: number) => ({
    latestQuote: { price: PRICE, changePct: -0.8 },
    indicators: { sma: { 200: 105.2, 50: 104.1 } },
    now: at(0, 13),
    // Fired `days` ago.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  it("3. the Compounder's rung carries cooldownDays: 1 and still waits a week", () => {
    const firedYesterday = { ...reviewRung, lastFiredAt: at(1, 13) } as unknown as Trigger;
    expect(shouldFire(firedYesterday, ctx(1))).toEqual({
      fires: false,
      reason: "cooldown",
    });
  });

  it("4. …and asks again once the week is up", () => {
    const firedLastWeek = { ...reviewRung, lastFiredAt: at(8, 13) } as unknown as Trigger;
    expect(shouldFire(firedLastWeek, ctx(8)).fires).toBe(true);
  });

  it("5. GD/GEV/SYK buy on the same predicate — that one still fires the next day", () => {
    const buyRung = {
      ...reviewRung,
      id: "buy_rung",
      action: "ENTER",
      predicate: { kind: "VS_SMA", period: 50, direction: "ABOVE" },
      lastFiredAt: at(1, 13),
    } as unknown as Trigger;
    // Above the 50-day now, below it at the prior close — a real crossing.
    const buyCtx = {
      latestQuote: { price: 106, changePct: 1.2, prevClose: 103 },
      indicators: { sma: { 200: 105.2, 50: 104.1 } },
      now: at(0, 13),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    expect(shouldFire(buyRung, buyCtx).fires).toBe(true);
  });
});

/**
 * Part 3. The run's own first write used to erase the obligation before
 * the preflight looked, so these three cases all passed identically on
 * main — including the one that answered nothing.
 */
describe("DAV-323 — an empty row that names nothing does not answer a fire", () => {
  const runRow = () => ({
    id: REPLAY_RUN_ID,
    status: "RUNNING",
    mode: "MORNING_PLAN",
    agentConfigId: REPLAY_ANALYST_ID,
    parameters: {},
    startedAt: at(0, 8),
    completedAt: null,
  });

  /** The fire that was open when the run sat down. */
  const openFire = () => ({
    type: "TRIGGER_FIRED",
    triggerId: REVIEW_RUNG_ID,
    timestamp: at(1, 13),
  });

  const summaryEvent = () => ({
    id: "ev_summary",
    runId: REPLAY_RUN_ID,
    type: "run_summary",
    title: "Run summary",
    message: "Reviewed the book.",
    payload: {},
    createdAt: new Date(),
  });

  const completeWith = (answer: Record<string, unknown>) =>
    replayTool("complete-run", "completeRun", {
      seed: {
        researchRun: [runRow()],
        thesis: [abtThesis({ updates: [openFire()] })],
        position: [abtPosition()],
        runEvent: [summaryEvent()],
        thesisUpdate: [
          thesisUpdateRow({
            id: "answer",
            thesisId: "t_abt",
            runId: REPLAY_RUN_ID,
            timestamp: at(0, 12),
            ...answer,
          }),
        ],
      },
      args: {},
      quotes: { ABT: PRICE },
    });

  it("6. the 09-21 shape — an empty row, no trigger named — leaves the run unfinished", async () => {
    const { result, crashed } = await completeWith({
      type: "UPDATED",
      triggerId: null,
      fieldChanges: {},
      summary: "Updated ABT thesis",
    });

    expect(crashed).toBe(false);
    expect(result.summary).toMatch(/refused/i);
    // …and refused for THIS reason, not some other preflight complaint:
    // the message has to name the stock and the rung it is still owed.
    const said = JSON.stringify(result);
    expect(said).toContain("ABT");
    expect(said).toContain("trigger fired");
    expect(said).toContain(REVIEW_RUNG_ID);
  });

  it("7. the same empty row, with the rung named, is a legal answer", async () => {
    const { result, crashed } = await completeWith({
      type: "UPDATED",
      triggerId: REVIEW_RUNG_ID,
      fieldChanges: {},
      summary: "Reviewed ABT against the 200-day",
      rationale:
        "Checked the Q2 print and the guide — both intact. Below the 200-day is price, not the business. Plan stands.",
    });

    expect(crashed).toBe(false);
    expect(result.summary).not.toMatch(/refused/i);
  });

  it("8. changing the plan answers it too, named or not", async () => {
    const { result, crashed } = await completeWith({
      type: "UPDATED",
      triggerId: null,
      fieldChanges: { stopLoss: { from: 92, to: 95 } },
      summary: "Updated ABT: floor 92 → 95",
    });

    expect(crashed).toBe(false);
    expect(result.summary).not.toMatch(/refused/i);
  });
});

