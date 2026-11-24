/**
 * thesis-belief.test.ts — validateThesisBelief: a LONG or SHORT thesis needs
 * its belief and two or more KPIs; a PASS and an unresearched seed need neither.
 */

import { validateThesisBelief } from "./thesis-belief";

const KPIS = [
  "Net new ARR: on track at $200M+ a quarter, broken under $180M. Read at each report.",
  "Gross margin: on track at 78%+, broken under 75%. Read in each 10-Q.",
];

describe("validateThesisBelief", () => {
  it("PASS and an unresearched seed: the gate doesn't apply", () => {
    expect(validateThesisBelief({ direction: "PASS", coreBelief: "", kpis: [] })).toEqual({ ok: true });
    expect(validateThesisBelief({ direction: null })).toEqual({ ok: true });
  });

  it("LONG with a belief and two KPIs passes; SHORT too", () => {
    expect(validateThesisBelief({ direction: "LONG", coreBelief: "The platform keeps taking share.", kpis: KPIS })).toEqual({ ok: true });
    expect(validateThesisBelief({ direction: "SHORT", coreBelief: "Demand is rolling over.", kpis: KPIS })).toEqual({ ok: true });
  });

  it("names each missing field: an empty belief, and fewer than two KPIs once blank lines are dropped", () => {
    const r = validateThesisBelief({ direction: "LONG", coreBelief: "   ", kpis: [KPIS[0], "  "] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missingFields).toEqual(["core_belief", "kpis"]);
    expect(r.note).toContain("kpis: two to four lines");
  });
});
