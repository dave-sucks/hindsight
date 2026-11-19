/**
 * The floor a buy gets when it names none (playbookFloor): its floor's words
 * in code, on the chart, held to the sale rules. TRV's chart as its
 * 2026-10-21 trigger run read it: a $398.95 buy, the base's low $341.52, the
 * last swing low $353.79, the 50-day $370.18, ATR $7.78, and a gap on 10-16
 * whose low was $368.63.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { holdingTriggersText, playbookFloor } from "./playbooks";
import { PLAYBOOK_TEMPLATES } from "./playbook-templates";
import { getSetup } from "./setups";
import type { PriceStructure } from "@/lib/market-data/price-structure";

const TRV = {
  price: 398.95,
  sma: { d20: { value: 371.38 }, d50: { value: 370.18 } },
  atr14: { dollars: 7.78, pct: 1.95 },
  swings: { lastLow: { price: 353.79, date: "2026-10-01" } },
  base: { pivot: 398.7, low: 341.52 },
  range: { high20: 399.71, low20: 353.79 },
  gaps: [{ date: "2026-10-16", direction: "DOWN", pct: -3.62, volumeRatio: 2.56, low: 368.63, mid: 379.77, high: 390.91 }],
} as unknown as PriceStructure;
const at = (setupId: string, o: { horizon?: string | null; entry?: number; chart?: PriceStructure | null; atr?: number | null; buyAverage?: string | null } = {}) =>
  playbookFloor({ setup: getSetup(setupId)!, horizon: o.horizon ?? null, entry: o.entry ?? 398.95, chart: o.chart === undefined ? TRV : o.chart, atr: o.atr === undefined ? 7.78 : o.atr, buyAverage: o.buyAverage === undefined ? "sma50" : o.buyAverage });

describe("the playbook's floor, when a buy names none: its words in code", () => {
  it("the key its words name: a run-up's swing low, a compounder's swing low inside its 25%", () => {
    expect(at("PRE_CATALYST")).toEqual({ price: 353.79, key: "{swingLow}" });
    expect(at("COMPOUNDER_ACCUMULATION", { horizon: "COMPOUNDER" })).toEqual({ price: 353.79, key: "{swingLow}" });
  });

  it("a breakout's base low 14.4% under the buy is past the 8% its words allow, on every horizon", () => {
    const refused = { refused: "The playbook's floor {baseLow} at $341.52 is 14.4% under the buy, and its words allow at most 8%." };
    expect(at("BASE_BREAKOUT", { horizon: "COMPOUNDER" })).toEqual(refused);
    expect(at("BASE_BREAKOUT", { horizon: "TRADE" })).toEqual(refused);
  });

  it("the words' other level when it is higher: a pullback's one ATR under the average its buy names, PEAD's 8% under the buy", () => {
    // The playbook's buy is near the 50-day: $370.18 − $7.78 = $362.40, above the $353.79 swing low. Edited to the 20-day: $371.38 − $7.78.
    expect(at("MA_PULLBACK")).toEqual({ price: 362.4, key: "{swingLow}" });
    expect(at("MA_PULLBACK", { buyAverage: "sma20" })).toEqual({ price: 363.6, key: "{swingLow}" });
    // The gap day's low $368.63 against 8% under the buy: $367.03 at $398.95, $377.20 at $410.
    expect(at("PEAD")).toEqual({ price: 368.63, key: "{gapDayLow}" });
    expect(at("PEAD", { entry: 410 })).toEqual({ price: 377.2, key: "{gapDayLow}" });
  });

  it("refused when it can't be checked: no ATR, a buy trigger that names no average, or its average unread", () => {
    expect(at("PRE_CATALYST", { atr: null, chart: { ...TRV, atr14: null } as PriceStructure })).toEqual({ refused: "The ATR couldn't be read, so the floor's distance from the buy can't be checked." });
    expect(at("MA_PULLBACK", { buyAverage: null })).toEqual({ refused: "The playbook's floor takes one ATR under the average bought when that is higher, and its buy trigger names no average." });
    expect(at("MA_PULLBACK", { chart: { ...TRV, sma: { d50: null } } as unknown as PriceStructure })).toEqual({ refused: "The playbook's floor takes one ATR under the 50-day average when that is higher, and it couldn't be read." });
  });

  it("refused when the level is within one ATR of the buy, or not under it", () => {
    expect(at("PRE_CATALYST", { entry: 358 })).toEqual({ refused: expect.stringMatching(/fails its rule: the sale \$353\.79 is 0\.54 ATR from the \$358\.00 buy/) });
    expect(at("PRE_CATALYST", { entry: 350 })).toEqual({ refused: "The playbook's floor {swingLow} is $353.79, not under the $350.00 buy." });
  });

  it("refused when its words name no key, or the chart has no number for it", () => {
    expect(at("MOMENTUM_FLAG", { horizon: "TRADE" })).toEqual({ refused: "The playbook's floor names no chart key." });
    expect(at("EPISODIC_PIVOT", { chart: { ...TRV, gaps: [] } as unknown as PriceStructure })).toEqual({ refused: "The playbook's floor is {gapDayLow} (the gap day's low), and the chart has no gap of 3% or more in the last 10 sessions." });
    expect(at("BASE_BREAKOUT", { chart: null })).toEqual({ refused: "The playbook's floor is {baseLow} (the base's low), and the chart couldn't be read." });
  });
});

describe("the holding's playbook triggers, as the run after the buy reads them", () => {
  it("shows the floor as on, with its price and that it came with the buy, and lists the rest by the playbook's own numbers", () => {
    const text = holdingTriggersText({ ticker: "GEV", playbook: "Compounder accumulation", templates: PLAYBOOK_TEMPLATES.COMPOUNDER_ACCUMULATION, floor: "Sell if below $868" });
    expect(text.split("\n")).toEqual([
      "$GEV's playbook: Compounder accumulation.",
      "The floor is on already: Sell if below $868. It came with the buy.",
      "The triggers written at the fill:",
      "- H2 · Review every 30 days — The watch's clock, kept on the holding.",
      "- H3 · Review 60 days after the buy — The business checkpoint.",
      "- H4 · Add if above 7% from our entry — The second half.",
    ]);
    expect(text).not.toContain("H1");
    expect(text).not.toContain("{sellPrice}");
  });
});
