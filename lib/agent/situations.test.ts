/**
 * The work-flag list (needs-action.ts) and the situations read off it
 * (situations.ts): every kind true on a stock, the lead first as today, and
 * the listing rule that replaced get_theses' isFullDetail.
 */
import { readFileSync, statSync } from "fs";
import path from "path";
import { computeNeedsAction, type NeedsActionInput } from "./needs-action";
import { guidanceCodes, guidanceFor, listsTheStock, measuresOf, SITUATIONS, situationLabels, situationsFor, type SituationCode, type SituationSources } from "./situations";
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
