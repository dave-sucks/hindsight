/**
 * co-fire.test.ts — everything that fires on one stock in one pass is one run.
 * Replayed from the production rows of MU 2026-09-14 (the stop and the trail),
 * GEV 2026-11-16 09:30 (a review and two sales) and PRAX 2026-11-16 09:30 (two
 * filing reviews on one 8-K). Trigger ids are the real ones; the levels are not
 * written here.
 */
import { oneRunPerStock, type Fire } from "./co-fire";

const fire = (thesisId: string, triggerId: string, action: string, sentence: string, extra: Partial<Fire> = {}): Fire => ({
  thesisId,
  triggerId,
  action,
  sentence,
  ...extra,
});

describe("oneRunPerStock — the same pass", () => {
  it("MU 09-14: the stop and the trail fold into one run carrying the other", () => {
    const plan = oneRunPerStock(
      [fire("mu", "stop", "EXIT", "Sell if below its stop"), fire("mu", "trail", "EXIT", "Sell if below 8% from the high since we bought")],
      { busy: false },
    );
    expect(plan.run?.triggerId).toBe("stop");
    expect(plan.run?.coFired).toEqual([{ triggerId: "trail", action: "EXIT", sentence: "Sell if below 8% from the high since we bought" }]);
    expect(plan.waiting).toEqual([]);
    expect(plan.writtenDown).toEqual([]);
  });

  it("GEV 11-16 09:30: the review and the two sales were two runs; now one, led by the sale", () => {
    // In the order the ladder lists them: the review first, as it fired at 09:30:20.
    const review = fire("gev", "ae04d898-9865-42c5-885b-0107dac18a49", "REVIEW", "Review if below its level");
    const floor = fire("gev", "8861139d-9300-438c-9903-0aac1e68cc1b", "EXIT", "Sell if below its floor");
    const trail = fire("gev", "bd941c67-a53a-41b8-918f-d303ec3b5e66", "EXIT", "Sell if below 6% from the high since we bought");
    const plan = oneRunPerStock([review, floor, trail], { busy: false });
    expect(plan.run?.triggerId).toBe(floor.triggerId);
    expect(plan.run?.action).toBe("EXIT");
    expect(plan.run?.coFired?.map((c) => c.triggerId)).toEqual([trail.triggerId, review.triggerId]);
  });

  it("a sale outranks a trim, an add, a buy and a review, whatever order they fired in", () => {
    const plan = oneRunPerStock(
      [fire("t", "rev", "REVIEW", "r"), fire("t", "buy", "ENTER", "b"), fire("t", "add", "ADD", "a"), fire("t", "trim", "TRIM", "tr"), fire("t", "sell", "EXIT", "s")],
      { busy: false },
    );
    expect(plan.run?.triggerId).toBe("sell");
    expect(plan.run?.coFired?.map((c) => c.triggerId)).toEqual(["trim", "add", "buy", "rev"]);
  });

  it("PRAX 11-16: two filing reviews on one 8-K are one run, and the run still reads the filing", () => {
    const filing = "Filed 8-K — press release (7.01), other events (8.01), Nov 12.";
    const plan = oneRunPerStock(
      [
        fire("prax", "a05c58e2-ca04-4f8f-afac-bdd527d0f832", "REVIEW", "Review if it files an 8-K 7.01 (press release)", { firedContext: filing }),
        fire("prax", "3ca27b95-3f67-48a2-9b83-b7829294ddd4", "REVIEW", "Review if it files an 8-K 8.01 (other events)", { firedContext: filing }),
      ],
      { busy: false },
    );
    expect(plan.run?.triggerId).toBe("a05c58e2-ca04-4f8f-afac-bdd527d0f832");
    expect(plan.run?.coFired).toEqual([
      { triggerId: "3ca27b95-3f67-48a2-9b83-b7829294ddd4", action: "REVIEW", sentence: "Review if it files an 8-K 8.01 (other events)", firedContext: filing },
    ]);
  });

  it("a lone fire is its own run, untouched", () => {
    const only = fire("t", "x", "REVIEW", "r");
    expect(oneRunPerStock([only], { busy: false })).toEqual({ run: only, writtenDown: [], waiting: [] });
    expect(oneRunPerStock([], { busy: false })).toEqual({ run: null, writtenDown: [], waiting: [] });
  });

  it("an Auto-sell is the run's own, ahead of an agent's sale; a review rides in its write-up", () => {
    const plan = oneRunPerStock(
      [fire("t", "ask", "EXIT", "Sell (asks the agent)"), fire("t", "auto", "EXIT", "Sell (Auto)", { ownTrade: true }), fire("t", "rev", "REVIEW", "r")],
      { busy: false },
    );
    expect(plan.run?.triggerId).toBe("auto");
    expect(plan.run?.coFired?.map((c) => c.triggerId)).toEqual(["ask", "rev"]);
  });

  it("an Auto trade that isn't the run's own can't be made by another fire's run: it asks again next pass", () => {
    const plan = oneRunPerStock([fire("t", "sell", "EXIT", "Sell"), fire("t", "autotrim", "TRIM", "Trim (Auto)", { ownTrade: true }), fire("t", "rev", "REVIEW", "r")], { busy: false });
    expect(plan.run?.triggerId).toBe("sell");
    expect(plan.run?.coFired?.map((c) => c.triggerId)).toEqual(["rev"]);
    expect(plan.waiting.map((w) => w.triggerId)).toEqual(["autotrim"]);
  });
});

describe("oneRunPerStock — the stock's last run is still going", () => {
  const fires = [fire("gev", "rev", "REVIEW", "Review if below its level"), fire("gev", "floor", "EXIT", "Sell if below its floor"), fire("gev", "buy", "ADD", "Add if above the 50-day")];

  it("starts no second run: a review is written down, a sale or a buy asks again next pass", () => {
    const plan = oneRunPerStock(fires, { busy: true });
    expect(plan.run).toBeNull();
    expect(plan.writtenDown.map((f) => f.triggerId)).toEqual(["rev"]);
    expect(plan.waiting.map((f) => f.triggerId)).toEqual(["floor", "buy"]);
  });
});
