/**
 * Every plan check has a human label, because the alternative is what
 * shipped: `PlanCheck.text` rendered raw at the top of the thesis sheet.
 * That text is an instruction to the agent — TRV's read "Answer it one of two
 * ways — price the buy at a level you can name… A rationale with no plan
 * leaves it here tomorrow" — in the same amber as the work flag.
 */
import { planCheckLabel } from "./plan-check-label";
import type { PlanCheck } from "./plan-checks";

const KINDS: PlanCheck["kind"][] = [
  "NOTHING_CAN_WAKE",
  "NO_BUY_LEVEL",
  "BUY_INSIDE_CUTOFF",
  "ENTRY_FAR_FROM_PRICE",
  "ENTRY_STALE",
  "ENTRY_RAISED_AWAY",
  "BUY_FIRED_UNANSWERED",
  "TARGET_ALREADY_PASSED",
  "STOP_ALREADY_BREACHED",
  "STOP_INSIDE_NOISE",
  "FLOOR_INSIDE_NOISE",
  "PLAN_BELOW_RR_FLOOR",
  "COMPOSITE_BELOW_MINIMUM",
];

describe("planCheckLabel", () => {
  it("names every kind, in a few words and never the raw enum", () => {
    for (const kind of KINDS) {
      const label = planCheckLabel(kind);
      expect(label).not.toBe(kind);
      expect(label.split(" ").length).toBeLessThanOrEqual(6);
      expect(label).not.toMatch(/_/);
    }
  });

  it("falls back readably rather than inventing a name for a new kind", () => {
    expect(planCheckLabel("SOME_NEW_CHECK")).toBe("some new check");
  });
});
