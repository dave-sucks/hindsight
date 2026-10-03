/**
 * Approving a proposal does not finish the trade — the order goes to Alpaca
 * and the fill lands minutes later. Every other surface calls that moment
 * "Executing" (EXECUTING_LABEL), but this sentence kept saying "Proposed"
 * through it, so an approved order still read as waiting on a decision.
 */
import { buildTradeSentence } from "./trade-statement";

describe("buildTradeSentence — the proposed → executing swap", () => {
  it("leads a buy with Executing once it is sent", () => {
    expect(
      buildTradeSentence({ kind: "proposed-buy", qty: 29, entry: 333.85, executing: true }),
    ).toBe("Executing: Buy 29 shares at $333.85");
  });

  it("leads an exit with Executing once it is sent", () => {
    expect(
      buildTradeSentence({
        kind: "proposed-exit",
        qty: 13,
        entry: 895.93,
        current: 1091.77,
        exitVerb: "close",
        executing: true,
      }),
    ).toBe("Executing: Sell at $1091.77, bought 13 shares at $895.93");
  });

  it("still says Proposed while the decision is yours", () => {
    expect(buildTradeSentence({ kind: "proposed-buy", qty: 29, entry: 333.85 })).toBe(
      "Proposed: Buy 29 shares at $333.85",
    );
    expect(
      buildTradeSentence({
        kind: "proposed-exit",
        qty: 13,
        entry: 895.93,
        current: 1091.77,
        exitVerb: "close",
      }),
    ).toBe("Proposed: Sell at $1091.77, bought 13 shares at $895.93");
  });

  it("leaves the settled states alone", () => {
    expect(
      buildTradeSentence({ kind: "holding", qty: 39, entry: 276.9, current: 253.56 }),
    ).toBe("Bought 39 shares at $276.90, now trading at $253.56");
    expect(
      buildTradeSentence({ kind: "closed", qty: 3.54, entry: 282.35, closePrice: 416.63 }),
    ).toBe("Sold at $416.63, bought 3.54 shares at $282.35");
  });
});
