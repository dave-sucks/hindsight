import { addRoom, planManualOrder, type TradeLane } from "@/lib/trading/manual-order-rules";

const held: TradeLane = {
  analystId: "a1",
  analystName: "Secular Compounder",
  position: { id: "p1", shares: 11, avgCost: 911.41 },
  sellBlocked: null,
  buy: { kind: "ADD", maxShares: 5, cap: 20000 },
};

const watched: TradeLane = {
  analystId: "a1",
  analystName: "Secular Compounder",
  position: null,
  sellBlocked: null,
  buy: { kind: "OPEN", thesisId: "t1", needsResearch: false, targetPrice: 1100, stopLoss: 800 },
};

describe("planManualOrder — sells", () => {
  it("sells all as a full close", () => {
    expect(planManualOrder(held, { side: "SELL", shares: 11, reviewedPrice: 878.84 }, 878.84)).toEqual({
      ok: true,
      intent: "CLOSE",
      shares: 11,
    });
  });

  it("sells part as a trim", () => {
    expect(planManualOrder(held, { side: "SELL", shares: 4, reviewedPrice: 878.84 }, 878.84)).toEqual({
      ok: true,
      intent: "PARTIAL_CLOSE",
      shares: 4,
    });
  });

  it("sells a fractional holding only as all of it", () => {
    const frac = { ...held, position: { id: "p1", shares: 12.5, avgCost: 100 } };
    expect(planManualOrder(frac, { side: "SELL", shares: 12.5, reviewedPrice: 100 }, 100)).toMatchObject({ ok: true, intent: "CLOSE" });
    expect(planManualOrder(frac, { side: "SELL", shares: 2.5, reviewedPrice: 100 }, 100)).toMatchObject({ ok: false });
  });

  it("never sells more than is held", () => {
    expect(planManualOrder(held, { side: "SELL", shares: 12, reviewedPrice: 878.84 }, 878.84)).toMatchObject({ ok: false });
  });

  it("refuses with nothing held", () => {
    expect(planManualOrder(watched, { side: "SELL", shares: 1, reviewedPrice: 100 }, 100)).toMatchObject({ ok: false });
  });

  it("refuses while another sale is being sent", () => {
    const busy = { ...held, sellBlocked: "A sale is already being sent." };
    expect(planManualOrder(busy, { side: "SELL", shares: 1, reviewedPrice: 878.84 }, 878.84)).toEqual({
      ok: false,
      error: "A sale is already being sent.",
    });
  });
});

describe("planManualOrder — buys", () => {
  it("adds within the room left", () => {
    expect(planManualOrder(held, { side: "BUY", shares: 5, reviewedPrice: 878.84 }, 878.84)).toEqual({
      ok: true,
      intent: "ADD",
      shares: 5,
    });
    expect(planManualOrder(held, { side: "BUY", shares: 6, reviewedPrice: 878.84 }, 878.84)).toMatchObject({ ok: false });
  });

  it("opens with a stop below and a target above the price", () => {
    const ok = { side: "BUY" as const, shares: 3, reviewedPrice: 900, stopLoss: 800, targetPrice: 1100 };
    expect(planManualOrder(watched, ok, 900)).toEqual({ ok: true, intent: "OPEN", shares: 3 });
    expect(planManualOrder(watched, { ...ok, stopLoss: 950 }, 900)).toMatchObject({ ok: false });
    expect(planManualOrder(watched, { ...ok, targetPrice: 890 }, 900)).toMatchObject({ ok: false });
    expect(planManualOrder(watched, { ...ok, stopLoss: null }, 900)).toMatchObject({ ok: false });
  });

  it("buys whole shares only", () => {
    expect(planManualOrder(held, { side: "BUY", shares: 1.5, reviewedPrice: 878.84 }, 878.84)).toMatchObject({ ok: false });
  });

  it("refuses when the lane can't buy", () => {
    const none: TradeLane = { ...watched, buy: { kind: "NONE", reason: "No thesis." } };
    expect(planManualOrder(none, { side: "BUY", shares: 1, reviewedPrice: 100 }, 100)).toEqual({ ok: false, error: "No thesis." });
  });
});

describe("planManualOrder — the price", () => {
  it("refuses when the price moved more than 2% since review", () => {
    expect(planManualOrder(held, { side: "SELL", shares: 1, reviewedPrice: 100 }, 102.5)).toMatchObject({ ok: false });
    expect(planManualOrder(held, { side: "SELL", shares: 1, reviewedPrice: 100 }, 101.9)).toMatchObject({ ok: true });
  });

  it("refuses a buy on a stale quote, but not a sale", () => {
    expect(planManualOrder(held, { side: "BUY", shares: 1, reviewedPrice: 100 }, 100, true)).toMatchObject({ ok: false });
    expect(planManualOrder(held, { side: "SELL", shares: 1, reviewedPrice: 100 }, 100, true)).toMatchObject({ ok: true });
  });

  it("refuses zero or negative shares", () => {
    expect(planManualOrder(held, { side: "BUY", shares: 0, reviewedPrice: 100 }, 100)).toMatchObject({ ok: false });
  });
});

describe("addRoom", () => {
  it("matches the approval-time arithmetic", () => {
    // $20,000 cap, 11 sh at $911.41 held = $10,025.51; $9,974.49 left at $878.84 → 11 shares
    expect(addRoom({ cap: 20000, heldShares: 11, avgCost: 911.41, sentShares: 0, price: 878.84 })).toBe(11);
    expect(addRoom({ cap: 20000, heldShares: 11, avgCost: 911.41, sentShares: 11, price: 878.84 })).toBe(0);
  });
});
