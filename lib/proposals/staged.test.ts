/**
 * staged.test.ts — which triggers a trigger run's trade answers. A proposal a trigger made stays open while the
 * triggers it answers hold (trigger-proposals.ts), so one that a review or a buy rode in beside a sale must not
 * keep that sale open.
 */
import { firedTrigger } from "./staged";

describe("firedTrigger", () => {
  it("a sale answers the sales that fired with it (MU: the stop and the trail)", () => {
    expect(firedTrigger("MU", { id: "stop", action: "EXIT" }, [{ triggerId: "trail", action: "EXIT" }])).toEqual({ ticker: "MU", side: "SELL", triggerIds: ["stop", "trail"] });
    expect(firedTrigger("MU", { id: "stop", action: "EXIT" }, [{ triggerId: "trim", action: "TRIM" }])?.triggerIds).toEqual(["stop", "trim"]);
  });

  it("a sale does not answer the review or the buy that rode in beside it (GEV: a review, a floor and a trail)", () => {
    const answered = firedTrigger("GEV", { id: "floor", action: "EXIT" }, [
      { triggerId: "trail", action: "EXIT" },
      { triggerId: "review", action: "REVIEW" },
      { triggerId: "add", action: "ADD" },
    ]);
    expect(answered).toEqual({ ticker: "GEV", side: "SELL", triggerIds: ["floor", "trail"] });
  });

  it("a buy answers the buys that fired with it, and nothing else", () => {
    expect(firedTrigger("AAPL", { id: "buy", action: "ENTER" }, [{ triggerId: "add", action: "ADD" }, { triggerId: "floor", action: "EXIT" }])?.triggerIds).toEqual(["buy", "add"]);
  });

  it("a co-fire sent before it carried an action was a sale, the only kind that folded", () => {
    expect(firedTrigger("MU", { id: "stop", action: "EXIT" }, [{ triggerId: "trail" }])?.triggerIds).toEqual(["stop", "trail"]);
    expect(firedTrigger("AAPL", { id: "buy", action: "ENTER" }, [{ triggerId: "trail" }])?.triggerIds).toEqual(["buy"]);
  });

  it("a review answers nothing", () => {
    expect(firedTrigger("PRAX", { id: "r1", action: "REVIEW" }, [{ triggerId: "r2", action: "REVIEW" }])).toBeUndefined();
  });
});
