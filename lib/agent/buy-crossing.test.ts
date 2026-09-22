/**
 * buy-crossing.test.ts — ETN, ISRG and LUXE, replayed from the production
 * rows (DAV-303).
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
 *
 * LUXE is the other half, and the reason the PREDICATE decides which way
 * "past the level" runs. It is a LONG whose buy is PRICE_BELOW $9.10 — "the
 * non-chase PEAD entry" — and it traded at $10.08 on 2026-09-21. Reading
 * direction instead of predicate would call that a spent crossing and tell
 * the run to re-anchor a deliberate pullback level up onto the tape: the
 * exact chase the level exists to avoid. AGIO ($31.50) and NOW ($130) are
 * the same shape.
 */
import { spentBuyCrossing } from "./buy-crossing";
import { computePlanSanity } from "./plan-sanity";
import type { TriggerPredicate } from "./triggers/types";

const above = (level: number): TriggerPredicate => ({ kind: "PRICE_ABOVE", level });
const below = (level: number): TriggerPredicate => ({ kind: "PRICE_BELOW", level });

/** The two rationale-only rows ETN's plan actually got. */
const ETN_ROWS = [
  { type: "UPDATED", timestamp: new Date("2026-09-18T13:45:38.401Z"), fieldChanges: {} },
  { type: "UPDATED", timestamp: new Date("2026-09-21T12:09:10.336Z"), fieldChanges: {} },
];
const ETN = {
  status: "WATCHING",
  direction: "LONG",
  currentPrice: 425,
  enter: { predicate: above(418), lastFiredAt: "2026-09-18T13:45:15.819Z" },
  // COMPOUNDER_ACCUMULATION: "a stock at new highs on a working thesis is
  // working, not extended" — chaseLimitPct null in the catalog.
  chaseLimitPct: null,
  updates: ETN_ROWS,
  now: new Date("2026-09-22T12:00:00Z"),
};

describe("ETN — the buy fired into a full analyst and the crossing is spent", () => {
  it("is the next run's question: the level, the day it fired, and how far past it the stock is", () => {
    expect(spentBuyCrossing(ETN)).toEqual({
      level: 418,
      crossing: "ABOVE",
      firedAt: "2026-09-18",
      pastPct: expect.closeTo(1.674, 2),
      chaseLimitPct: null,
      insideChase: true,
    });
  });

  it("ISRG is the same shape a day earlier", () => {
    const c = spentBuyCrossing({
      ...ETN,
      currentPrice: 393,
      enter: { predicate: above(383), lastFiredAt: "2026-09-17T16:40:19.704Z" },
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
    expect(flag!.text).toContain(
      "The buy at $418.00 — which fires when the price rises through it — fired on 2026-09-18",
    );
    expect(flag!.text).toContain("$425.00 now, 1.7% above it");
    expect(flag!.text).toContain("the buy cannot fire again");
    expect(flag!.text).toContain("This setup has no chase rule");
    expect(flag!.text).toContain("the old level becomes support");
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

// The defect the QB caught before this merged. A LONG bought on a pullback
// fires when the price comes DOWN to the level; a price above it means the
// buy has not arrived, not that the crossing is spent.
describe("LUXE — a pullback buy the price has not reached is not spent", () => {
  const LUXE = {
    status: "WATCHING",
    direction: "LONG",
    currentPrice: 10.08,
    enter: { predicate: below(9.1), lastFiredAt: "2026-09-19T14:00:00.000Z" },
    chaseLimitPct: 10,
    updates: [],
    now: new Date("2026-09-22T12:00:00Z"),
  };

  it("$10.08 against a PRICE_BELOW $9.10 buy raises nothing", () => {
    expect(spentBuyCrossing(LUXE)).toBeNull();
    expect(
      computePlanSanity({
        status: "WATCHING",
        direction: "LONG",
        entryPrice: 9.1,
        targetPrice: 12,
        stopLoss: 8.2,
        currentPrice: 10.08,
        spentBuyCrossing: spentBuyCrossing(LUXE),
      }).some((f) => f.kind === "BUY_FIRED_UNANSWERED"),
    ).toBe(false);
  });

  it("AGIO ($31.50, trading $33.07) and NOW ($130, trading $138.26) are the same shape", () => {
    expect(
      spentBuyCrossing({ ...LUXE, currentPrice: 33.07, enter: { predicate: below(31.5), lastFiredAt: LUXE.enter.lastFiredAt } }),
    ).toBeNull();
    expect(
      spentBuyCrossing({ ...LUXE, currentPrice: 138.26, enter: { predicate: below(130), lastFiredAt: LUXE.enter.lastFiredAt } }),
    ).toBeNull();
  });

  it("the same pullback buy IS spent once the price falls through and keeps going", () => {
    // 7.7% below a $9.10 level is still inside PEAD's 10% chase rule, so the
    // answer is re-anchor — and the level it cleared is resistance now, not
    // support.
    const c = spentBuyCrossing({ ...LUXE, currentPrice: 8.4 });
    expect(c).toMatchObject({ level: 9.1, crossing: "BELOW", insideChase: true });
    expect(c!.pastPct).toBeCloseTo(7.69, 2);
    const flag = computePlanSanity({
      status: "WATCHING",
      direction: "LONG",
      entryPrice: 9.1,
      targetPrice: 12,
      stopLoss: 8.2,
      currentPrice: 8.4,
      spentBuyCrossing: c,
    }).find((f) => f.kind === "BUY_FIRED_UNANSWERED");
    expect(flag!.text).toContain("which fires when the price falls to it");
    expect(flag!.text).toContain("7.7% below it");
    expect(flag!.text).toContain("the old level becomes resistance");
  });

  it("further through it, the answer flips to re-pricing rather than chasing", () => {
    const c = spentBuyCrossing({ ...LUXE, currentPrice: 8 });
    expect(c?.insideChase).toBe(false);
    expect(c!.pastPct).toBeCloseTo(12.09, 2);
    const flag = computePlanSanity({
      status: "WATCHING",
      direction: "LONG",
      entryPrice: 9.1,
      targetPrice: 12,
      stopLoss: 8.2,
      currentPrice: 8,
      spentBuyCrossing: c,
    }).find((f) => f.kind === "BUY_FIRED_UNANSWERED");
    expect(flag!.text).toContain("chase limit is 10% and the stock is 12.1% below it");
    expect(flag!.text).toContain("buying here is a chase");
  });
});

describe("only a plain price level can be read this way", () => {
  // GD, GEV and SYK all buy on a 50-day reclaim. There is no single number
  // the price can be "past", and inventing one is how a pullback entry gets
  // read backwards.
  it.each<[string, TriggerPredicate]>([
    ["VS_SMA (GD / GEV / SYK)", { kind: "VS_SMA", period: 50, direction: "ABOVE" }],
    ["NEAR_SMA", { kind: "NEAR_SMA", period: 50, withinPct: 2 }],
    ["VOLUME_RATIO", { kind: "VOLUME_RATIO", min: 1.5 }],
    [
      "a composite breakout",
      {
        kind: "AND",
        predicates: [
          { kind: "PRICE_ABOVE", level: 418, basis: "close" },
          { kind: "VOLUME_RATIO", min: 1.5 },
        ],
      },
    ],
  ])("%s raises nothing", (_label, predicate) => {
    expect(spentBuyCrossing({ ...ETN, enter: { predicate, lastFiredAt: ETN.enter.lastFiredAt } })).toBeNull();
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
    expect(spentBuyCrossing({ ...ETN, enter: { predicate: above(418), lastFiredAt: null } })).toBeNull();
    expect(spentBuyCrossing({ ...ETN, enter: null })).toBeNull();
  });

  it("BWXT's June fire is not today's question", () => {
    expect(
      spentBuyCrossing({ ...ETN, enter: { predicate: above(160), lastFiredAt: "2026-06-29T13:00:29.404Z" } }),
    ).toBeNull();
  });

  it("no live price means nothing to measure", () => {
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
    expect(flag!.text).toContain("This setup's chase limit is 5% and the stock is 1.7% above it, so it is still buyable");
  });

  it("past it: buying here is a chase — re-price to the level the setup waits for", () => {
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
    expect(flag!.text).toContain("re-price the buy to the level this setup waits for");
  });
});

describe("a SHORT reads off its own predicate too", () => {
  it("a breakdown entry is spent when the price is below the level", () => {
    const base = { ...ETN, direction: "SHORT" };
    expect(
      spentBuyCrossing({ ...base, currentPrice: 97, enter: { predicate: below(100), lastFiredAt: ETN.enter.lastFiredAt } })?.pastPct,
    ).toBeCloseTo(3, 5);
    expect(
      spentBuyCrossing({ ...base, currentPrice: 103, enter: { predicate: below(100), lastFiredAt: ETN.enter.lastFiredAt } }),
    ).toBeNull();
  });
});
