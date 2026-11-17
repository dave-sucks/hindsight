/**
 * fire-streak.replay.test.ts — DAV-323 / DAV-329, from ABT's real rows.
 *
 * Production, 2026-09-15 → 09-25 (live account 34f5c589). ABT was bought
 * on 09-11 at $103.66 and fell under its 200-day. The Secular Compounder's
 * "below the 200-day → review" rung (cf39ff35, `cooldownDays: 1`) fired on
 * all nine trading days. The morning runs answered it every time, in
 * words, and once with an edit (added a 10-day review). Nothing told them
 * it was the same question again, so the ninth fire reached the run
 * indistinguishable from the first.
 *
 * Three parts:
 *   1–2. the count reaches the run as words                  (get_theses)
 *   3–7. the wait saved on the trigger is the wait            (shouldFire)
 *  8–10. nothing new refuses: the answers the runs really
 *        wrote still finish the run                          (complete_run)
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
  predicate: { watch: "price", is: "below", variable: "sma200" },
  action: "REVIEW",
  rationale: "Below the 200-day — review",
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
 * ABT's log from the 09-18 edit onward: one change to the plan, six fires
 * of the same rung, and three written answers that left the plan as it
 * was. An answer that changes nothing must not reset the count.
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

/** ABT's 09-23 answer, as stored: real words, no edit, no trigger named. */
const ABT_0923_RATIONALE =
  "ABT remains technically messy, with price at $103.69 still below the 50-day and just under the 200-day, " +
  "but I still cannot name a business invalidation 11 days into the hold. There is no second guidance cut, " +
  "no new Libre safety event, and no sign Exact Sciences integration is failing. This is still a " +
  "pullback-and-digestion phase, not a thesis break. I hold.";

const emptyRow = (days: number) =>
  thesisUpdateRow({
    id: `held_${days}`,
    thesisId: "t_abt",
    type: "UPDATED",
    triggerId: null,
    fieldChanges: {},
    summary: "Updated ABT thesis",
    rationale: ABT_0923_RATIONALE,
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
    // Six fires since the 09-18 edit. The three answers in between left
    // the plan as it was, so they don't reset it.
    expect(abt?.needsAction?.repeatCount).toBe(6);
    expect(abt?.needsAction?.repeatLine ?? "").toMatch(/fired 6 times and its triggers have not changed since/);
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

describe("2026-11-17 — a trigger fires when it becomes true, and again only after a close finds it false", () => {
  const ctx = () => ({
    latestQuote: { price: PRICE, changePct: -0.8 },
    indicators: { sma: { 200: 105.2, 50: 104.1 } },
    now: at(0, 13),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  it("3. the Compounder's rule, never fired and true now: it fires", () => {
    expect(shouldFire(reviewRung as unknown as Trigger, ctx())).toEqual({ fires: true, reason: "match" });
  });

  it("4. fired a week ago, and no close has found it false since: it does not fire, however long ago", () => {
    for (const days of [1, 8, 40]) {
      const fired = { ...reviewRung, lastFiredAt: at(days, 13) } as unknown as Trigger;
      expect(shouldFire(fired, ctx())).toEqual({ fires: false, reason: "fired" });
    }
  });

  it("5. a close found it false after the fire: it fires again", () => {
    const ready = { ...reviewRung, lastFiredAt: at(3, 13), falseAtCloseAt: at(2, 20) } as unknown as Trigger;
    expect(shouldFire(ready, ctx()).fires).toBe(true);
  });

  it("6. a sale is the same: fired yesterday and still below, it does not fire again; after a close above, it does", () => {
    for (const action of ["EXIT", "TRIM"]) {
      const sellRung = { ...reviewRung, id: `sell_${action}`, action, lastFiredAt: at(1, 13) } as unknown as Trigger;
      expect(shouldFire(sellRung, ctx())).toEqual({ fires: false, reason: "fired" });
      expect(shouldFire({ ...sellRung, falseAtCloseAt: at(1, 20).toISOString() }, ctx()).fires).toBe(true);
    }
  });

  it("7. a close that found it false before the last fire does not count", () => {
    const fired = { ...reviewRung, lastFiredAt: at(1, 13), falseAtCloseAt: at(3, 20) } as unknown as Trigger;
    expect(shouldFire(fired, ctx())).toEqual({ fires: false, reason: "fired" });
  });
});

/**
 * Part 3. QB ruling on the ticket: "two inputs, one obligation, no gate …
 * nothing new refuses." The first version of this PR held a run whose
 * answer did not name the trigger. Replayed over the live account's 21
 * days that would have held 42 (run, stock) pairs — every one of them a
 * written answer like ABT's below. These three pin that the bar at the
 * end of the run is where main left it.
 */
describe("DAV-323 — nothing new refuses at the end of the run", () => {
  const runRow = () => ({
    id: REPLAY_RUN_ID,
    status: "RUNNING",
    mode: "MORNING_PLAN",
    agentConfigId: REPLAY_ANALYST_ID,
    parameters: {},
    startedAt: at(0, 8),
    completedAt: null,
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

  const completeWith = (answer: Record<string, unknown> | null) => {
    const answerRow = answer
      ? thesisUpdateRow({
          id: "answer",
          thesisId: "t_abt",
          runId: REPLAY_RUN_ID,
          timestamp: at(0, 12),
          ...answer,
        })
      : null;
    // The stock's log: the fire that was waiting when the run sat down, and
    // the run's answer if it wrote one.
    const openFire = fire(1);
    return replayTool("complete-run", "completeRun", {
      seed: {
        researchRun: [runRow()],
        thesis: [abtThesis()],
        position: [abtPosition()],
        runEvent: [summaryEvent()],
        thesisUpdate: answerRow ? [openFire, answerRow] : [openFire],
      },
      args: {},
      quotes: { ABT: PRICE },
    });
  };

  it("8. ABT's 09-23 answer — real words, no edit, no trigger named — finishes the run", async () => {
    const { result, crashed, refused } = await completeWith({
      type: "UPDATED",
      triggerId: null,
      fieldChanges: {},
      summary: "Updated ABT thesis",
      rationale: ABT_0923_RATIONALE,
    });

    expect(crashed).toBe(false);
    expect(refused).toBe(false);
    expect(result.summary).not.toMatch(/refused/i);
  });

  it("9. the same answer with the trigger named finishes it too", async () => {
    const { result, crashed } = await completeWith({
      type: "UPDATED",
      triggerId: REVIEW_RUNG_ID,
      fieldChanges: {},
      summary: "Reviewed ABT against the 200-day",
      rationale: ABT_0923_RATIONALE,
    });

    expect(crashed).toBe(false);
    expect(result.summary).not.toMatch(/refused/i);
  });

  it("10. a run that wrote nothing on the stock is still held, as on main", async () => {
    const { result, crashed } = await completeWith(null);

    expect(crashed).toBe(false);
    expect(result.summary).toMatch(/refused/i);
    expect(JSON.stringify(result)).toContain("ABT");
  });
});
