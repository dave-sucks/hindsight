/**
 * setup-exits.test.ts — what a fill writes onto the stock from its setup
 * (DAV-254). Replayed from IOT's 2026-09-14 fill: PEAD Specialist, TARGET,
 * 230 shares at $39.83 with the stop at $36.74 (7.76% away). Before this,
 * a fill wrote the horizon template and nothing from the setup: no partial,
 * no beat-that-sold review.
 */
import { setupExitTriggers, heldSetupExitOps, BEAT_AND_FADE_DOWN_PCT } from "./setup-exits";
import { isFilingRule, shapeName } from "@/lib/agent/triggers/condition/__fixtures__/shape-name";
import { getSetup } from "@/lib/agent/knowledge/setups";

let n = 0;
const mintId = () => `t${++n}`;

describe("setupExitTriggers", () => {
  it("IOT on PEAD: the 60-day limit from the buy, a partial at 2R (+15.5%) and the beat-that-sold review", () => {
    const out = setupExitTriggers({ setup: getSetup("PEAD")!, horizon: "TARGET", entry: 39.83, stop: 36.74, mintId });
    expect(out.map((t) => [t.action, shapeName(t.predicate)])).toEqual([
      ["REVIEW", "from_date:after:buy"],
      ["TRIM", "move:above:entry"],
      ["REVIEW", "all"],
    ]);
    expect(out[0].predicate).toEqual({ watch: "from_date", is: "after", value: 60, variable: "buy" });
    // The partial carries the big-winner switch: once IOT has run 20% off
    // the buy inside three weeks it is held and managed on the trail, not
    // cut in half. A slower climb to the same gain is still de-risked.
    expect(out[1].predicate).toEqual({ watch: "move", is: "above", value: 15.5, variable: "entry", settings: { fastWinnerPct: 20, fastWinnerDays: 21 } });
    expect(out[2].predicate).toEqual({ match: "all", conditions: [{ watch: "surprise", is: "beat", value: 0 }, { watch: "move", is: "below", value: BEAT_AND_FADE_DOWN_PCT, variable: "prev_close" }] });
    expect(out.every((t) => t.source === "DEFAULT")).toBe(true);
  });

  it("a compounder gets only the 60-day business checkpoint — its sells are the analyst's rules and a named invalidation", () => {
    const out = setupExitTriggers({ setup: getSetup("COMPOUNDER_ACCUMULATION")!, horizon: "COMPOUNDER", entry: 100, stop: 80, mintId });
    expect(out.map((t) => [t.action, t.predicate])).toEqual([["REVIEW", { watch: "from_date", is: "after", value: 60, variable: "buy" }]]);
  });

  it("a pullback on a TARGET horizon gets the beat-that-sold review but no partial", () => {
    const out = setupExitTriggers({ setup: getSetup("MA_PULLBACK")!, horizon: "TARGET", entry: 54.48, stop: 50.7, mintId });
    expect(out.map((t) => shapeName(t.predicate))).toEqual(["from_date:after:buy", "all"]);
  });

  it("no stop → no partial (there is no R to measure)", () => {
    const out = setupExitTriggers({ setup: getSetup("PEAD")!, horizon: "TARGET", entry: 39.83, stop: null, mintId });
    expect(out.map((t) => shapeName(t.predicate))).toEqual(["from_date:after:buy", "all"]);
  });
});

// ── DAV-285: the same exits for a stock already held ───────────────────────

describe("heldSetupExitOps — a held stock whose review just named its setup", () => {
  const pead = getSetup("PEAD")!;
  let n = 0;
  const mintId = () => `held-${++n}`;
  const kinds = (ops: ReturnType<typeof heldSetupExitOps>) =>
    ops.map((o) => (o.op === "add" ? `${o.trigger.action}:${shapeName(o.trigger.predicate)}` : o.op));

  it("MU (production 2026-09-17: cost $895.94, floor already raised to $969): no partial sale from a floor above cost", () => {
    const ops = heldSetupExitOps({ setup: pead, horizon: "TRADE", entry: 895.935, stop: 969, direction: "LONG", stored: [], mintId });
    expect(kinds(ops)).not.toContain("TRIM:move:above:entry");
    expect(kinds(ops)).toContain("REVIEW:from_date:after:buy");
  });

  it("a floor still under cost writes the partial from the real cost and floor", () => {
    const ops = heldSetupExitOps({ setup: pead, horizon: "TRADE", entry: 100, stop: 94, direction: "LONG", stored: [], mintId });
    const trim = ops.find((o) => o.op === "add" && o.trigger.action === "TRIM");
    expect(trim && trim.op === "add" ? trim.trigger.predicate : null).toEqual({ watch: "move", is: "above", value: pead.manage.partialAtR! * 6, variable: "entry", settings: { fastWinnerPct: 20, fastWinnerDays: 21 } });
  });

  it("leaves a trigger already in the same bucket alone", () => {
    const first = heldSetupExitOps({ setup: pead, horizon: "TRADE", entry: 100, stop: 94, direction: "LONG", stored: [], mintId });
    const stored = first.flatMap((o) => (o.op === "add" ? [o.trigger] : []));
    expect(heldSetupExitOps({ setup: pead, horizon: "TRADE", entry: 100, stop: 94, direction: "LONG", stored, mintId })).toEqual([]);
  });

  it("writes nothing without a real cost", () => {
    expect(heldSetupExitOps({ setup: pead, horizon: "TRADE", entry: null, stop: 94, direction: "LONG", stored: [], mintId })).toEqual([]);
  });
});
