/**
 * The floor a buy gets when it names none (playbookFloor): the key its
 * playbook's floor words name, on the chart, held to the sale rules. TRV's
 * chart as its 2026-10-21 trigger run read it: the base's low $341.52, the
 * last swing low $353.79, ATR $7.78, a $398.95 buy.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { playbookFloor } from "./playbooks";
import { getSetup } from "./setups";
import type { PriceStructure } from "@/lib/market-data/price-structure";

const chart = { price: 398.95, swings: { lastLow: { price: 353.79, date: "2026-10-01" } }, base: { pivot: 398.7, low: 341.52 }, range: { high20: 399.71, low20: 353.79 }, gaps: [] } as unknown as PriceStructure;
const at = (setupId: string, horizon: string | null, atr: number | null = 7.78, entry = 398.95, c: PriceStructure | null = chart) => playbookFloor({ setup: getSetup(setupId)!, horizon, entry, chart: c, atr });

describe("the playbook's floor, when a buy names none", () => {
  it("is the key its words name: a breakout's base low, a pullback's swing low", () => {
    expect(at("BASE_BREAKOUT", "COMPOUNDER")).toEqual({ price: 341.52, key: "{baseLow}" });
    expect(at("MA_PULLBACK", null)).toEqual({ price: 353.79, key: "{swingLow}" });
  });

  it("held to the sale rules: on a TRADE the breakout's 8% cap refuses the 14% base low, so the run names the floor", () => {
    expect(at("BASE_BREAKOUT", "TRADE")).toEqual({ refused: expect.stringMatching(/^The playbook's floor \{baseLow\} at \$341\.52 fails its rule: the sale \$341\.52 is 14\.4% from the buy; a TRADE on .+ caps it at 8%/) });
  });

  it("refused when the level is within one ATR of the buy, or not under it", () => {
    expect(at("MA_PULLBACK", null, 7.78, 358)).toEqual({ refused: expect.stringMatching(/fails its rule: the sale \$353\.79 is 0\.54 ATR from the \$358\.00 buy/) });
    expect(at("MA_PULLBACK", null, 7.78, 350)).toEqual({ refused: "The playbook's floor {swingLow} is $353.79, not under the $350.00 buy." });
  });

  it("refused when its words name no key, or the chart has no number for it", () => {
    expect(at("MOMENTUM_FLAG", "TRADE")).toEqual({ refused: "The playbook's floor names no chart key." });
    expect(at("PEAD", null)).toEqual({ refused: "The playbook's floor is {gapDayLow} (the gap day's low), and the chart has no gap of 3% or more in the last 10 sessions." });
    expect(at("BASE_BREAKOUT", null, 7.78, 398.95, null)).toEqual({ refused: "The playbook's floor is {baseLow} (the base's low), and the chart couldn't be read." });
  });
});
