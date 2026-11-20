/**
 * get-theses.seed-fire.replay.test.ts — a fired review on a watch with no
 * view is no situation: the stock has no case to review, so code sends it to
 * the Writer and no run is asked to. With a view, the same fire is a review.
 *
 * MA, 2026-10-09 13:30:17 UTC: its strength wake fired. MA had no view and no
 * claim, with a 45-day review clock of its own. MA's row and the fire's audit
 * row, as stored, through the real get_theses and its real model-output hook.
 */
import { replayTool, thesisRow, thesisUpdateRow, REPLAY_ANALYST_ID } from "@/lib/replay";
import { situationText } from "@/lib/agent/situation-skills";

const NOW = new Date("2026-10-09T14:00:00Z");
const MA_ID = "cmum2tf9m000d04jfv0szuiap";
const WAKE = "e3c45d50-56de-4a17-9bf1-91e9c69c56ee";

/** MA as stored on 2026-10-09: the chat's mint of 09-29, never reviewed. */
const ma = (over: Record<string, unknown> = {}) =>
  thesisRow({
    id: MA_ID, ticker: "MA", status: "WATCHING", direction: null, horizon: "COMPOUNDER", setupId: null,
    coreBelief: null, keyAssumptions: [], invalidationConds: [], snapshot: null, bullCase: null, bearCase: null, scoring: null, conviction: null, convictionRationale: null,
    entryPrice: null, targetPrice: null, stopLoss: null, researchUpdatedAt: null, lastReviewedAt: null, createdAt: new Date("2026-09-29T02:47:48.106Z"),
    triggers: [
      { id: WAKE, action: "REVIEW", source: "AGENT", predicate: { value: 0, watch: "strength", settings: { window: "6M" } }, rationale: "Mastercard's 6M RS vs SPY has recovered to flat or positive.", lastFiredAt: "2026-10-09T13:30:10.549Z"},
      { id: "a2e0f9b5-8b48-4e7a-b91e-7bc2bb350006", action: "REVIEW", source: "AGENT", predicate: { value: 45, watch: "repeat" }, rationale: "45-day housekeeping check."},
    ],
    triggerState: {},
    ...over,
  });
const fire = thesisUpdateRow({ id: "cmv1066rq000006jy8l2isbdq", thesisId: MA_ID, type: "TRIGGER_FIRED", triggerId: WAKE, runId: null, priceAtTime: 575.85, timestamp: new Date("2026-10-09T13:30:17.414Z") });

type Model = { data: { theses: Array<Record<string, unknown>>; guidance?: Record<string, string> } };

async function read(runMode: string, row = ma()): Promise<{ screen: Array<Record<string, unknown>>; model: Model["data"] }> {
  const args = { limit: 50 };
  const { result, crashed } = await replayTool("get-theses", "getTheses", { seed: { thesis: [row], thesisUpdate: [fire] } as never, args, ctx: { runMode }, quotes: { MA: 575.85 } });
  if (crashed) throw new Error(`get_theses crashed: ${JSON.stringify(result).slice(0, 1500)}`);
  let model: Model["data"] | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const tool = (await import("./get-theses")).getTheses({ runId: "r", userId: "u", analystId: REPLAY_ANALYST_ID, runMode } as never) as unknown as {
      toModelOutput: (o: { toolCallId: string; input: unknown; output: unknown }) => { value: Model };
    };
    model = tool.toModelOutput({ toolCallId: "c1", input: args, output: result }).value.data;
  });
  return { screen: (result as unknown as Model).data.theses, model: model! };
}

describe("MA 10-09: the strength wake fired on a seed with its own clock", () => {
  beforeAll(() => jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "hrtime", "performance"] }));
  afterAll(() => jest.useRealTimers());

  it("the morning read doesn't list it: a watch with no view is in no situation, one quiet line that says no view, and no text is sent", async () => {
    const { screen, model } = await read("MORNING_PLAN");
    expect(screen.find((t) => t.id === MA_ID)).toBeUndefined();
    expect(model.guidance).toBeUndefined();
    expect(model.theses).toEqual([]);
    expect(String((model as { quiet_theses?: string[] }).quiet_theses?.[0])).toContain("MA · watch · no view");
  });

  it("the same fire on a stock with a view (MA's row with a LONG view, a variant) is a review: the morning run's list carries the skill's part for a watch", async () => {
    const withView = ma({ direction: "LONG" });
    const morning = await read("MORNING_PLAN", withView);
    expect(morning.screen.find((t) => t.id === MA_ID)?.situations).toEqual(["REVIEW_DUE"]);
    expect(morning.model.guidance).toEqual({ REVIEW_DUE: situationText("REVIEW_DUE", false) });
    expect(morning.model.guidance?.REVIEW_DUE).toContain("The case no longer holds: stop watching.");
    expect(morning.model.guidance?.REVIEW_DUE).not.toContain("A stock we hold.");
  });

  it("a trigger run's own read of it carries the name and no text: its skill ends its instructions", async () => {
    const trigger = await read("INTRADAY_TACTICAL", ma({ direction: "LONG" }));
    expect(trigger.model.guidance).toBeUndefined();
    expect(trigger.model.theses[0]?.situations).toEqual(["REVIEW_DUE (review due)"]);
  });
});
