/**
 * An edit moves a trigger's number; it never changes what the trigger is
 * measured from.
 *
 * Built from the calls the trigger-writing cases made on the cutover branch
 * (BWXT's thesis writer, DOCU's trigger run). Both models filled every field
 * of every edit, a `variable` included: first "price", which the edit path
 * refused, so the writer's review move never landed; then, once the
 * variable list was closed, "prev_close", which would have turned a $130
 * review into "below yesterday's close". Main's edit never had a variable;
 * the cutover added one no prompt asks for, and only junk reached it. A
 * stray `variable` is now ignored: the number moves, the measure stays.
 */
import { replayTool, thesisRow } from "@/lib/replay";
import { triggersInputArraySchema } from "@/lib/agent/triggers/schema";

const PRICE = 138.01;

const bwxtThesis = () =>
  thesisRow({
    id: "t_bwxt",
    ticker: "BWXT",
    status: "WATCHING",
    direction: "LONG",
    horizon: "COMPOUNDER",
    entryPrice: 162.91,
    targetPrice: 285,
    stopLoss: 125,
    triggers: [
      { id: "hero-buy", predicate: { watch: "price", is: "above", value: 162.91 }, action: "ENTER", rationale: "The plan's buy: back above the last swing high." },
      { id: "hero-review-low", predicate: { watch: "price", is: "below", value: 133 }, action: "REVIEW", rationale: "Review at the 52-week low." },
      { id: "hero-target", predicate: { watch: "price", is: "above", value: 285 }, action: "REVIEW", rationale: "The plan's target." },
      { id: "hero-floor", predicate: { watch: "price", is: "below", value: 125 }, action: "EXIT", rationale: "The plan's floor." },
    ],
  });

const opFor = (result: unknown, id: string) =>
  (result as { data?: { trigger_ops?: Array<{ id: string; ok: boolean; reason?: string }> } }).data?.trigger_ops?.find((o) => o.id === id);

const storedTrigger = (db: { store: Record<string, unknown[]> }, id: string) =>
  ((db.store.thesis[0] as { triggers: Array<{ id: string; predicate: unknown }> }).triggers ?? []).find((t) => t.id === id);

async function edit(variable: string) {
  return replayTool("update-thesis", "updateThesis", {
    seed: { thesis: [bwxtThesis()] },
    args: {
      thesis_id: "t_bwxt",
      price_at_time: PRICE,
      edit_triggers: [
        { id: "hero-review-low", value: 130, variable, rationale: "Re-anchoring the review to $130, just under the 52-week low." },
      ],
    },
    quotes: { BWXT: PRICE },
  });
}

describe("an edit moves the number, never the measure", () => {
  it("the writer's edit with variable 'price' lands as a $130 review", async () => {
    const { result, db } = await edit("price");
    expect(opFor(result, "hero-review-low")?.ok).toBe(true);
    expect(storedTrigger(db, "hero-review-low")?.predicate).toEqual({ watch: "price", is: "below", value: 130 });
  });

  it("the trigger run's edit with variable 'prev_close' stays a $130 review, not 'below yesterday's close'", async () => {
    const { result, db } = await edit("prev_close");
    expect(opFor(result, "hero-review-low")?.ok).toBe(true);
    expect(storedTrigger(db, "hero-review-low")?.predicate).toEqual({ watch: "price", is: "below", value: 130 });
  });
});

/**
 * DOCU's trigger run (the 2026-09-28 pullback buy, replayed on this branch):
 * the calls the save refused. Every one filled every field, so a typed price
 * arrived with a named level beside it, and 6 of 8 runs saved nothing. In
 * the agents' shape a price's one input is `value`, a dollar number or a
 * line, so there is no second half to send: a `variable` beside it is a
 * field a price doesn't take, dropped like a setting it doesn't take. Each
 * call goes through `add_triggers`' own schema, then through update_thesis.
 */
const JUNK = { fastWinnerPct: 0, fastWinnerDays: 0, startOnceUpPct: 0, widenAtr: 0, period: 14, window: "1M", volume: 0, withinDays: 0, fromDay: 0, days: 30 };
const refusedSingle = {
  predicate: { watch: "price", is: "above", value: 67, variable: "prev_close", settings: { close: true, ...JUNK } },
  action: "ENTER",
  rationale: "Buy back through $67 on a closing reclaim. I want the pullback to prove it held before I spend a slot on the drift.",
};
const refusedGroup = {
  predicate: {
    match: "all",
    conditions: [
      { watch: "price", is: "above", value: 67.01, variable: "prev_close", settings: { close: true, ...JUNK } },
      { watch: "price", is: "above", value: 66.45, variable: "prev_close", settings: { close: true, ...JUNK } },
    ],
  },
  action: "ENTER",
  rationale: "Buy DocuSign when the pullback actually turns: I want a close back above $67 and above the prior day's high to show the 20-day support held.",
};

const docuThesis = () =>
  thesisRow({
    id: "t_docu",
    ticker: "DOCU",
    status: "WATCHING",
    direction: "LONG",
    horizon: "TARGET",
    entryPrice: 67,
    targetPrice: 83,
    stopLoss: 63,
    triggers: [
      { id: "docu-buy", predicate: { watch: "price", is: "below", value: 67 }, action: "ENTER", rationale: "Pullback to the rising 20-day: the plan's buy level." },
      { id: "docu-floor", predicate: { watch: "price", is: "below", value: 63 }, action: "EXIT", rationale: "The plan's floor." },
      { id: "docu-target", predicate: { watch: "price", is: "above", value: 83 }, action: "REVIEW", rationale: "The plan's target." },
    ],
  });

describe("the trigger run's refused calls, in the agents' shape", () => {
  it("the single buy reads as the $67 close it says, with no line and no stray settings", () => {
    const [t] = triggersInputArraySchema.parse([refusedSingle]);
    expect(t.predicate).toEqual({ watch: "price", is: "above", value: 67, settings: { close: true } });
  });

  it("the two-part buy reads as two typed closes", () => {
    const [t] = triggersInputArraySchema.parse([refusedGroup]);
    expect(t.predicate).toEqual({
      match: "all",
      conditions: [
        { watch: "price", is: "above", value: 67.01, settings: { close: true } },
        { watch: "price", is: "above", value: 66.45, settings: { close: true } },
      ],
    });
  });

  it("update_thesis saves it: the buy is re-priced to the bounce", async () => {
    const add_triggers = triggersInputArraySchema.parse([refusedSingle]);
    const { result, db, refused } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [docuThesis()] },
      args: { thesis_id: "t_docu", price_at_time: 65.88, add_triggers, rationale: "Not buying the dip; re-priced to a close back above $67." },
      quotes: { DOCU: 65.88 },
    });
    expect(refused).toBe(false);
    const ops = (result as { data?: { trigger_ops?: Array<{ ok: boolean }> } }).data?.trigger_ops ?? [];
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((o) => o.ok)).toBe(true);
    const buys = ((db.store.thesis[0] as { triggers: Array<{ action: string; predicate: { is?: string; value?: number } }> }).triggers).filter((t) => t.action === "ENTER");
    expect(buys).toHaveLength(1);
    expect(buys[0].predicate).toMatchObject({ watch: "price", is: "above", value: 67 });
  });

  it("a line goes in value, and is stored as the line", () => {
    const [t] = triggersInputArraySchema.parse([{ ...refusedSingle, predicate: { watch: "price", is: "above", value: "sma20", variable: "prev_close" } }]);
    expect(t.predicate).toEqual({ watch: "price", is: "above", variable: "sma20" });
  });

  it("a move keeps what it is measured from", () => {
    const [t] = triggersInputArraySchema.parse([{ predicate: { watch: "move", is: "below", value: 12, variable: "peak" }, action: "EXIT", rationale: "Sell 12% off the high since we bought." }]);
    expect(t.predicate).toEqual({ watch: "move", is: "below", value: 12, variable: "peak" });
  });

  it("a line that isn't on the list is refused", () => {
    expect(triggersInputArraySchema.safeParse([{ ...refusedSingle, predicate: { watch: "price", is: "above", value: "price" } }]).success).toBe(false);
  });
});
