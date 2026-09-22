/**
 * buy-crossing.test.ts — ETN and ISRG, replayed from the production rows
 * (DAV-303).
 *
 * The Secular Compounder, limit 4, held ABT/ASML/CEG/WST.
 *   ETN  thesis cmqeg5hyu000a04l1jsoavysc — buy PRICE_ABOVE 418,
 *        lastFiredAt 2026-09-18T13:45:15.819Z. place_trade refused it at the
 *        position limit; the run wrote one rationale-only row 23 seconds
 *        later ("Updated ETN thesis", fieldChanges {}) and another on 09-21
 *        ("Full — waiting", fieldChanges {}). Neither touched the ladder.
 *   ISRG thesis cmsplh2ow000m04l74ho8iti0 — buy PRICE_ABOVE 383,
 *        lastFiredAt 2026-09-17T16:40:19.704Z, same wall on 09-16 and 09-17.
 *
 * Dave raised the limit to 6 on 09-21. Both seats now have room, both stocks
 * are past their level (ETN $425, ISRG $393), and neither buy can fire
 * again — a buy fires on the crossing. Before this module nothing asked.
 */
import { spentBuyCrossing } from "./buy-crossing";
import { computePlanSanity } from "./plan-sanity";

/** The two rationale-only rows ETN's plan actually got. */
const ETN_ROWS = [
  { type: "UPDATED", timestamp: new Date("2026-09-18T13:45:38.401Z"), fieldChanges: {} },
  { type: "UPDATED", timestamp: new Date("2026-09-21T12:09:10.336Z"), fieldChanges: {} },
];
const ETN = {
  status: "WATCHING",
  direction: "LONG",
  entryPrice: 418,
  currentPrice: 425,
  enterLastFiredAt: "2026-09-18T13:45:15.819Z",
  // COMPOUNDER_ACCUMULATION: "a stock at new highs on a working thesis is
  // working, not extended" — chaseLimitPct null in the catalog.
  chaseLimitPct: null,
  updates: ETN_ROWS,
  now: new Date("2026-09-22T12:00:00Z"),
};

describe("ETN — the buy fired into a full analyst and the crossing is spent", () => {
  it("is the next run's question: the level, the day it fired, and how far past it the stock is", () => {
    const c = spentBuyCrossing(ETN);
    expect(c).toEqual({
      level: 418,
      firedAt: "2026-09-18",
      pastPct: expect.closeTo(1.674, 2),
      chaseLimitPct: null,
      insideChase: true,
    });
  });

  it("ISRG is the same shape a day earlier", () => {
    const c = spentBuyCrossing({
      ...ETN,
      entryPrice: 383,
      currentPrice: 393,
      enterLastFiredAt: "2026-09-17T16:40:19.704Z",
      updates: [
        { type: "UPDATED", timestamp: new Date("2026-09-17T16:40:41.616Z"), fieldChanges: {} },
        { type: "UPDATED", timestamp: new Date("2026-09-18T12:06:51.416Z"), fieldChanges: {} },
        { type: "UPDATED", timestamp: new Date("2026-09-21T12:09:10.634Z"), fieldChanges: {} },
      ],
    });
    expect(c?.firedAt).toBe("2026-09-17");
    expect(c?.pastPct).toBeCloseTo(2.611, 2);
    expect(c?.insideChase).toBe(true);
  });

  it("arrives on the work list as a plan-sanity flag stating the arithmetic", () => {
    const flags = computePlanSanity({
      status: "WATCHING",
      direction: "LONG",
      entryPrice: 418,
      targetPrice: 560,
      stopLoss: 355,
      currentPrice: 425,
      spentBuyCrossing: spentBuyCrossing(ETN),
    });
    const flag = flags.find((f) => f.kind === "BUY_FIRED_UNANSWERED");
    expect(flag).toBeDefined();
    expect(flag!.text).toContain("The buy at $418.00 fired on 2026-09-18");
    expect(flag!.text).toContain("$425.00 now, 1.7% past it");
    expect(flag!.text).toContain("the buy cannot fire again");
    expect(flag!.text).toContain("This setup has no chase rule");
    expect(flag!.text).toContain("re-anchor the buy to the current price");
    expect(flag!.text).toContain("set the plan down");
  });

  it("no other flag catches it — the level sits just UNDER the tape", () => {
    // Without the crossing, ETN's row is silent: 1.7% is nowhere near the
    // 10% distance flag, the target is not passed, the stop is not breached.
    expect(
      computePlanSanity({
        status: "WATCHING",
        direction: "LONG",
        entryPrice: 418,
        targetPrice: 560,
        stopLoss: 355,
        currentPrice: 425,
      }),
    ).toEqual([]);
  });
});

describe("what clears it", () => {
  it("a ladder edit after the fire — the run re-anchored, re-priced or set the plan down", () => {
    expect(
      spentBuyCrossing({
        ...ETN,
        updates: [
          ...ETN_ROWS,
          {
            type: "UPDATED",
            timestamp: new Date("2026-09-22T12:10:00Z"),
            fieldChanges: { triggerOps: { from: null, to: [{ op: "edit" }] } },
          },
        ],
      }),
    ).toBeNull();
  });

  it("a ladder edit BEFORE the fire does not — that is the plan the buy fired on", () => {
    expect(
      spentBuyCrossing({
        ...ETN,
        updates: [
          { type: "UPDATED", timestamp: new Date("2026-09-14T12:02:50.519Z"), fieldChanges: { triggerOps: { from: null, to: [] } } },
          ...ETN_ROWS,
        ],
      }),
    ).not.toBeNull();
  });

  it("the price falling back under the level — the buy can cross again", () => {
    expect(spentBuyCrossing({ ...ETN, currentPrice: 410 })).toBeNull();
    expect(spentBuyCrossing({ ...ETN, currentPrice: 418 })).toBeNull();
  });

  it("the stock being bought — a HOLDING row has no buy plan to answer", () => {
    expect(spentBuyCrossing({ ...ETN, status: "HOLDING" })).toBeNull();
  });
});

describe("scope guards", () => {
  it("a buy that never fired is not a spent crossing", () => {
    expect(spentBuyCrossing({ ...ETN, enterLastFiredAt: null })).toBeNull();
  });

  it("BWXT's June fire is not today's question", () => {
    expect(spentBuyCrossing({ ...ETN, enterLastFiredAt: "2026-06-29T13:00:29.404Z" })).toBeNull();
  });

  it("no written buy level, or no live price, means nothing to measure", () => {
    expect(spentBuyCrossing({ ...ETN, entryPrice: null })).toBeNull();
    expect(spentBuyCrossing({ ...ETN, currentPrice: null })).toBeNull();
  });

  it("an unresearched seed has no plan", () => {
    expect(spentBuyCrossing({ ...ETN, direction: null })).toBeNull();
  });
});

describe("the setup's chase limit decides which answer the run owes", () => {
  it("inside it: still buyable, re-anchor to today's price", () => {
    const c = spentBuyCrossing({ ...ETN, chaseLimitPct: 5 });
    expect(c?.insideChase).toBe(true);
    const flag = computePlanSanity({
      status: "WATCHING",
      direction: "LONG",
      entryPrice: 418,
      targetPrice: 560,
      stopLoss: 355,
      currentPrice: 425,
      spentBuyCrossing: c,
    }).find((f) => f.kind === "BUY_FIRED_UNANSWERED");
    expect(flag!.text).toContain("This setup's chase limit is 5% and the stock is 1.7% past it, so it is still buyable");
  });

  it("past it: buying here is a chase — re-price to the pullback", () => {
    const c = spentBuyCrossing({ ...ETN, currentPrice: 460, chaseLimitPct: 5 });
    expect(c?.insideChase).toBe(false);
    const flag = computePlanSanity({
      status: "WATCHING",
      direction: "LONG",
      entryPrice: 418,
      targetPrice: 560,
      stopLoss: 355,
      currentPrice: 460,
      spentBuyCrossing: c,
    }).find((f) => f.kind === "BUY_FIRED_UNANSWERED");
    expect(flag!.text).toContain("buying here is a chase");
    expect(flag!.text).toContain("re-price the buy to the pullback");
  });
});

describe("a SHORT reads the other way", () => {
  it("past the level means below it", () => {
    const base = { ...ETN, direction: "SHORT", entryPrice: 100 };
    expect(spentBuyCrossing({ ...base, currentPrice: 97 })?.pastPct).toBeCloseTo(3, 5);
    expect(spentBuyCrossing({ ...base, currentPrice: 103 })).toBeNull();
  });
});
