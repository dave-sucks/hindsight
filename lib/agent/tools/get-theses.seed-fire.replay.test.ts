/**
 * get-theses.seed-fire.replay.test.ts — a fired review on a seed reaches the
 * read as its first research (step 12, part 2), and the read's guidance is
 * worded for the run reading it.
 *
 * MA, 2026-10-09 13:30:17 UTC: its strength wake fired. MA is a seed (no
 * view, no claim) with a 45-day review clock of its own, so the fire coded
 * REVIEW_DUE, and the morning read would have asked for a plan the stock
 * does not have. MA's row and the fire's audit row, as stored, through the
 * real get_theses and its real model-output hook.
 */
import { replayTool, thesisRow, thesisUpdateRow, REPLAY_ANALYST_ID } from "@/lib/replay";

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
      { id: WAKE, action: "REVIEW", source: "AGENT", predicate: { value: 0, watch: "strength", settings: { window: "6M" } }, rationale: "Mastercard's 6M RS vs SPY has recovered to flat or positive.", lastFiredAt: "2026-10-09T13:30:10.549Z", cooldownDays: 7 },
      { id: "a2e0f9b5-8b48-4e7a-b91e-7bc2bb350006", action: "REVIEW", source: "AGENT", predicate: { value: 45, watch: "repeat" }, rationale: "45-day housekeeping check.", cooldownDays: 45 },
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

  it("the morning read lists it as its first research, with FIRST_RESEARCH's text, and no review of a plan", async () => {
    const { screen, model } = await read("MORNING_PLAN");
    expect(screen.find((t) => t.id === MA_ID)?.situations).toEqual(["FIRST_RESEARCH"]);
    expect(Object.keys(model.guidance ?? {})).toEqual(["FIRST_RESEARCH"]);
    expect(model.guidance?.FIRST_RESEARCH).toContain("dispatch_thesis_research");
  });

  it("the same fire on a stock with a view (MA's row with a LONG view, a variant) is a review, worded per run", async () => {
    const withView = ma({ direction: "LONG" });
    const morning = await read("MORNING_PLAN", withView);
    // It has no plan and no research either, so other situations ride along; the fire itself is REVIEW_DUE, never FIRST_RESEARCH.
    expect(Object.keys(morning.model.guidance ?? {})).toEqual(expect.arrayContaining(["REVIEW_DUE"]));
    expect(Object.keys(morning.model.guidance ?? {})).not.toContain("FIRST_RESEARCH");
    expect(morning.model.guidance?.REVIEW_DUE).toContain("change_status INVALIDATED");
    const trigger = await read("INTRADAY_TACTICAL", withView);
    expect(trigger.model.guidance?.REVIEW_DUE).not.toContain("change_status");
    expect(trigger.model.guidance?.REVIEW_DUE).toContain("the morning run decides whether it stays on the book");
  });
});
