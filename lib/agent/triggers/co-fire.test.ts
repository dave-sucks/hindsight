/**
 * co-fire.test.ts — two protective fires on one thesis in one pass become
 * one run (DAV-254). Replayed from MU 2026-09-14 09:35 ET: the $969 stop
 * and the 8% trail fired in the same minute and started two tactical runs.
 */
import { collapseProtectiveFires, type CoFired } from "./co-fire";

const MU = "thesis-mu";
const mk = (triggerId: string, action: string, predicateKind: string, thesisId = MU): {
  thesisId: string; triggerId: string; action: string; predicateKind: string; ticker: string; sentence: string; coFired?: CoFired[];
} => ({
  thesisId,
  triggerId,
  action,
  predicateKind,
  ticker: "MU",
  sentence: `${predicateKind} — ${action}`,
});

describe("collapseProtectiveFires", () => {
  it("MU 09-14: the stop and the trail fold into one event carrying the other", () => {
    const out = collapseProtectiveFires(
      [mk("stop-969", "EXIT", "PRICE_BELOW"), mk("trail-8", "EXIT", "TRAILING_FROM_HIGH")],
      (e) => e.sentence,
    );
    expect(out).toHaveLength(1);
    expect(out[0].triggerId).toBe("stop-969");
    expect(out[0].coFired).toEqual([{ triggerId: "trail-8", predicateKind: "TRAILING_FROM_HIGH", sentence: "TRAILING_FROM_HIGH — EXIT" }]);
  });

  it("a trim with a stop folds too; an add or a review beside a stop stays its own event", () => {
    const out = collapseProtectiveFires([
      mk("stop", "EXIT", "PRICE_BELOW"),
      mk("trim", "TRIM", "PRICE_ABOVE"),
      mk("add", "ADD", "PRICE_MOVE_PCT"),
      mk("rev", "REVIEW", "GAIN_FROM_ENTRY"),
    ]);
    expect(out.map((e) => e.triggerId)).toEqual(["stop", "add", "rev"]);
    expect(out[0].coFired?.map((c) => c.triggerId)).toEqual(["trim"]);
  });

  it("fires on different theses never fold", () => {
    const out = collapseProtectiveFires([mk("a", "EXIT", "PRICE_BELOW", "t1"), mk("b", "EXIT", "PRICE_BELOW", "t2")]);
    expect(out).toHaveLength(2);
    expect(out[0].coFired).toBeUndefined();
  });
});
