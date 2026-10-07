/**
 * co-fire.test.ts — two protective fires on one thesis in one pass become
 * one run (DAV-254). Replayed from MU 2026-09-14 09:35 ET: the $969 stop
 * and the 8% trail fired in the same minute and started two tactical runs.
 */
import { collapseProtectiveFires, type CoFired } from "./co-fire";

const MU = "thesis-mu";
const mk = (triggerId: string, action: string, sentence: string, thesisId = MU): {
  thesisId: string; triggerId: string; action: string; ticker: string; sentence: string; coFired?: CoFired[];
} => ({
  thesisId,
  triggerId,
  action,
  ticker: "MU",
  sentence,
});

describe("collapseProtectiveFires", () => {
  it("MU 09-14: the stop and the trail fold into one event carrying the other", () => {
    const out = collapseProtectiveFires(
      [mk("stop-969", "EXIT", "Sell if below $969"), mk("trail-8", "EXIT", "Sell if below 8% from the high since we bought")],
    );
    expect(out).toHaveLength(1);
    expect(out[0].triggerId).toBe("stop-969");
    expect(out[0].coFired).toEqual([{ triggerId: "trail-8", sentence: "Sell if below 8% from the high since we bought" }]);
  });

  it("a trim with a stop folds too; an add or a review beside a stop stays its own event", () => {
    const out = collapseProtectiveFires([
      mk("stop", "EXIT", "Sell if below $969"),
      mk("trim", "TRIM", "Trim if above $1,100"),
      mk("add", "ADD", "Add if above 7% from yesterday's close"),
      mk("rev", "REVIEW", "Review if above 10% from our entry"),
    ]);
    expect(out.map((e) => e.triggerId)).toEqual(["stop", "add", "rev"]);
    expect(out[0].coFired?.map((c) => c.triggerId)).toEqual(["trim"]);
  });

  it("fires on different theses never fold", () => {
    const out = collapseProtectiveFires([mk("a", "EXIT", "Sell if below $969", "t1"), mk("b", "EXIT", "Sell if below $969", "t2")]);
    expect(out).toHaveLength(2);
    expect(out[0].coFired).toBeUndefined();
  });
});
