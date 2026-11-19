/**
 * The Writer's save, three rules from the review of #1051:
 * - A. A LONG or SHORT watch the save would leave with nothing that can fire
 *   is refused, with what to do instead (it had become one reminder after the
 *   save). A watch the save puts its playbook's watch triggers on passes.
 * - B. A look-again is the day after the next report or the day after the
 *   stock's event date, never a review clock that every note restarts.
 * - C. A new watch keeps one trigger of each kind, and one left out says so
 *   on the stock: a look-again used to vanish behind the clock it was sent with.
 *
 * Decisions from real Writer runs (the yardstick's runs of 2026-11-19):
 * - SNDK (sndk-writer-watch, runs 1, 3, 5): LONG, no playbook, "look again
 *   after the January report"; the chart of 2026-11-03.
 * - CORT (local-cort-writer-mint, runs 2 and 4): LONG on PRE_CATALYST, the
 *   FDA decision on 2026-12-17, "review the day after the FDA decision"
 *   (sent as on_date 2026-12-18); CORT's chart on 2026-11-19.
 * No Writer run has ever been sent with a review clock (17 production runs
 * carry the field, all empty), so CORT's is sent with the 30-day clock the
 * watchlist's "Send to research" can give it.
 * - MA (cmum2tf9m000d04jfv0szuiap): a watch on MA_PULLBACK, cleared for its
 *   rewrite (scripts/rewrite-watches.ts); its chart on 2026-11-19.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));
import { buildWriterSaveCall, checkDecisionAgainstSave, nothingCanFireRefusal, writerPlaybookWrites, type RunThesisWriterArgs, type StockForSave } from "./run-thesis-writer";
import type { ValidatedThesisDecision } from "./thesis-research/decision";
import { playbookTemplates } from "@/lib/agent/knowledge/playbooks";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { triggerInputSchema } from "@/lib/agent/triggers/schema";
import type { Trigger } from "@/lib/agent/triggers/types";

const playbooks = (id: string) => playbookTemplates(null, id);
const said = (ts: unknown) => ((ts ?? []) as Array<Record<string, unknown>>).map((t) => sentenceOf(triggerInputSchema.parse(t) as unknown as Trigger));
const args = (ticker: string, extra: Partial<RunThesisWriterArgs> = {}) => ({ childRunId: "run", analystId: "a", ticker, mode: "mint", reason: "r", ...extra }) as RunThesisWriterArgs;
const pull = (priceStructure: unknown) => ({ priceStructure, catalystOnFile: null, currentPrice: null, companyName: null, exchange: null }) as never;
const belief = { rationale: "r", horizon: "CATALYST" as const, core_belief: "b", key_assumptions: ["a", "b"], invalidation_conditions: ["a", "b"], conviction: "MEDIUM" as const };

const SNDK_CHART = {
  price: 1126.52,
  base: null,
  gaps: [{ date: "2026-11-03", direction: "UP", pct: 3.0, low: 1100.53, mid: 1126.86, high: 1153.19 }],
  range: { high20: 1733.28, low20: 1067.4, high52w: 2354.39, low52w: 183 },
  swings: { lastHigh: { price: 1909.48, date: "2026-09-22" }, lastLow: { price: 1659.02, date: "2026-09-28" } },
};
const SNDK = { ...belief, direction: "LONG", catalyst_date: "2027-01-27", look_again: { after_next_report: true, why: "Check whether the January 27 print produces a clean beat-and-raise with the gap held on volume." } } as ValidatedThesisDecision;

const CORT_CHART = {
  price: 67.79,
  base: null,
  gaps: [{ date: "2026-11-12", direction: "DOWN", pct: -3.09, volumeRatio: 0.66, low: 72.23, mid: 73.86, high: 75.5 }],
  range: { high20: 115.73, low20: 67.09, high52w: 126.38, low52w: 28.66, pctBelow52wHigh: 46.4, pctAbove52wLow: 136.5 },
  swings: { lastHigh: { price: 122.8087, date: "2026-10-13" }, lastLow: { price: 108.412, date: "2026-09-18" } },
};
const CORT = { ...belief, direction: "LONG", setup_id: "PRE_CATALYST", catalyst_date: "2026-12-17", look_again: { after_event: true, why: "Review the day after the FDA decision: if approved, price the new setup on the post-approval chart." } } as ValidatedThesisDecision;

const MA_CHART = {
  price: 643.37,
  base: { pivot: 681.99, low: 605, depthPct: 11.3, lengthBars: 22, startDate: "2026-10-20", endDate: "2026-11-18", lastContractionPct: 6.7, brokenOut: false },
  gaps: [],
  range: { high20: 681.99, low20: 605, high52w: 681.99, low52w: 464.52, pctBelow52wHigh: 5.7, pctAbove52wLow: 38.5 },
  swings: { lastHigh: { price: 681.99, date: "2026-11-05" }, lastLow: { price: 605, date: "2026-10-28" } },
};
const MA_CLEARED: StockForSave = { direction: "LONG", status: "WATCHING", setupId: "MA_PULLBACK", triggers: [] };
const MA = { ...belief, horizon: "TARGET", direction: "LONG", catalyst_date: undefined } as ValidatedThesisDecision;

describe("A. a watch the save would leave with nothing that can fire is refused", () => {
  it("SNDK's view with no playbook and its look-again after the January report saves, with that one review", () => {
    const call = buildWriterSaveCall(args("SNDK"), pull(SNDK_CHART), SNDK, {}, null, playbooks);
    expect(said(call.toolArgs.triggers)).toEqual(["Review if within 1 day after earnings"]);
    expect(nothingCanFireRefusal(call, SNDK, null)).toBeNull();
  });

  it("the same view with no look-again is refused at the check, saying what to do", async () => {
    const { look_again: _l, ...noLook } = SNDK;
    void _l;
    const call = buildWriterSaveCall(args("SNDK"), pull(SNDK_CHART), noLook as ValidatedThesisDecision, {}, null, playbooks);
    expect(call.toolArgs.triggers).toEqual([]);
    const refusal =
      "This would save a LONG watch with nothing on it that can fire: no buy, no trigger and no review, so it could never come back. " +
      "Name the playbook whose watch triggers this chart can price today (setup_id), or give look_again: after_next_report, or after_event with the event's date in catalyst_date. Or PASS with the reason.";
    expect(nothingCanFireRefusal(call, noLook as ValidatedThesisDecision, null)).toBe(refusal);
    // The check is the save's: it says so before the save is tried, and the Writer can fix it.
    await expect(checkDecisionAgainstSave({ args: args("SNDK"), pull: pull(SNDK_CHART), decision: noLook as ValidatedThesisDecision, ctx: {} as never, existing: null, playbooks })).resolves.toEqual({ thesisId: null, wouldSave: false, error: refusal, fixable: true });
  });

  it("an old watch the rewrite put its playbook's triggers on (scripts/rewrite-watches.ts) passes: a refresh on the same playbook leaves them", () => {
    const named = { ...MA, setup_id: "MA_PULLBACK" } as ValidatedThesisDecision;
    const stamped = writerPlaybookWrites(named, { priceStructure: MA_CHART } as never, { ...MA_CLEARED, setupId: null }, playbooks).add.map((t, i) => ({ ...(triggerInputSchema.parse(t) as Trigger), id: `stamp-${i}` }));
    const stock: StockForSave = { ...MA_CLEARED, triggers: stamped };
    const call = buildWriterSaveCall(args("MA", { mode: "refresh", existingThesisId: "cmum2tf9m000d04jfv0szuiap" }), pull(MA_CHART), named, {}, stock, playbooks);
    expect(call.toolArgs.add_triggers).toBeUndefined();
    expect(nothingCanFireRefusal(call, named, stock)).toBeNull();
  });

  // On a refresh, naming the stock's own playbook puts nothing on (#1065), so the advice is only what can pass there.
  const REFRESH_FIX =
    "This would save a LONG watch with nothing on it that can fire: no buy, no trigger and no review, so it could never come back. " +
    "Give look_again: after_next_report, or after_event with the event's date in catalyst_date. A refresh puts a playbook's watch triggers on only when it names another playbook than MA_PULLBACK whose triggers this chart can price today.";

  it("cleared and nothing put on, a refresh naming its own playbook again writes none, so it is refused, and told what can pass", () => {
    const named = { ...MA, setup_id: "MA_PULLBACK" } as ValidatedThesisDecision;
    const call = buildWriterSaveCall(args("MA", { mode: "refresh", existingThesisId: "cmum2tf9m000d04jfv0szuiap" }), pull(MA_CHART), named, {}, MA_CLEARED, playbooks);
    expect(call.toolArgs.add_triggers).toBeUndefined();
    expect(nothingCanFireRefusal(call, named, MA_CLEARED)).toBe(REFRESH_FIX);
  });

  it("the same rewrite naming no playbook and no look-again is refused the same way; a view keeps its direction, so no PASS is offered", () => {
    const call = buildWriterSaveCall(args("MA", { mode: "refresh", existingThesisId: "cmum2tf9m000d04jfv0szuiap" }), pull(MA_CHART), MA, {}, MA_CLEARED, playbooks);
    expect(nothingCanFireRefusal(call, MA, MA_CLEARED)).toBe(REFRESH_FIX);
  });

  it("a refresh that names a playbook with no watch triggers takes the stock's off and puts none on: told to keep its playbook", () => {
    const named = { ...MA, setup_id: "ESTIMATE_REVISION" } as ValidatedThesisDecision;
    const onIt = writerPlaybookWrites({ ...MA, setup_id: "MA_PULLBACK" } as ValidatedThesisDecision, { priceStructure: MA_CHART } as never, { ...MA_CLEARED, setupId: null }, playbooks).add.map((t, i) => ({ ...(triggerInputSchema.parse(t) as Trigger), id: `stamp-${i}` }));
    const stock: StockForSave = { ...MA_CLEARED, triggers: onIt };
    const call = buildWriterSaveCall(args("MA", { mode: "refresh", existingThesisId: "cmum2tf9m000d04jfv0szuiap" }), pull(MA_CHART), named, {}, stock, playbooks);
    expect(call.toolArgs.remove_trigger_ids).toHaveLength(3);
    expect(nothingCanFireRefusal(call, named, stock)).toBe(
      "This would save a LONG watch with nothing on it that can fire: no buy, no trigger and no review, so it could never come back. " +
        "Keep its playbook (MA_PULLBACK): naming another takes its triggers off, and the one named puts none on that this chart can price today. Or give look_again: after_next_report, or after_event with the event's date in catalyst_date.",
    );
  });

  it("a PASS, a stock we hold, or a refresh that leaves the stock's own triggers on are not refused", () => {
    const pass = { ...MA, direction: "PASS" } as ValidatedThesisDecision;
    const refresh = args("MA", { mode: "refresh", existingThesisId: "x" });
    expect(nothingCanFireRefusal(buildWriterSaveCall(refresh, pull(MA_CHART), pass, {}, MA_CLEARED, playbooks), pass, MA_CLEARED)).toBeNull();
    const held: StockForSave = { ...MA_CLEARED, status: "HOLDING" };
    expect(nothingCanFireRefusal(buildWriterSaveCall(refresh, pull(MA_CHART), MA, {}, held, playbooks), MA, held)).toBeNull();
    const own = { id: "own", action: "REVIEW", predicate: { watch: "report", is: "before", value: 3 }, rationale: "Before the print." } as Trigger;
    const kept: StockForSave = { ...MA_CLEARED, triggers: [own] };
    expect(nothingCanFireRefusal(buildWriterSaveCall(refresh, pull(MA_CHART), MA, {}, kept, playbooks), MA, kept)).toBeNull();
  });
});

describe("B and C. a new watch keeps its look-again beside the clock it was sent with", () => {
  it("CORT, sent with a 30-day clock: the clock and the look-again the day after the FDA decision both stand; the playbook's 7-day clock is not written, and says so", () => {
    const call = buildWriterSaveCall(args("CORT", { reviewCadenceDays: 30 }), pull(CORT_CHART), CORT, {}, null, playbooks);
    const saved = said(call.toolArgs.triggers);
    expect(saved).toContain("Review every 30 days");
    expect(saved).toContain("Review 1 day after the event date");
    expect(saved).not.toContain("Review every 7 days");
    expect(call.toolArgs.catalyst_date).toBe("2026-12-17T00:00:00.000Z");
    expect(call.notWritten).toContainEqual({ field: "triggers", why: "the playbook's Review every 7 days", reason: "a stock carries one trigger of a kind, and Review every 30 days stays" });
  });

  it("CORT with no clock sent: the playbook's 7-day clock and the look-again both stand", () => {
    const call = buildWriterSaveCall(args("CORT"), pull(CORT_CHART), CORT, {}, null, playbooks);
    const saved = said(call.toolArgs.triggers);
    expect(saved).toContain("Review every 7 days");
    expect(saved).toContain("Review 1 day after the event date");
    expect(call.notWritten.filter((n) => /one trigger of a kind/.test(n.reason))).toEqual([]);
  });

  it("a look-again on a refresh is its own trigger: the stock's review clock stays as it is", () => {
    const clock = { id: "clock", action: "REVIEW", predicate: { watch: "repeat", value: 30 }, rationale: "Monthly." } as Trigger;
    const stock: StockForSave = { direction: "LONG", status: "WATCHING", setupId: null, triggers: [clock] };
    const call = buildWriterSaveCall(args("CORT", { mode: "refresh", existingThesisId: "x" }), pull(CORT_CHART), { ...CORT, setup_id: undefined } as ValidatedThesisDecision, {}, stock, playbooks);
    expect(said(call.toolArgs.add_triggers)).toEqual(["Review 1 day after the event date"]);
    expect(call.toolArgs.remove_trigger_ids).toBeUndefined();
  });
});
