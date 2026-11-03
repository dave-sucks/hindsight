/**
 * update-thesis-answered-rule.replay.test.ts — the rule a review line
 * answers is kept on the line, and the morning run's save finds it when the
 * call names none (2026-11-03).
 *
 * NVDA, Secular Compounder, 2026-10-07 08:00 ET: the analyst's "Up 10% from
 * entry — review" fired the day before, flagged for the morning run, and the
 * run's real call answered it
 * (lib/agent/__fixtures__/nvda-flagged-fire-2026-10-07.json). The same call
 * against the real save: with trigger_id as sent, the line keeps the rule's
 * action and condition; without it, the save links the one open fire on its
 * own; with no fire and the clock run out, the clock; with two fires open,
 * nothing rather than a guess.
 */
import fixture from "@/lib/agent/__fixtures__/nvda-flagged-fire-2026-10-07.json";
import { replayTool, thesisRow, thesisUpdateRow, agentConfigRow, accountRow, positionRow, type Row } from "@/lib/replay";

type Rule = { id: string; action: string; predicate: unknown };
type Fx = {
  price: number;
  thesis: Row & { id: string; triggers: Rule[]; entryPrice: number; createdAt: string };
  fire: { id: string; timestamp: string; summary: string; triggerId: string; priceAtTime: number };
  call: Record<string, unknown>;
  analyst: { id: string; accountId: string; triggers: Rule[] };
  account: { id: string; triggers: Rule[] };
};
const fx = fixture as unknown as Fx;
const RULE = fx.analyst.triggers.find((t) => t.id === fx.fire.triggerId)!;
const CLOCK = fx.thesis.triggers.find((t) => (t.predicate as { watch?: string }).watch === "repeat")!;
const TRAIL = fx.account.triggers.find((t) => t.action === "EXIT")!;
const FIRE = { id: fx.fire.id, triggerId: fx.fire.triggerId, summary: fx.fire.summary };
const days = (n: number) => new Date(Date.now() - n * 86_400_000);
const { trigger_id: NAMED, ...UNNAMED } = fx.call;

function seed(opts: { fires: Array<{ id: string; triggerId: string; summary: string }>; lastReviewedAt: Date }) {
  return {
    thesis: [thesisRow({ ...fx.thesis, createdAt: new Date(fx.thesis.createdAt), lastReviewedAt: opts.lastReviewedAt, researchRun: { agentConfigId: fx.analyst.id, agentConfig: { name: "Secular Compounder", setupIds: [] } } })],
    agentConfig: [agentConfigRow({ id: fx.analyst.id, accountId: fx.account.id, triggers: fx.analyst.triggers })],
    account: [accountRow({ id: fx.account.id, triggers: fx.account.triggers, triggersSeededAt: new Date("2026-09-01T00:00:00Z") })],
    position: [positionRow({ symbol: "NVDA", avgCost: fx.thesis.entryPrice, quantity: 33 })],
    thesisUpdate: opts.fires.map((f, i) =>
      thesisUpdateRow({ id: f.id, thesisId: fx.thesis.id, type: "TRIGGER_FIRED", summary: f.summary, triggerId: f.triggerId, runId: null, priceAtTime: fx.fire.priceAtTime, timestamp: new Date(new Date(fx.fire.timestamp).getTime() + i * 60_000) }),
    ),
  };
}

async function save(args: Record<string, unknown>, s: ReturnType<typeof seed>) {
  const r = await replayTool("update-thesis", "updateThesis", { seed: s, args, ctx: { runMode: "MORNING_PLAN", analystId: fx.analyst.id }, quotes: { NVDA: Number(fx.call.price_at_time ?? fx.price) } });
  const lines = (r.db.store.thesisUpdate ?? []).filter((u) => u.type !== "TRIGGER_FIRED") as Row[];
  return { r, note: lines[lines.length - 1] };
}

describe("NVDA 10-07: the rule a review answers is kept on the line", () => {
  it("the call as sent names the fire: the line keeps the rule's action and condition, read from the analyst's rules the stock inherits", async () => {
    expect(NAMED).toBe(fx.fire.triggerId);
    const { r, note } = await save(fx.call, seed({ fires: [FIRE], lastReviewedAt: days(2) }));
    expect(r.crashed).toBe(false);
    expect(r.refused).toBe(false);
    expect(note).toMatchObject({ triggerId: fx.fire.triggerId, triggerAction: "REVIEW", triggerCondition: RULE.predicate });
  });

  it("the same call with no trigger_id: the one open fire is what the note answers", async () => {
    const { r, note } = await save(UNNAMED, seed({ fires: [FIRE], lastReviewedAt: days(2) }));
    expect(r.crashed).toBe(false);
    expect(note).toMatchObject({ triggerId: fx.fire.triggerId, triggerAction: "REVIEW", triggerCondition: RULE.predicate });
  });

  it("no fire open and the clock run out: the note answers the stock's own review clock, so it reads 'Scheduled review'", async () => {
    const { r, note } = await save(UNNAMED, seed({ fires: [], lastReviewedAt: days(12) }));
    expect(r.crashed).toBe(false);
    expect(note).toMatchObject({ triggerId: CLOCK.id, triggerAction: "REVIEW", triggerCondition: CLOCK.predicate });
  });

  it("two fires open: the save names neither rather than guess", async () => {
    const second = { id: "fire-trail", triggerId: TRAIL.id, summary: "Sell if below 6% from the high since we bought" };
    const { r, note } = await save(UNNAMED, seed({ fires: [FIRE, second], lastReviewedAt: days(2) }));
    expect(r.crashed).toBe(false);
    expect(note.triggerId ?? null).toBeNull();
    expect(note.triggerAction ?? null).toBeNull();
  });

  it("nothing fired and the clock not due: the line names nothing, as before", async () => {
    const { r, note } = await save(UNNAMED, seed({ fires: [], lastReviewedAt: days(2) }));
    expect(r.crashed).toBe(false);
    expect(note.triggerId ?? null).toBeNull();
  });
});
