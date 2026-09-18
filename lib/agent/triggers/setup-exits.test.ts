/**
 * setup-exits.test.ts — what a fill writes onto the stock from its setup
 * (DAV-254). Replayed from IOT's 2026-09-14 fill: PEAD Specialist, TARGET,
 * 230 shares at $39.83 with the stop at $36.74 (7.76% away). Before this,
 * a fill wrote the horizon template and nothing from the setup: no partial,
 * no beat-that-sold review.
 */
import { setupExitTriggers, heldSetupExitOps, BEAT_AND_FADE_DOWN_PCT } from "./setup-exits";
import { getSetup } from "@/lib/agent/knowledge/setups";

let n = 0;
const mintId = () => `t${++n}`;

describe("setupExitTriggers", () => {
  it("IOT on PEAD: the 60-day limit from the buy, a partial at 2R (+15.5%) and the beat-that-sold review", () => {
    const out = setupExitTriggers({ setup: getSetup("PEAD")!, horizon: "TARGET", entry: 39.83, stop: 36.74, mintId });
    expect(out.map((t) => [t.action, t.predicate.kind])).toEqual([
      ["REVIEW", "REVIEW_CADENCE"],
      ["TRIM", "GAIN_FROM_ENTRY"],
      ["REVIEW", "AND"],
    ]);
    expect(out[0].predicate).toEqual({ kind: "REVIEW_CADENCE", days: 60, from: "BUY" });
    expect(out[1].predicate).toEqual({ kind: "GAIN_FROM_ENTRY", pct: 15.5, direction: "UP" });
    expect(out[2].predicate).toEqual({
      kind: "AND",
      predicates: [
        { kind: "EARNINGS_BEAT" },
        { kind: "PRICE_MOVE_PCT", pct: BEAT_AND_FADE_DOWN_PCT, direction: "DOWN", window: "1D" },
      ],
    });
    expect(out.every((t) => t.source === "DEFAULT")).toBe(true);
  });

  it("a compounder gets only the 60-day business checkpoint — its sells are the analyst's rules and a named invalidation", () => {
    const out = setupExitTriggers({ setup: getSetup("COMPOUNDER_ACCUMULATION")!, horizon: "COMPOUNDER", entry: 100, stop: 80, mintId });
    expect(out.map((t) => [t.action, t.predicate])).toEqual([["REVIEW", { kind: "REVIEW_CADENCE", days: 60, from: "BUY" }]]);
  });

  it("a pullback on a TARGET horizon gets the beat-that-sold review but no partial", () => {
    const out = setupExitTriggers({ setup: getSetup("MA_PULLBACK")!, horizon: "TARGET", entry: 54.48, stop: 50.7, mintId });
    expect(out.map((t) => t.predicate.kind)).toEqual(["REVIEW_CADENCE", "AND"]);
  });

  it("no stop → no partial (there is no R to measure)", () => {
    const out = setupExitTriggers({ setup: getSetup("PEAD")!, horizon: "TARGET", entry: 39.83, stop: null, mintId });
    expect(out.map((t) => t.predicate.kind)).toEqual(["REVIEW_CADENCE", "AND"]);
  });
});

// ── DAV-285: the same exits for a stock already held ───────────────────────

describe("heldSetupExitOps — a held stock whose review just named its setup", () => {
  const pead = getSetup("PEAD")!;
  let n = 0;
  const mintId = () => `held-${++n}`;
  const kinds = (ops: ReturnType<typeof heldSetupExitOps>) =>
    ops.map((o) => (o.op === "add" ? `${o.trigger.action}:${o.trigger.predicate.kind}` : o.op));

  it("MU (production 2026-09-17: cost $895.94, floor already raised to $969): no partial sale from a floor above cost", () => {
    const ops = heldSetupExitOps({ setup: pead, horizon: "TRADE", entry: 895.935, stop: 969, direction: "LONG", stored: [], mintId });
    expect(kinds(ops)).not.toContain("TRIM:GAIN_FROM_ENTRY");
    expect(kinds(ops)).toContain("REVIEW:REVIEW_CADENCE");
  });

  it("a floor still under cost writes the partial from the real cost and floor", () => {
    const ops = heldSetupExitOps({ setup: pead, horizon: "TRADE", entry: 100, stop: 94, direction: "LONG", stored: [], mintId });
    const trim = ops.find((o) => o.op === "add" && o.trigger.action === "TRIM");
    expect(trim && trim.op === "add" ? trim.trigger.predicate : null).toEqual({
      kind: "GAIN_FROM_ENTRY",
      pct: pead.manage.partialAtR! * 6,
      direction: "UP",
    });
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
