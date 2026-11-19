/**
 * The thesis a stock's page shows, and the label a retired one carries.
 *
 * P (Everpure), 2026-11-19: the Writer (run cmwnosqeu000h07jmwo3e6w1m) saved
 * a full PASS (the belief, two assumptions, three ways it would be wrong, bull
 * and bear). The stock page drew only a live thesis, so P's page showed a
 * skeleton reading "No research yet", which the owner read as blank.
 */
import { getThesisStatusDisplay, thesisToShow } from "./thesis-status";

// P's row as the page's query returns it (newest first), the fields this reads.
const P_PASS = { id: "p_pass", ticker: "P", status: "PASSED", retiredReason: null, createdAt: new Date("2026-11-19T15:11:40Z") };

describe("the thesis a stock's page shows", () => {
  it("P's PASS, the only thesis on the stock, is shown", () => {
    expect(thesisToShow([P_PASS])).toBe(P_PASS);
  });

  it("a live thesis wins over a newer pass or sale", () => {
    const watch = { ...P_PASS, id: "watch", status: "WATCHING", createdAt: new Date("2026-11-01") };
    const sold = { ...P_PASS, id: "sold", status: "RETIRED", retiredReason: "SOLD" };
    expect(thesisToShow([sold, watch])).toBe(watch);
  });

  it("a stock never researched shows none", () => {
    expect(thesisToShow([])).toBeNull();
  });
});

describe("a retired thesis says how it ended", () => {
  it.each([
    ["SOLD", "Sold"],
    ["DROPPED", "Dropped"],
    ["INVALIDATED", "Invalidated"],
    ["REPLACED", "Replaced"],
  ])("RETIRED + %s reads %s", (reason, label) => {
    expect(getThesisStatusDisplay("RETIRED", reason).label).toBe(label);
  });

  it("a pass reads Passed, and a retired one with no reason Retired", () => {
    expect(getThesisStatusDisplay("PASSED").label).toBe("Passed");
    expect(getThesisStatusDisplay("RETIRED", null).label).toBe("Retired");
  });
});
