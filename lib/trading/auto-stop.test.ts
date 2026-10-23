jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { autoStopPctProblem, effectiveAutoStop } from "./auto-stop";
import { autoStopPrice } from "@/lib/agent/position-sizing";

describe("stop when buying — the setting", () => {
  it("saves 0.5% to 50%, nothing else", () => {
    expect([0.5, 8, 50].map(autoStopPctProblem)).toEqual([null, null, null]);
    expect([0.4, 50.1, 0, -8, NaN, "8"].map((p) => autoStopPctProblem(p) != null)).toEqual([true, true, true, true, true, true]);
  });

  it("an analyst's own value beats the account's, one field at a time", () => {
    const account = { autoStopOnBuy: true, autoStopPct: 8 };
    expect(effectiveAutoStop(account, { autoStopOnBuy: null, autoStopPct: null })).toEqual({ on: true, pct: 8 });
    expect(effectiveAutoStop(account, { autoStopOnBuy: false, autoStopPct: 5 })).toEqual({ on: false, pct: 5 });
    expect(effectiveAutoStop(null, null)).toEqual({ on: false, pct: 8 });
  });

  it("the line is the buy price less the percent, in cents (MU approved at $906.33)", () => {
    expect(autoStopPrice(906.33, 8)).toBe(833.82);
    expect(autoStopPrice(906.33, 5)).toBe(861.01);
  });
});
