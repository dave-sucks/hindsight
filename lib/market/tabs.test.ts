/**
 * /market was dead in production: "MARKET_TABS.find is not a function".
 *
 * The list was exported from MarketTabs.tsx, a "use client" module, and the
 * server page imported it to resolve `?tab=`. A server import of a non-
 * component export from a client module gets the client-reference proxy, not
 * the value — so `.find` did not exist. tsc was green (the types are right)
 * and `next build` was green (the page is dynamic, so it is never rendered at
 * build); it only threw on a request.
 */
import { MARKET_TABS, marketTabFromParam } from "./tabs";

describe("the market tab list", () => {
  it("is a real array, not a client-reference proxy", () => {
    expect(Array.isArray(MARKET_TABS)).toBe(true);
    expect(typeof MARKET_TABS.find).toBe("function");
    expect(MARKET_TABS.map((t) => t.value)).toEqual([
      "earnings",
      "filings",
      "movers",
      "signals",
    ]);
  });

  it("resolves ?tab= and falls back to Earnings", () => {
    expect(marketTabFromParam("movers")).toBe("movers");
    expect(marketTabFromParam("signals")).toBe("signals");
    expect(marketTabFromParam(undefined)).toBe("earnings");
    expect(marketTabFromParam("nonsense")).toBe("earnings");
  });

  it("every tab has a label and a blurb", () => {
    for (const t of MARKET_TABS) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.blurb.length).toBeGreaterThan(0);
    }
  });
});
