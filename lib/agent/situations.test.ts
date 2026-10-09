/**
 * The work-flag list (needs-action.ts) and the situations read off it
 * (situations.ts): every kind true on a stock, the lead first as today, and
 * the listing rule that replaced get_theses' isFullDetail.
 */
import { readFileSync, statSync } from "fs";
import path from "path";
import { computeNeedsAction, type NeedsActionInput } from "./needs-action";
import { guidanceCodes, guidanceFor, listsTheStock, measuresOf, SITUATIONS, situationLabels, situationsFor, TRIGGER_RUN_LINES, type SituationCode, type SituationSources } from "./situations";
import type { Trigger } from "./triggers/types";

const NOW = new Date("2026-05-09T21:00:00Z"); // a Saturday: no session
const trig = (id: string, action: string, predicate: unknown): Trigger =>
  ({ id, action, predicate, rationale: "r", cooldownDays: 0 }) as unknown as Trigger;
const below = (v: number) => ({ watch: "price", is: "below", value: v });
const fire = (triggerId: string, hoursAgo = 2) => ({ type: "TRIGGER_FIRED", timestamp: new Date(NOW.getTime() - hoursAgo * 3_600_000), triggerId, runId: null });

function input(thesis: Partial<NeedsActionInput["thesis"]>, over: Partial<NeedsActionInput> = {}): NeedsActionInput {
  return {
    thesis: { id: "t", direction: "LONG", status: "HOLDING", triggers: [], createdAt: new Date("2026-04-01T00:00:00Z"), lastReviewedAt: NOW, ...thesis },
    latestQuote: { price: 100, changePct: 0 },
    now: NOW,
    ...over,
  };
}
function sources(i: NeedsActionInput, over: Partial<SituationSources> = {}): SituationSources {
  return {
    needs: computeNeedsAction(i),
    triggers: i.thesis.triggers,
    status: i.thesis.status ?? "HOLDING",
    direction: i.thesis.direction ?? null,
    planSanity: null,
    actionability: null,
    progressToTarget: null,
    buyBlockedByFull: false,
    nameTheSetup: false,
    unansweredDecision: false,
    ...over,
  };
}

describe("the work-flag list", () => {
  it("a floor too far leads a fired review, and the review stays on the list", () => {
    const i = input(
      { avgCost: 100, quantity: 1000, triggers: [trig("floor", "EXIT", below(80)), trig("rev", "REVIEW", below(95))] },
      { activity: [fire("rev")], equity: 100_000 },
    );
    expect(computeNeedsAction(i).map((f) => f.kind)).toEqual(["FLOOR_TOO_FAR", "TRIGGER_FIRED"]);
  });

  it("every trigger true now is on the list in ladder order; the first leads", () => {
    const i = input({ triggers: [trig("rev", "REVIEW", below(90)), trig("floor", "EXIT", below(80))] }, { latestQuote: { price: 75, changePct: 0 } });
    const list = computeNeedsAction(i);
    expect(list.map((f) => (f.kind === "TRIGGER_MATCHING_NOW" ? `${f.kind}:${f.action}` : f.kind))).toEqual([
      "TRIGGER_MATCHING_NOW:REVIEW",
      "TRIGGER_MATCHING_NOW:EXIT",
    ]);
  });

  it("fires beyond the lead ride inside it, never twice", () => {
    const i = input({ triggers: [trig("a", "EXIT", below(80)), trig("b", "REVIEW", below(95))] }, { activity: [fire("a", 1), fire("b", 3)] });
    const list = computeNeedsAction(i);
    expect(list.filter((f) => f.kind === "TRIGGER_FIRED")).toHaveLength(1);
    const lead = list[0];
    expect(lead.kind === "TRIGGER_FIRED" && lead.alsoFired?.map((x) => x.triggerId)).toEqual(["b"]);
  });

  it("nothing true: an empty list", () => {
    expect(computeNeedsAction(input({}))).toEqual([]);
  });
});

describe("the situations a stock is in", () => {
  it("MU 10-07: a fired review and a holding three quarters of the way to its target", () => {
    const i = input({ triggers: [trig("rev", "REVIEW", below(95))] }, { activity: [fire("rev")] });
    expect(situationsFor(sources(i, { progressToTarget: 0.8 }))).toEqual(["REVIEW_DUE", "ADD_OR_WINNER"]);
  });

  it("ABT 10-07: a fired review on a watch, and the principal's word unanswered", () => {
    const i = input({ status: "WATCHING", triggers: [trig("rev", "REVIEW", below(115))] }, { activity: [fire("rev")] });
    expect(situationsFor(sources(i, { unansweredDecision: true }))).toEqual(["REVIEW_DUE", "YOUR_WORD_UNANSWERED"]);
  });

  it("an earnings review riding inside a fired sale is coded too", () => {
    const report = trig("er", "REVIEW", { match: "all", conditions: [{ watch: "surprise", is: "beat", value: 0 }, { watch: "move", is: "below", value: 3 }] });
    const i = input({ triggers: [trig("floor", "EXIT", below(80)), report] }, { activity: [fire("floor", 1), fire("er", 3)] });
    expect(situationsFor(sources(i))).toEqual(["PROTECTIVE_SALE", "EARNINGS"]);
  });

  it("a sale true now behind a review true now is on the list, second", () => {
    const i = input({ triggers: [trig("rev", "REVIEW", below(90)), trig("floor", "EXIT", below(80))] }, { latestQuote: { price: 75, changePct: 0 } });
    expect(situationsFor(sources(i))).toEqual(["REVIEW_DUE", "PROTECTIVE_SALE"]);
  });

  it("a filing review is FILING; a sale fire on a stock we don't hold falls to REVIEW_DUE", () => {
    const filed = input({ triggers: [trig("8k", "REVIEW", { watch: "filing", value: "tier:MATERIAL" })] }, { activity: [fire("8k")] });
    expect(situationsFor(sources(filed))).toEqual(["FILING"]);
    const watchedFloor = input({ status: "WATCHING", triggers: [trig("f", "EXIT", below(80))] }, { activity: [fire("f")] });
    expect(situationsFor(sources(watchedFloor))).toEqual(["REVIEW_DUE"]);
  });

  it("a wake on a watch with no direction and no clock of its own; a seed due its first research", () => {
    const wake = input({ status: "WATCHING", direction: null, triggers: [trig("w", "REVIEW", below(50))] }, { activity: [fire("w")] });
    expect(situationsFor(sources(wake))).toEqual(["QUIET_WATCH_WOKE"]);
    const seed = input({ status: "WATCHING", direction: null, lastReviewedAt: null, triggers: [trig("c", "REVIEW", { watch: "repeat", value: 7 })] });
    expect(situationsFor(sources(seed))).toEqual(["FIRST_RESEARCH"]);
  });

  it("the row's other sources, each once, after the list", () => {
    const watch = input({ status: "WATCHING" });
    expect(situationsFor(sources(watch, { buyBlockedByFull: true, actionability: "ENTER_NOW" }))).toEqual(["BUY_BLOCKED_FULL"]);
    expect(situationsFor(sources(watch, { actionability: "ENTER_NOW" }))).toEqual(["BUY_ARRIVES"]);
    expect(situationsFor(sources(watch, { actionability: "STALE_PAST_CATALYST", planSanity: [{ kind: "NO_BUY_LEVEL" }] }))).toEqual(["PLAN_PROBLEM"]);
    expect(situationsFor(sources(watch, { soldReview: true, nameTheSetup: true }))).toEqual(["SOLD_ONE_REVIEW", "NO_SETUP_NAMED"]);
    expect(situationsFor(sources(input({ status: "PROMOTED" })))).toEqual(["PROMOTED_AWAITING"]);
  });

  it("a two-condition group is walked: both measures", () => {
    const group = { match: "all", conditions: [{ watch: "surprise", is: "beat", value: 0 }, { watch: "move", is: "below", value: 3 }] };
    expect(measuresOf(group).map((m) => m.id)).toEqual(["surprise", "move"]);
  });
});

describe("the situations for a person: the sheet's flag line", () => {
  it("MU 10-07: the fired review is the lead's; near target follows it", () => {
    const i = input({ triggers: [trig("rev", "REVIEW", below(95))] }, { activity: [fire("rev")] });
    expect(situationLabels(sources(i, { progressToTarget: 0.8 }))).toEqual([
      { code: "REVIEW_DUE", name: "review due", lead: true },
      { code: "ADD_OR_WINNER", name: "add or near target", lead: false },
    ]);
  });
  it("a sale on an earnings trigger: both codes are the lead's", () => {
    const report = trig("er", "EXIT", { match: "all", conditions: [{ watch: "surprise", is: "miss", value: 0 }, { watch: "price", is: "below", value: 90 }] });
    const i = input({ triggers: [report] }, { activity: [fire("er")] });
    expect(situationLabels(sources(i, { unansweredDecision: true })).map((x) => [x.code, x.lead])).toEqual([
      ["PROTECTIVE_SALE", true],
      ["EARNINGS", true],
      ["YOUR_WORD_UNANSWERED", false],
    ]);
  });
  it("every code has a name of a few plain words", () => {
    expect(Object.keys(SITUATIONS)).toHaveLength(16);
    for (const { name } of Object.values(SITUATIONS)) expect(name.split(" ").length).toBeLessThanOrEqual(4);
  });
});

describe("the guidance: each situation's text, once", () => {
  it("every text is under the 2,200-character cap and says when, what to do and what answers it", () => {
    for (const [code, { guidance }] of Object.entries(SITUATIONS)) {
      expect([code, guidance.length <= 2_200]).toEqual([code, true]);
      for (const part of ["When:", "Answered:", "Mistakes:"]) expect([code, guidance.includes(part)]).toEqual([code, true]);
    }
  });
  it("comes in rank order, each text once, whatever order the codes arrive in", () => {
    const codes: SituationCode[] = ["YOUR_WORD_UNANSWERED", "PROTECTIVE_SALE", "YOUR_WORD_UNANSWERED", "EARNINGS"];
    expect(Object.keys(guidanceFor(codes))).toEqual(["PROTECTIVE_SALE", "EARNINGS", "YOUR_WORD_UNANSWERED"]);
  });
  it("a promoted stock calls for the promotion's text alone", () => {
    expect(guidanceCodes("PROMOTED", ["PROMOTED_AWAITING", "STALE_RESEARCH", "NO_SETUP_NAMED"])).toEqual(["PROMOTED_AWAITING"]);
    expect(guidanceCodes("HOLDING", ["REVIEW_DUE", "ADD_OR_WINNER"])).toEqual(["REVIEW_DUE", "ADD_OR_WINNER"]);
  });
  it("a trigger run is not handed a situation whose answer needs fields its save lacks", () => {
    const codes: SituationCode[] = ["PROTECTIVE_SALE", "NO_SETUP_NAMED", "FIRST_RESEARCH", "STALE_RESEARCH", "SOLD_ONE_REVIEW"];
    expect(guidanceCodes("HOLDING", codes, "INTRADAY_TACTICAL")).toEqual(["PROTECTIVE_SALE", "STALE_RESEARCH"]);
    expect(guidanceCodes("HOLDING", codes, "MORNING_PLAN")).toEqual(codes);
    expect(guidanceCodes("HOLDING", codes)).toEqual(codes);
  });
});

describe("listsTheStock: today's rule", () => {
  const watch = input({ status: "WATCHING" });
  it("each source that listed a stock before lists it", () => {
    expect(listsTheStock(sources(input({ triggers: [trig("f", "EXIT", below(120))] })))).toBe(true); // a work flag
    expect(listsTheStock(sources(watch, { planSanity: [{ kind: "ENTRY_FAR_FROM_PRICE" }] }))).toBe(true);
    expect(listsTheStock(sources(watch, { buyBlockedByFull: true }))).toBe(true);
    expect(listsTheStock(sources(watch, { nameTheSetup: true }))).toBe(true);
    expect(listsTheStock(sources(watch, { unansweredDecision: true }))).toBe(true);
    for (const label of ["ENTER_NOW", "STALE_PAST_CATALYST", "PROMOTED_DECIDE_TODAY"]) expect(listsTheStock(sources(watch, { actionability: label }))).toBe(true);
  });
  it("what did not list a stock still does not", () => {
    expect(listsTheStock(sources(watch))).toBe(false);
    expect(listsTheStock(sources(watch, { planSanity: [{ kind: "NO_BUY_LEVEL" }, { kind: "COMPOSITE_BELOW_MINIMUM" }] }))).toBe(false);
    expect(listsTheStock(sources(input({}), { progressToTarget: 0.9 }))).toBe(false);
    expect(listsTheStock(sources(watch, { actionability: "WAIT_FOR_TRIGGER" }))).toBe(false);
  });
});

// ─── The live book, replayed ─────────────────────────────────────────────────

const FIXTURE = path.join(__dirname, "__fixtures__/situations-live-book.jsonl");
type Stored = {
  ticker: string;
  listed: boolean;
  lead: [string, string | null, string | null] | null;
  codes: string[];
  in: Record<string, unknown> & { thesis: Record<string, unknown>; now: string };
  src: Omit<SituationSources, "needs" | "triggers">;
};
const stocks: Stored[] = readFileSync(FIXTURE, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const date = (v: unknown) => (v == null ? (v as null | undefined) : new Date(v as string));

function revive(s: Stored): NeedsActionInput {
  const t = s.in.thesis;
  const rows = (v: unknown) => (v as Array<Record<string, unknown>> | undefined)?.map((r) => ({ ...r, timestamp: new Date(r.timestamp as string) }));
  return {
    thesis: {
      ...t,
      createdAt: new Date(t.createdAt as string),
      lastReviewedAt: date(t.lastReviewedAt) as Date | null,
      researchUpdatedAt: date(t.researchUpdatedAt),
      triggers: t.triggers as Trigger[],
    } as NeedsActionInput["thesis"],
    activity: rows(s.in.activity) as NeedsActionInput["activity"],
    recentUpdates: rows(s.in.recentUpdates) as NeedsActionInput["recentUpdates"],
    latestQuote: s.in.price != null ? { price: s.in.price as number, changePct: 0 } : null,
    now: new Date(s.in.now),
    hasPendingEntryProposal: s.in.pending as boolean,
    declinedSale: s.in.declinedSale as NeedsActionInput["declinedSale"],
    equity: s.in.equity as number | null,
  };
}

describe("the live book after the close, replayed", () => {
  afterAll(() => jest.useRealTimers());

  it("is small: under the 80 KB cap", () => {
    expect(statSync(FIXTURE).size).toBeLessThanOrEqual(80_000);
    expect(stocks.filter((s) => s.listed).length).toBeGreaterThanOrEqual(10);
  });

  it.each(stocks.map((s) => [s.ticker, s] as const))("%s: listed as main listed it, with main's lead and its situations", (_t, s) => {
    // Research age is counted from the wall clock.
    jest.useFakeTimers({ now: new Date(s.in.now) });
    const i = revive(s);
    const needs = computeNeedsAction(i);
    const lead = needs[0];
    expect(lead ? [lead.kind, "action" in lead ? lead.action : null, "triggerId" in lead ? lead.triggerId : null] : null).toEqual(s.lead);
    const src: SituationSources = { ...s.src, needs, triggers: i.thesis.triggers };
    expect(listsTheStock(src)).toBe(s.listed);
    expect(situationsFor(src)).toEqual(s.codes);
  });
});

describe("a seed's claim is the writer's (step 12, part 1)", () => {
  // MA as the chat minted it on 2026-09-29: no view, no claim, a strength wake and a 45-day review clock.
  const ma = (now: Date) =>
    input(
      {
        id: "cmum2tf9m000d04jfv0szuiap",
        status: "WATCHING",
        direction: null,
        lastReviewedAt: null,
        createdAt: new Date("2026-09-29T02:47:48.106Z"),
        triggers: [
          trig("e3c45d50-56de-4a17-9bf1-91e9c69c56ee", "REVIEW", { watch: "strength", value: 0, settings: { window: "6M" } }),
          trig("a2e0f9b5-8b48-4e7a-b91e-7bc2bb350006", "REVIEW", { watch: "repeat", value: 45 }),
        ],
      },
      { now },
    );

  it("MA, a live seed with a review clock: due, its one situation is FIRST_RESEARCH; not due, none", () => {
    expect(situationsFor(sources(ma(new Date("2026-11-14T13:00:00Z"))))).toEqual(["FIRST_RESEARCH"]);
    expect(situationsFor(sources(ma(new Date("2026-10-09T13:00:00Z"))))).toEqual([]);
  });

  it("FIRST_RESEARCH and a woken watch send the claim through the writer, and never ask a run to write it", () => {
    for (const code of ["FIRST_RESEARCH", "QUIET_WATCH_WOKE"] as const) {
      const text = guidanceFor([code])[code]!;
      for (const words of ["dispatch_thesis_research", 'mode "refresh"', "existing_thesis_id", "wait_for_thesis_refresh", "commits the view"]) expect([code, words, text.includes(words)]).toEqual([code, words, true]);
      for (const field of ["core_belief", "key_assumptions", "invalidation_conditions", "direction LONG"]) expect([code, field, text.includes(field)]).toEqual([code, field, false]);
    }
    expect(SITUATIONS.FIRST_RESEARCH.guidance).toContain("No write-up yet");
    expect(SITUATIONS.FIRST_RESEARCH.guidance).toContain("A failed write-up is dispatched again");
  });
});

describe("the words per run (step 12, part 2)", () => {
  const ALL = Object.keys(SITUATIONS) as SituationCode[];
  it("every trigger-run line replaces a line of its text, word for word", () => {
    for (const [code, pairs] of Object.entries(TRIGGER_RUN_LINES) as Array<[SituationCode, ReadonlyArray<readonly [string, string]>]>) {
      for (const [line] of pairs) expect([code, line, SITUATIONS[code].guidance.includes(line)]).toEqual([code, line, true]);
    }
  });
  it("the trigger run's guidance never names change_status, INVALIDATED or ARCHIVED; it takes the plan down by id and the morning run decides", () => {
    const text = Object.values(guidanceFor(guidanceCodes("WATCHING", ALL, "INTRADAY_TACTICAL"), "INTRADAY_TACTICAL")).join("\n");
    const promoted = Object.values(guidanceFor(guidanceCodes("PROMOTED", ALL, "INTRADAY_TACTICAL"), "INTRADAY_TACTICAL")).join("\n");
    for (const word of ["change_status", "INVALIDATED", "ARCHIVED"]) {
      expect([word, text.includes(word)]).toEqual([word, false]);
      expect([word, promoted.includes(word)]).toEqual([word, false]);
    }
    expect(guidanceFor(["REVIEW_DUE"], "INTRADAY_TACTICAL").REVIEW_DUE).toContain("take its buy, floor and target down by id (remove_trigger_ids) and say so in the note; the morning run decides");
    expect(guidanceFor(["PROMOTED_AWAITING"], "INTRADAY_TACTICAL").PROMOTED_AWAITING).toContain("the stock stays promoted and the morning run decides");
  });
  it("the morning run and the chat keep the verbs", () => {
    for (const runMode of ["MORNING_PLAN", "PRINCIPAL_CHAT", undefined]) {
      expect(guidanceFor(["REVIEW_DUE"], runMode).REVIEW_DUE).toContain("change_status INVALIDATED on a stock we watch");
      expect(guidanceFor(["QUIET_WATCH_WOKE"], runMode).QUIET_WATCH_WOKE).toContain("change_status ARCHIVED");
      expect(guidanceFor(["PROMOTED_AWAITING"], runMode).PROMOTED_AWAITING).toContain('change_status "WATCHING"');
    }
  });
  it("every text stays under the cap in every run's words", () => {
    for (const code of ALL) for (const runMode of ["INTRADAY_TACTICAL", "MORNING_PLAN"]) expect([code, runMode, guidanceFor([code], runMode)[code]!.length <= 2_200]).toEqual([code, runMode, true]);
  });
  it("a refresh changes a stock's levels or tier", () => {
    expect(SITUATIONS.STALE_RESEARCH.guidance).toContain("change its levels or tier if the new work changed your view");
    expect(SITUATIONS.STALE_RESEARCH.guidance).not.toContain("levels or conviction");
  });
});

describe("MA 2026-10-09: a fired review on a seed with its own clock is its first research (step 12, part 2)", () => {
  // MA's row and the strength wake's fire at 13:30:17 UTC, as stored.
  const ma = input(
    {
      id: "cmum2tf9m000d04jfv0szuiap",
      status: "WATCHING",
      direction: null,
      lastReviewedAt: null,
      createdAt: new Date("2026-09-29T02:47:48.106Z"),
      triggers: [
        trig("e3c45d50-56de-4a17-9bf1-91e9c69c56ee", "REVIEW", { watch: "strength", value: 0, settings: { window: "6M" } }),
        trig("a2e0f9b5-8b48-4e7a-b91e-7bc2bb350006", "REVIEW", { watch: "repeat", value: 45 }),
      ],
    },
    { now: new Date("2026-10-09T14:00:00Z"), activity: [{ type: "TRIGGER_FIRED", timestamp: new Date("2026-10-09T13:30:17.414Z"), triggerId: "e3c45d50-56de-4a17-9bf1-91e9c69c56ee", runId: null }] },
  );
  it("codes FIRST_RESEARCH, not REVIEW_DUE", () => {
    expect(situationsFor(sources(ma))).toEqual(["FIRST_RESEARCH"]);
  });
  it("without a clock of its own the same fire is a woken watch, as before", () => {
    const quiet = { ...ma, thesis: { ...ma.thesis, triggers: ma.thesis.triggers.slice(0, 1) } };
    expect(situationsFor(sources(quiet))).toEqual(["QUIET_WATCH_WOKE"]);
  });
  it("a review fired on a stock with a view is still REVIEW_DUE", () => {
    const withView = { ...ma, thesis: { ...ma.thesis, direction: "LONG" } };
    expect(situationsFor(sources(withView))).toEqual(["REVIEW_DUE"]);
  });
});
