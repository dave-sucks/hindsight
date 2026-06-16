/**
 * thesis-status.test.ts — display foundation for the status-taxonomy
 * migration (P1-24). See docs/plans/STATUS_TAXONOMY.md.
 *
 * getThesisStatusDisplay() falls back to a neutral "Unknown" display for any
 * unrecognized status string (guards a prod crash). P1-24 contract: the
 * fallback used to return the ACTIVE display, which silently mislabeled an
 * unknown status as "Active" (blue pulse = holding). These assertions lock the
 * new statuses in and pin the neutral fallback.
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

  it("an unknown status falls back to a neutral 'Unknown' display", () => {
    // Proves the PASSED assertion above is real coverage, not the fallback —
    // and that the fallback no longer lies by labeling unknowns "Active".
    expect(getThesisStatusDisplay("NOT_A_REAL_STATUS").label).toBe("Unknown");
  });
});
