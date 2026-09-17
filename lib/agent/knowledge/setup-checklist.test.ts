/**
 * setup-checklist.test.ts — get_theses tells the run which rows have no
 * setup (DAV-285). Production 2026-09-17: 3 of 32 stocks had one.
 */
import { nameTheSetup } from "./setup-checklist";

describe("nameTheSetup — the ask a row with no setup carries", () => {
  it("ABT (held, Secular Compounder, no setup): asks, and offers the seat's setups", () => {
    const ask = nameTheSetup({ setupId: null, status: "HOLDING", entryPrice: 103.663 }, "Secular Compounder");
    expect(ask?.choose.map((c) => c.id)).toEqual(
      expect.arrayContaining(["COMPOUNDER_ACCUMULATION", "BASE_BREAKOUT", "MA_PULLBACK"]),
    );
    expect(ask?.choose).toHaveLength(3);
    expect(ask?.ask).toMatch(/writes the setup's own exits/);
  });

  it("a watched stock with a buy price is asked too; one with no plan is not", () => {
    expect(nameTheSetup({ setupId: null, status: "WATCHING", entryPrice: 50 }, "PEAD Specialist")).not.toBeNull();
    expect(nameTheSetup({ setupId: null, status: "WATCHING", entryPrice: null }, "PEAD Specialist")).toBeNull();
  });

  it("stops asking once a setup is named, or a review said none fits", () => {
    expect(nameTheSetup({ setupId: "PEAD", status: "HOLDING", entryPrice: 10 }, "PEAD Specialist")).toBeNull();
    expect(nameTheSetup({ setupId: "NONE", status: "HOLDING", entryPrice: 10 }, "PEAD Specialist")).toBeNull();
  });

  it("a retired row is never asked", () => {
    expect(nameTheSetup({ setupId: null, status: "RETIRED", entryPrice: 10 }, "PEAD Specialist")).toBeNull();
  });
});
