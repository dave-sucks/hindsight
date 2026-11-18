/**
 * The work-flag list (needs-action.ts) and the situations read off it
 * (situations.ts): every kind true on a stock, the lead first as today, and
 * the listing rule that replaced get_theses' isFullDetail.
 */
import { readFileSync, statSync } from "fs";
import path from "path";
import { computeNeedsAction, type NeedsActionInput } from "./needs-action";
import { guidanceCodes, guidanceFor, listsTheStock, measuresOf, SITUATIONS, situationLabels, situationsFor, TRIGGER_RUN_LINES, type SituationCode, type SituationSources } from "./situations";
import { MERGED_CODE } from "@/lib/performance/agent-work-terms";
import type { Trigger } from "./triggers/types";

const NOW = new Date("2026-05-09T21:00:00Z"); // a Saturday: no session
const trig = (id: string, action: string, predicate: unknown): Trigger =>
  ({ id, action, predicate, rationale: "r"}) as unknown as Trigger;
const below = (v: number) => ({ watch: "price", is: "below", value: v });
const dayDrop = (v: number) => ({ watch: "move", is: "below", value: v, variable: "prev_close" });
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
    actionability: null,
    buyBlockedByFull: false,
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
    // A review on the day's move: one on the price waits for its crossing's fire row.
    const i = input({ triggers: [trig("rev", "REVIEW", dayDrop(3)), trig("floor", "EXIT", below(80))] }, { latestQuote: { price: 75, changePct: -5 } });
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
  it("MU 10-07: a fired review; nearing an upside line is no situation of its own (no target of our own, 2026-11-16)", () => {
    const i = input({ triggers: [trig("rev", "REVIEW", below(95))] }, { activity: [fire("rev")] });
    expect(situationsFor(sources(i))).toEqual(["REVIEW_DUE"]);
  });

  it("ABT 10-07: a fired review on a watch, and the principal's word unanswered", () => {
    const i = input({ status: "WATCHING", triggers: [trig("rev", "REVIEW", below(115))] }, { activity: [fire("rev")] });
    expect(situationsFor(sources(i, { unansweredDecision: true }))).toEqual(["REVIEW_DUE", "NOTE_TO_ANSWER"]);
  });

  it("an earnings review riding inside a fired sale is a review too", () => {
    const report = trig("er", "REVIEW", { match: "all", conditions: [{ watch: "surprise", is: "beat", value: 0 }, { watch: "move", is: "below", value: 3 }] });
    const i = input({ triggers: [trig("floor", "EXIT", below(80)), report] }, { activity: [fire("floor", 1), fire("er", 3)] });
    expect(situationsFor(sources(i))).toEqual(["PROTECTIVE_SALE", "REVIEW_DUE"]);
  });

  it("a sale true now behind a review true now is on the list, second", () => {
    const i = input({ triggers: [trig("rev", "REVIEW", dayDrop(3)), trig("floor", "EXIT", below(80))] }, { latestQuote: { price: 75, changePct: -5 } });
    expect(situationsFor(sources(i))).toEqual(["REVIEW_DUE", "PROTECTIVE_SALE"]);
  });

  it("a filing review is a review; a sale fire on a stock we don't hold falls to REVIEW_DUE", () => {
    const filed = input({ triggers: [trig("8k", "REVIEW", { watch: "filing", value: "tier:MATERIAL" })] }, { activity: [fire("8k")] });
    expect(situationsFor(sources(filed))).toEqual(["REVIEW_DUE"]);
    const watchedFloor = input({ status: "WATCHING", triggers: [trig("f", "EXIT", below(80))] }, { activity: [fire("f")] });
    expect(situationsFor(sources(watchedFloor))).toEqual(["REVIEW_DUE"]);
  });

  it("a wake on a watch with no view and no clock of its own, and a seed due its first research, are reviews", () => {
    const wake = input({ status: "WATCHING", direction: null, triggers: [trig("w", "REVIEW", below(50))] }, { activity: [fire("w")] });
    expect(situationsFor(sources(wake))).toEqual(["REVIEW_DUE"]);
    const seed = input({ status: "WATCHING", direction: null, lastReviewedAt: null, triggers: [trig("c", "REVIEW", { watch: "repeat", value: 7 })] });
    expect(situationsFor(sources(seed))).toEqual(["REVIEW_DUE"]);
  });

  it("one situation per trigger action: a sale or trim, a buy, an add, anything else a review", () => {
    const held = (action: string) => situationsFor(sources(input({ triggers: [trig("t", action, below(120))] }, { activity: [fire("t")] })));
    const watched = (action: string) => situationsFor(sources(input({ status: "WATCHING", triggers: [trig("t", action, below(120))] }, { activity: [fire("t")] })));
    expect([held("EXIT"), held("TRIM"), watched("ENTER"), held("ADD"), held("REVIEW"), watched("REVIEW")]).toEqual([
      ["PROTECTIVE_SALE"], ["PROTECTIVE_SALE"], ["BUY_ARRIVES"], ["ADD_OR_WINNER"], ["REVIEW_DUE"], ["REVIEW_DUE"],
    ]);
  });

  it("the row's other sources, each once, after the list", () => {
    const watch = input({ status: "WATCHING" });
    expect(situationsFor(sources(watch, { buyBlockedByFull: true, actionability: "ENTER_NOW" }))).toEqual(["BUY_ARRIVES"]);
    expect(situationsFor(sources(watch, { actionability: "ENTER_NOW" }))).toEqual(["BUY_ARRIVES"]);
    expect(situationsFor(sources(watch, { actionability: "STALE_PAST_CATALYST" }))).toEqual([]);
    expect(situationsFor(sources(watch, { soldReview: true }))).toEqual(["SOLD_ONE_REVIEW"]);
    expect(situationsFor(sources(watch, { pinnedNote: true }))).toEqual(["NOTE_TO_ANSWER"]);
    expect(situationsFor(sources(watch, { pinnedNote: true, unansweredDecision: true }))).toEqual(["NOTE_TO_ANSWER"]);
    expect(situationsFor(sources(input({ status: "PROMOTED" })))).toEqual(["PROMOTED_AWAITING"]);
  });

  it("a two-condition group is walked: both measures", () => {
    const group = { match: "all", conditions: [{ watch: "surprise", is: "beat", value: 0 }, { watch: "move", is: "below", value: 3 }] };
    expect(measuresOf(group).map((m) => m.id)).toEqual(["surprise", "move"]);
  });
});

describe("the situations for a person: the sheet's flag line", () => {
  it("MU 10-07: the fired review is the lead's; a note to answer follows it", () => {
    const i = input({ triggers: [trig("rev", "REVIEW", below(95))] }, { activity: [fire("rev")] });
    expect(situationLabels(sources(i, { unansweredDecision: true }))).toEqual([
      { code: "REVIEW_DUE", name: "review due", lead: true },
      { code: "NOTE_TO_ANSWER", name: "a note to answer", lead: false },
    ]);
  });
  it("a sale on an earnings trigger: both codes are the lead's", () => {
    const report = trig("er", "EXIT", { match: "all", conditions: [{ watch: "surprise", is: "miss", value: 0 }, { watch: "price", is: "below", value: 90 }] });
    const i = input({ triggers: [report] }, { activity: [fire("er")] });
    expect(situationLabels(sources(i, { unansweredDecision: true })).map((x) => [x.code, x.lead])).toEqual([
      ["PROTECTIVE_SALE", true],
      ["REVIEW_DUE", true],
      ["NOTE_TO_ANSWER", false],
    ]);
  });
  it("every code has a name of a few plain words", () => {
    expect(Object.keys(SITUATIONS)).toHaveLength(8);
    for (const { name } of Object.values(SITUATIONS)) expect(name.split(" ").length).toBeLessThanOrEqual(4);
  });
});

// The three that took in others' cases end in a paragraph per case; each is capped just above its length (2026-11-15; the buy's triggers_with_buy, 11-17;
// the buy passed on and left as it is fires again only after a close finds it false, and a review that is a playbook's way in, 11-17;
// a pullback buy that touched without the reversal is re-priced to a close above today's high, 11-17;
// a buy passed on is taken off or re-priced to a price the stock has not reached, never to just past today's, 11-17).
const CAP: Partial<Record<SituationCode, number>> = { BUY_ARRIVES: 3_620, REVIEW_DUE: 7_640, NOTE_TO_ANSWER: 3_240 };
const capOf = (code: string) => CAP[code as SituationCode] ?? 2_200;

describe("the guidance: each situation's text, once", () => {
  it("every text is under its cap and says when, what to do and what answers it", () => {
    for (const [code, { guidance }] of Object.entries(SITUATIONS)) {
      expect([code, guidance.length <= capOf(code)]).toEqual([code, true]);
      for (const part of ["When:", "Answered:", "The note:", "Mistakes:"]) expect([code, guidance.includes(part)]).toEqual([code, true]);
    }
  });
  it("each says what its note covers, the company and the stock first; none asks for the bookkeeping", () => {
    // The 10-27 sale notes ("still below the $987.31 line… second day after we let the floor lapse") came from
    // PROTECTIVE_SALE's "say which day of the breach it is… name the rule you followed", and REVIEW_DUE's
    // checklist notes from "saying what you checked".
    for (const [code, { guidance }] of Object.entries(SITUATIONS)) {
      const note = guidance.split("\n").find((l) => l.startsWith("The note: ")) ?? "";
      expect([code, /\b(company|stock)\b/.test(note)]).toEqual([code, true]);
      expect([code, guidance.match(/which day of the breach|name the rule|what you checked and why|say for each whether|full — waiting/g)]).toEqual([code, null]);
    }
  });
  it("each text that can end in a sale says a waiting card is the principal's; the others don't", () => {
    const SAYS = "`proposal_waiting` already shows a sell or trim";
    const withIt = Object.entries(SITUATIONS).filter(([, { guidance }]) => guidance.includes(SAYS)).map(([code]) => code);
    expect(withIt).toEqual(["ADD_OR_WINNER", "PROTECTION", "REVIEW_DUE", "NOTE_TO_ANSWER"]);
    // Once in each, and the trigger run reads it too: its row carries the same line.
    for (const code of withIt) expect(guidanceFor([code as SituationCode], "INTRADAY_TACTICAL")[code as SituationCode]!.split(SAYS)).toHaveLength(2);
  });
  it("comes in rank order, each text once, whatever order the codes arrive in", () => {
    const codes: SituationCode[] = ["NOTE_TO_ANSWER", "PROTECTIVE_SALE", "NOTE_TO_ANSWER", "REVIEW_DUE"];
    expect(Object.keys(guidanceFor(codes))).toEqual(["PROTECTIVE_SALE", "REVIEW_DUE", "NOTE_TO_ANSWER"]);
  });
  it("a promoted stock calls for the promotion's text alone", () => {
    expect(guidanceCodes("PROMOTED", ["PROMOTED_AWAITING", "REVIEW_DUE", "NOTE_TO_ANSWER"])).toEqual(["PROMOTED_AWAITING"]);
    expect(guidanceCodes("HOLDING", ["REVIEW_DUE", "ADD_OR_WINNER"])).toEqual(["REVIEW_DUE", "ADD_OR_WINNER"]);
  });
  it("a trigger run is not handed a situation whose answer needs fields its save lacks", () => {
    const codes: SituationCode[] = ["PROTECTIVE_SALE", "REVIEW_DUE", "SOLD_ONE_REVIEW"];
    expect(guidanceCodes("HOLDING", codes, "INTRADAY_TACTICAL")).toEqual(["PROTECTIVE_SALE", "REVIEW_DUE"]);
    expect(guidanceCodes("HOLDING", codes, "MORNING_PLAN")).toEqual(codes);
    expect(guidanceCodes("HOLDING", codes)).toEqual(codes);
    // A seed's first research is still the morning run's: the trigger run reads that line in its place.
    const theirs = guidanceFor(["REVIEW_DUE"], "INTRADAY_TACTICAL").REVIEW_DUE!;
    expect(theirs).toContain("due its first research on that clock, and the morning run answers it");
    expect(theirs).not.toContain("wait_for_thesis_refresh on the child run");
    expect(guidanceFor(["REVIEW_DUE"], "MORNING_PLAN").REVIEW_DUE).toContain("wait_for_thesis_refresh on the child run");
  });
});

describe("a sale card waiting for the principal silences only that sale", () => {
  const sale = trig("sale", "EXIT", below(120));
  const waiting = { hasPendingSaleProposal: true };
  it("a stock with only the fired sale is quiet while its card waits, and leads with the sale without it", () => {
    const i = input({ triggers: [sale] }, { activity: [fire("sale")] });
    expect(situationsFor(sources(i))).toEqual(["PROTECTIVE_SALE"]);
    const card = sources({ ...i, ...waiting });
    expect(situationsFor(card)).toEqual([]);
    expect(listsTheStock(card)).toBe(false);
  });
  it("a pinned note, the principal's word, a review or an add still list it, and the sale is not among its situations", () => {
    const i = input({ triggers: [sale, trig("add", "ADD", { watch: "price", is: "above", value: 80 }), trig("rev", "REVIEW", { watch: "repeat", value: 7 })], lastReviewedAt: new Date(NOW.getTime() - 9 * 86_400_000) }, { activity: [fire("sale")] });
    const card = (over: Partial<SituationSources>) => sources({ ...i, ...waiting }, over);

    expect(situationsFor(card({ pinnedNote: true }))).toEqual(expect.arrayContaining(["NOTE_TO_ANSWER", "ADD_OR_WINNER", "REVIEW_DUE"]));
    expect(situationsFor(card({ pinnedNote: true }))).not.toContain("PROTECTIVE_SALE");
    expect(listsTheStock(card({ pinnedNote: true }))).toBe(true);
    expect(listsTheStock(card({ unansweredDecision: true }))).toBe(true);
    // With no note, the add and the review are the work.
    expect(situationsFor(card({}))).toEqual(["ADD_OR_WINNER", "REVIEW_DUE"]);
    expect(listsTheStock(card({}))).toBe(true);
  });
  it("the pinned note alone lists a stock whose only other flag is the card's sale", () => {
    const i = input({ triggers: [sale] }, { activity: [fire("sale")], ...waiting });
    expect(situationsFor(sources(i, { pinnedNote: true }))).toEqual(["NOTE_TO_ANSWER"]);
    expect(listsTheStock(sources(i, { pinnedNote: true }))).toBe(true);
    expect(listsTheStock(sources(i))).toBe(false);
  });
});

describe("listsTheStock: today's rule", () => {
  const watch = input({ status: "WATCHING" });
  it("each source that listed a stock before lists it", () => {
    expect(listsTheStock(sources(input({ triggers: [trig("f", "EXIT", below(120))] })))).toBe(true); // a work flag
    expect(listsTheStock(sources(watch, { buyBlockedByFull: true }))).toBe(true);
    expect(listsTheStock(sources(watch, { unansweredDecision: true }))).toBe(true);
    for (const label of ["ENTER_NOW", "PROMOTED_DECIDE_TODAY"]) expect(listsTheStock(sources(watch, { actionability: label }))).toBe(true);
  });
  it("what did not list a stock still does not; a catalyst date behind us no longer does (2026-11-13)", () => {
    expect(listsTheStock(sources(watch))).toBe(false);
    expect(listsTheStock(sources(watch, { actionability: "STALE_PAST_CATALYST" }))).toBe(false);
    expect(listsTheStock(sources(input({})))).toBe(false);
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

  // Recorded 2026-10-08, before plan checks, stale research and "no setup
  // named" were deleted (2026-11-13): those codes are dropped from what main
  // said, and three stocks a plan check alone listed are quiet now.
  const DELETED = new Set(["PLAN_PROBLEM", "STALE_RESEARCH", "NO_SETUP_NAMED"]);
  const LISTED_BY_A_PLAN_CHECK = new Set(["SMCI", "SYK", "GD"]);
  // MU's ADD_OR_WINNER came from three quarters of the way to its target, which went with the target (2026-11-16).
  const NEAR_TARGET = new Set(["MU"]);
  // MU's floor had fired and no close has found it false since: a sale that fired stays on the morning's list (2026-11-17).
  const FIRED_SALE = new Set(["MU"]);
  it.each(stocks.map((s) => [s.ticker, s] as const))("%s: listed as main listed it, with main's lead and its situations", (_t, s) => {
    // Anything that reads the wall clock reads the recorded day.
    jest.useFakeTimers({ now: new Date(s.in.now) });
    const i = revive(s);
    const needs = computeNeedsAction(i);
    const lead = needs[0];
    expect(lead ? [lead.kind, "action" in lead ? lead.action : null, "triggerId" in lead ? lead.triggerId : null] : null).toEqual(s.lead);
    const src: SituationSources = { ...s.src, needs, triggers: i.thesis.triggers };
    expect(listsTheStock(src)).toBe(s.listed && !LISTED_BY_A_PLAN_CHECK.has(s.ticker));
    // Recorded before the merge (2026-11-15): each saved code is the one it is now.
    const codes = s.codes.filter((c) => !DELETED.has(c) && !(c === "ADD_OR_WINNER" && NEAR_TARGET.has(s.ticker)));
    const expected = [...new Set(codes.map((c) => MERGED_CODE[c] ?? c))];
    expect(situationsFor(src)).toEqual(FIRED_SALE.has(s.ticker) && !expected.includes("PROTECTIVE_SALE") ? [...expected, "PROTECTIVE_SALE"] : expected);
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

  it("MA, a live seed with a review clock: due, its one situation is a review; not due, none", () => {
    expect(situationsFor(sources(ma(new Date("2026-11-14T13:00:00Z"))))).toEqual(["REVIEW_DUE"]);
    expect(situationsFor(sources(ma(new Date("2026-10-09T13:00:00Z"))))).toEqual([]);
  });

  it("the review's paragraph on a watch with no view sends the claim through the writer, and never asks a run to write it", () => {
    const text = SITUATIONS.REVIEW_DUE.guidance.slice(SITUATIONS.REVIEW_DUE.guidance.indexOf("If it is a watch with no view yet:"));
    for (const words of ["dispatch_thesis_research", 'mode "refresh"', "existing_thesis_id", "wait_for_thesis_refresh", "commits the view", "never write the claim yourself"]) expect([words, text.includes(words)]).toEqual([words, true]);
    for (const field of ["core_belief", "key_assumptions", "invalidation_conditions", "direction LONG"]) expect([field, SITUATIONS.REVIEW_DUE.guidance.includes(field)]).toEqual([field, false]);
    expect(text).toContain("No write-up yet");
    expect(text).toContain("A failed write-up is dispatched again");
  });
});

describe("the words per run (step 12, part 2)", () => {
  const ALL = Object.keys(SITUATIONS) as SituationCode[];
  it("every trigger-run line replaces a line of its text, word for word", () => {
    for (const [code, pairs] of Object.entries(TRIGGER_RUN_LINES) as Array<[SituationCode, ReadonlyArray<readonly [string, string]>]>) {
      for (const [line] of pairs) expect([code, line, SITUATIONS[code].guidance.includes(line)]).toEqual([code, line, true]);
    }
  });
  it("the trigger run's guidance never names change_status, INVALIDATED or ARCHIVED; it takes the buy and the Stop watching line off by id and the morning run decides", () => {
    const text = Object.values(guidanceFor(guidanceCodes("WATCHING", ALL, "INTRADAY_TACTICAL"), "INTRADAY_TACTICAL")).join("\n");
    const promoted = Object.values(guidanceFor(guidanceCodes("PROMOTED", ALL, "INTRADAY_TACTICAL"), "INTRADAY_TACTICAL")).join("\n");
    for (const word of ["change_status", "INVALIDATED", "ARCHIVED"]) {
      expect([word, text.includes(word)]).toEqual([word, false]);
      expect([word, promoted.includes(word)]).toEqual([word, false]);
    }
    expect(guidanceFor(["REVIEW_DUE"], "INTRADAY_TACTICAL").REVIEW_DUE).toContain("take its buy and its Stop watching line off by id (remove_trigger_ids) and say so in the note; the morning run decides");
    expect(guidanceFor(["PROMOTED_AWAITING"], "INTRADAY_TACTICAL").PROMOTED_AWAITING).toContain("the stock stays promoted and the morning run decides");
  });
  it("the morning run and the chat keep the verbs", () => {
    for (const runMode of ["MORNING_PLAN", "PRINCIPAL_CHAT", undefined]) {
      expect(guidanceFor(["REVIEW_DUE"], runMode).REVIEW_DUE).toContain("change_status INVALIDATED on a stock we watch");
      expect(guidanceFor(["REVIEW_DUE"], runMode).REVIEW_DUE).toContain("Or let it go: update_thesis with change_status ARCHIVED.");
      expect(guidanceFor(["PROMOTED_AWAITING"], runMode).PROMOTED_AWAITING).toContain('change_status "WATCHING"');
    }
  });
  it("every text stays under the cap in every run's words", () => {
    for (const code of ALL) for (const runMode of ["INTRADAY_TACTICAL", "MORNING_PLAN"]) expect([code, runMode, guidanceFor([code], runMode)[code]!.length <= capOf(code)]).toEqual([code, runMode, true]);
  });
});

describe("MA 2026-10-09: a fired review on a watch with no view is a review, whatever its clock (2026-11-15)", () => {
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
  it("a seed with its own clock: REVIEW_DUE, whose paragraph on a watch with no view is its first research", () => {
    expect(situationsFor(sources(ma))).toEqual(["REVIEW_DUE"]);
  });
  it("without a clock of its own the same fire is a review too", () => {
    const quiet = { ...ma, thesis: { ...ma.thesis, triggers: ma.thesis.triggers.slice(0, 1) } };
    expect(situationsFor(sources(quiet))).toEqual(["REVIEW_DUE"]);
  });
  it("a review fired on a stock with a view is REVIEW_DUE", () => {
    const withView = { ...ma, thesis: { ...ma.thesis, direction: "LONG" } };
    expect(situationsFor(sources(withView))).toEqual(["REVIEW_DUE"]);
  });
});
