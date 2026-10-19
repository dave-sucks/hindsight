import { pickProposalOrder, sharesLine } from "@/lib/trade-status";

// The row a proposal lives on has two states, and the second one used to be
// invisible: you approve a sell, the order goes to Alpaca, and until the fill
// lands minutes later the row showed nothing at all (PRAX, 2026-08-31).

describe("pickProposalOrder", () => {
  it("returns nothing when no order is outstanding", () => {
    expect(pickProposalOrder([{ id: "o1", status: "FILLED" }])).toBeNull();
    expect(pickProposalOrder([])).toBeNull();
  });

  it("picks the unapproved proposal and does not call it executing", () => {
    const picked = pickProposalOrder([
      { id: "o1", status: "FILLED" },
      { id: "o2", status: "AWAITING_APPROVAL" },
    ]);
    expect(picked).toEqual({ order: { id: "o2", status: "AWAITING_APPROVAL" }, executing: false });
  });

  it("picks an approved-but-unfilled order and marks it executing", () => {
    const picked = pickProposalOrder([
      { id: "o1", status: "FILLED" },
      { id: "o2", status: "PENDING" },
    ]);
    expect(picked?.order.id).toBe("o2");
    expect(picked?.executing).toBe(true);
  });

  it("prefers a decision you still owe over one already sent", () => {
    const picked = pickProposalOrder([
      { id: "sent", status: "PENDING" },
      { id: "yours", status: "AWAITING_APPROVAL" },
    ]);
    expect(picked?.order.id).toBe("yours");
    expect(picked?.executing).toBe(false);
  });

  it("ignores rejected and cancelled orders", () => {
    expect(
      pickProposalOrder([
        { id: "o1", status: "REJECTED" },
        { id: "o2", status: "CANCELLED" },
      ]),
    ).toBeNull();
  });
});

describe("sharesLine", () => {
  it("reads shares and value on a holding", () => {
    expect(sharesLine({ shares: 11, value: 10025.56 })).toBe("11 shares · $10,025.56");
  });

  it("leads with the verb on a pending proposal", () => {
    expect(sharesLine({ shares: 300, value: 11868, intent: "CLOSE" })).toBe("Sell 300 shares · $11,868.00");
  });

  it("reads as executing after approval", () => {
    expect(sharesLine({ shares: 20, value: null, intent: "CLOSE", executing: true })).toBe("Executing: Sell 20 shares");
  });

  it("keeps the singular share", () => {
    expect(sharesLine({ shares: 1, value: null, intent: "OPEN" })).toBe("Buy 1 share");
  });
});
