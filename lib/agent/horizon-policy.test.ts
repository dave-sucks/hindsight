/**
 * horizon-policy.test.ts — anti-regression for the WATCHING vs ACTIVE
 * review-cadence split (A4).
 *
 * Pre-A4 both used HORIZON_REVIEW_DAYS (held-side 1/1/7/30 days), which
 * scheduled brand-new COMPOUNDER WATCHING theses for first review 30
 * days out — too aggressive. A4 added WATCHING_FIRST_REVIEW_DAYS
 * (14/14/30/90) for the WATCHING-side default.
 *
 * Belt + suspenders: if someone tries to "simplify" by reverting either
 * table to a flat shape, this test fails.
 */

import {
  HORIZON_REVIEW_DAYS,
  WATCHING_FIRST_REVIEW_DAYS,
  HORIZONS,
} from "./horizon-policy";

describe("horizon-policy review cadences", () => {
  describe("HORIZON_REVIEW_DAYS (held-side)", () => {
    it("covers every horizon", () => {
      for (const h of HORIZONS) {
        expect(HORIZON_REVIEW_DAYS[h]).toBeDefined();
      }
    });
    it("scales with hold style (TRADE tightest, COMPOUNDER loosest)", () => {
      expect(HORIZON_REVIEW_DAYS.TRADE).toBeLessThanOrEqual(HORIZON_REVIEW_DAYS.CATALYST);
      expect(HORIZON_REVIEW_DAYS.CATALYST).toBeLessThanOrEqual(HORIZON_REVIEW_DAYS.TARGET);
      expect(HORIZON_REVIEW_DAYS.TARGET).toBeLessThanOrEqual(HORIZON_REVIEW_DAYS.COMPOUNDER);
    });
  });

  describe("WATCHING_FIRST_REVIEW_DAYS", () => {
    it("covers every horizon", () => {
      for (const h of HORIZONS) {
        expect(WATCHING_FIRST_REVIEW_DAYS[h]).toBeDefined();
      }
    });
    it("is always ≥ the held-side cadence (WATCHING reviews less often than ACTIVE)", () => {
      for (const h of HORIZONS) {
        expect(WATCHING_FIRST_REVIEW_DAYS[h]).toBeGreaterThanOrEqual(HORIZON_REVIEW_DAYS[h]);
      }
    });
    it("COMPOUNDER WATCHING first review is at least 60 days out (not 30)", () => {
      // Anti-regression for the original bug: a 1-month first review on
      // a multi-year hold candidate is too aggressive. The current value
      // is 90; we assert ≥60 to leave room for future tuning without
      // re-introducing the 30-day mistake.
      expect(WATCHING_FIRST_REVIEW_DAYS.COMPOUNDER).toBeGreaterThanOrEqual(60);
    });
    it("CATALYST WATCHING first review is at least 7 days out (not 1)", () => {
      // Anti-regression: pre-A4 the held-side CATALYST cadence (1 day)
      // applied to WATCHING too — daily review on a watch candidate is
      // pure busywork.
      expect(WATCHING_FIRST_REVIEW_DAYS.CATALYST).toBeGreaterThanOrEqual(7);
    });
  });
});
