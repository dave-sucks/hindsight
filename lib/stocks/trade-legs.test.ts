import type { FillFacts } from "./stock-history";
import { tradeLegs } from "./trade-legs";

const fill = (over: Partial<FillFacts>): FillFacts => ({
  id: "o", positionId: "p1", thesisId: "t1", analyst: null, side: "BUY", intent: "OPEN", status: "FILLED",
  quantity: 0, price: null, at: "2026-10-02T14:31:00.000Z", rationale: null, direction: "LONG", result: null, closeReason: null,
  ...over,
});

describe("a trade's two sides", () => {
  it("is one buy and one sale on a trade that was never touched", () => {
    const fills = [
      fill({ id: "sell", side: "SELL", intent: "CLOSE", quantity: 20, price: 339.69, at: "2026-11-13T15:02:00.000Z", result: { dollar: 417.6, pct: 6.55 } }),
      fill({ id: "buy", quantity: 20, price: 318.81 }),
    ];
    const legs = tradeLegs({ id: "p1", quantity: 20, avgCost: 318.81, openedAt: "2026-10-02T14:31:00.000Z", closed: true }, fills);
    expect(legs.entry).toMatchObject({ at: "2026-10-02T14:31:00.000Z", shares: 20, count: 1 });
    expect(legs.entry?.total).toBeCloseTo(6376.2);
    expect(legs.exit).toMatchObject({ at: "2026-11-13T15:02:00.000Z", shares: 20, count: 1 });
    expect(legs.exit?.total).toBeCloseTo(6793.8);
    expect(legs.realized).toBeCloseTo(417.6);
  });

  // The position row of a trimmed trade keeps the shares left and the last sale alone; the fills hold all of it.
  it("counts the adds on the way in and the trims on the way out", () => {
    const fills = [
      fill({ id: "close", side: "SELL", intent: "CLOSE", quantity: 30, price: 120, at: "2026-11-10T15:00:00.000Z", result: { dollar: 450, pct: 14.29 } }),
      fill({ id: "trim", side: "SELL", intent: "PARTIAL_CLOSE", quantity: 10, price: 130, at: "2026-10-20T15:00:00.000Z", result: { dollar: 250, pct: 23.81 } }),
      fill({ id: "add", intent: "ADD", quantity: 10, price: 120, at: "2026-10-09T15:00:00.000Z" }),
      fill({ id: "open", quantity: 30, price: 100 }),
      fill({ id: "other", positionId: "p2", quantity: 5, price: 50 }),
      fill({ id: "waiting", side: "SELL", intent: "CLOSE", status: "AWAITING_APPROVAL", quantity: 30, price: null }),
    ];
    const legs = tradeLegs({ id: "p1", quantity: 30, avgCost: 105, openedAt: "2026-10-02T14:31:00.000Z", closed: true, closePrice: 120, realizedPnl: 450 }, fills);
    expect(legs.entry).toMatchObject({ shares: 40, price: 105, total: 4200, count: 2, at: "2026-10-02T14:31:00.000Z" });
    expect(legs.exit).toMatchObject({ shares: 40, total: 4900, count: 2, at: "2026-11-10T15:00:00.000Z" });
    expect(legs.exit?.price).toBeCloseTo(122.5);
    expect(legs.realized).toBe(700);
  });

  it("shows the trims of a trade that is still open", () => {
    const fills = [
      fill({ id: "trim", side: "SELL", intent: "PARTIAL_CLOSE", quantity: 4, price: 60, at: "2026-10-20T15:00:00.000Z", result: { dollar: 40, pct: 20 } }),
      fill({ id: "open", quantity: 14, price: 50 }),
    ];
    const legs = tradeLegs({ id: "p1", quantity: 10, avgCost: 50, openedAt: "2026-10-02T14:31:00.000Z" }, fills);
    expect(legs.entry).toMatchObject({ shares: 14, total: 700 });
    expect(legs.exit).toMatchObject({ shares: 4, total: 240, count: 1 });
    expect(legs.realized).toBe(40);
  });

  it("reads the sides off the position when its fills are not at hand", () => {
    const legs = tradeLegs({ quantity: 20, avgCost: 318.81, openedAt: "2026-10-02T14:31:00.000Z", closed: true, closedAt: "2026-11-13T15:02:00.000Z", closePrice: 339.69, realizedPnl: 417.6 }, []);
    expect(legs.entry).toMatchObject({ shares: 20, price: 318.81, count: 1 });
    expect(legs.exit).toMatchObject({ shares: 20, price: 339.69, at: "2026-11-13T15:02:00.000Z" });
    expect(legs.realized).toBe(417.6);
    expect(tradeLegs({ quantity: 11, avgCost: 911.42, openedAt: "2026-10-15T15:06:00.000Z" }, []).exit).toBeNull();
  });
});
