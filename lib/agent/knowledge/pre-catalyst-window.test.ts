/**
 * pre-catalyst-window.test.ts — the one buying window, in words (DAV-338).
 *
 * CORT's FDA date is Dec 17. On 2026-09-29 its buy fired 79 days out and
 * the trigger run proposed a buy, told nothing about the window. The
 * setup's own numbers (open 70 days out, no buy inside the last 21) are
 * what plan-sanity and the setup's confirmation already use.
 */
import { getSetup, preCatalystWindowLine } from "./setups";

const CORT = { setupId: "PRE_CATALYST", horizon: "CATALYST", catalystDate: "2026-12-17T00:00:00.000Z" };
const at = (iso: string) => new Date(iso);

describe("preCatalystWindowLine", () => {
  it("CORT 2026-09-29: 79 days out, 9 days before the window opens", () => {
    expect(preCatalystWindowLine(CORT, at("2026-09-29T14:30:18Z"))).toBe(
      "79 days to the event date (Dec 17), so the buying window opens in 9 days (Oct 8). " +
        "A run-up into the event buys 70 to 21 days before it.",
    );
  });

  it("counts the Eastern trading day, not UTC's — 21:00 ET is still the same day", () => {
    expect(preCatalystWindowLine(CORT, at("2026-09-30T01:00:00Z"))).toMatch(/^79 days to the event date/);
  });

  it("inside the window", () => {
    expect(preCatalystWindowLine(CORT, at("2026-10-08T14:00:00Z"))).toBe(
      "70 days to the event date (Dec 17), inside the buying window. A run-up into the event buys 70 to 21 days before it.",
    );
    expect(preCatalystWindowLine(CORT, at("2026-11-25T14:00:00Z"))).toMatch(/22 days to the event date \(Dec 17\), inside/);
  });

  it("inside the last 21 days it says the window closed, and when", () => {
    expect(preCatalystWindowLine(CORT, at("2026-11-26T14:00:00Z"))).toBe(
      "21 days to the event date (Dec 17), past the buying window, which closed Nov 26. " +
        "A run-up into the event buys 70 to 21 days before it.",
    );
  });

  it("after the event it says the date has passed", () => {
    expect(preCatalystWindowLine(CORT, at("2026-12-18T14:00:00Z"))).toMatch(/^The event date on file \(Dec 17\) has passed\./);
  });

  it("the setup's own text says the same window as the line — one number (QB ruling, 2026-09-29)", () => {
    const d8 = getSetup("PRE_CATALYST")!;
    const text = [...d8.preconditions, d8.entry.text].join(" ");
    expect(text).toContain("21–70 days out");
    expect(text).not.toMatch(/\b14\b/);
  });

  it("an unnamed CATALYST stock lives by the window too; a named other setup and a stock with no date do not", () => {
    expect(preCatalystWindowLine({ ...CORT, setupId: null }, at("2026-09-29T14:30:00Z"))).toMatch(/^79 days to the event date/);
    expect(preCatalystWindowLine({ ...CORT, setupId: "PEAD" }, at("2026-09-29T14:30:00Z"))).toBeNull();
    expect(preCatalystWindowLine({ ...CORT, horizon: "TARGET", setupId: "MA_PULLBACK" }, at("2026-09-29T14:30:00Z"))).toBeNull();
    expect(preCatalystWindowLine({ ...CORT, catalystDate: null }, at("2026-09-29T14:30:00Z"))).toBeNull();
  });
});
