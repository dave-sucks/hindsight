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
import { predicateInputSchema } from "@/lib/agent/triggers/schema";

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

describe("a new condition says what's wrong with it", () => {
  // DOCU's trigger run, 2026-09-28 replay: a buy on a close back above $67,
  // with every field filled.
  const written = {
    watch: "price",
    is: "above",
    value: 67,
    variable: "prev_close",
    settings: { close: true, fastWinnerPct: 0, fastWinnerDays: 0, startOnceUpPct: 0, widenAtr: 0, period: 14, window: "1M", volume: 0, withinDays: 0, fromDay: 0, days: 0 },
  };

  it("a variable that isn't on the list is refused by the list", () => {
    expect(predicateInputSchema().safeParse({ ...written, variable: "price" }).success).toBe(false);
  });

  it("a price sent with a number and a variable is refused, and the refusal says so", () => {
    const out = predicateInputSchema().safeParse(written);
    expect(out.success).toBe(false);
    expect(out.error?.issues[0]?.message).toMatch(/a number or a variable, not both/);
  });

  it("the same buy with the number alone saves, without the settings price doesn't take", () => {
    const { variable: _v, ...plain } = written;
    void _v;
    expect(predicateInputSchema().parse(plain)).toEqual({ watch: "price", is: "above", value: 67, settings: { close: true } });
  });
});
