/**
 * thesis-status.test.ts — display foundation for the status-taxonomy
 * migration (P1-24). See docs/plans/STATUS_TAXONOMY.md.
 *
 * getThesisStatusDisplay() silently falls back to the ACTIVE display for
 * any unknown status string (guards a prod crash). That fallback makes a
 * regression here INVISIBLE: if PASSED were ever dropped from the Record,
 * a PASS thesis would render "Active" instead of "Passed" with no error.
 * These assertions lock the new statuses in.
 */

import { getThesisStatusDisplay } from "./thesis-status";

describe("THESIS_STATUS_DISPLAY — status-taxonomy migration (P1-24)", () => {
  it("PASSED renders 'Passed' (NOT the silent ACTIVE fallback)", () => {
    const d = getThesisStatusDisplay("PASSED");
    expect(d.label).toBe("Passed");
    expect(d.tooltip).toMatch(/declined/i);
  });

  it("HOLDING renders 'Holding'", () => {
    expect(getThesisStatusDisplay("HOLDING").label).toBe("Holding");
  });

  it("RETIRED renders 'Retired'", () => {
    expect(getThesisStatusDisplay("RETIRED").label).toBe("Retired");
  });

  it("an unknown status still falls back to the ACTIVE display", () => {
    // Proves the PASSED assertion above is real coverage, not the fallback.
    expect(getThesisStatusDisplay("NOT_A_REAL_STATUS").label).toBe("Active");
  });
});
