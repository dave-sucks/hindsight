/**
 * The row carries the view (the KPIs, the conviction rationale) on every
 * stock an agent decides on; the bull and bear cases and the research summary come when the read asks. Fixture: CEG's held row from scripts/hero-cases/ceg-plan-stands, cut short, with every field set.
 */
import fixture from "@/lib/agent/__fixtures__/short-row-ceg-2026-09-25.json";
import { rowForModel } from "@/lib/agent/row-for-model";

type Row = Record<string, unknown>;
// Read as the migration left it (2026-11-24): its KPIs are its assumptions and what would prove it wrong.
const saved = (): Row => ({ ...fixture, kpis: [...fixture.keyAssumptions, ...fixture.invalidationConds] }) as Row;

it("the row prints these keys, in this order", () => {
  const row = rowForModel(saved()) as Row;
  expect(Object.keys(row)).toEqual([
    "stock", "id", "analyst", "situations", "said", "position", "proposal_waiting", "price",
    "floor_risk", "triggers", "belief", "kpis",
    "conviction_rationale",
    "playbook_checks", "buyBlockedByFull", "heldThroughFloor", "supersededBy", "chart",
    "research", "catalyst", "repeat",
  ]);
});

it("a read that asks for the research and the history adds those four fields and nothing else", () => {
  const short = Object.keys(rowForModel(saved()) as Row);
  const full = Object.keys(rowForModel(saved(), { research: true, history: true }) as Row);
  // The seven research sections the Writer stopped writing on 2026-11-03 are on the saved row and never sent.
  expect([...full].sort()).toEqual([...short, "bull_case", "bear_case", "snapshot", "history"].sort());
  expect(full.filter((k) => short.includes(k))).toEqual(short);
});

it("the company line sits right under the stock line, on the short row and the full one (2026-11-03)", () => {
  const company = "Sells widgets; revenue is subscription.";
  for (const size of ["short", "full"] as const) {
    const row = rowForModel({ ...saved(), company }, size === "full" ? { research: true, history: true } : {}) as Row;
    expect(Object.keys(row).slice(0, 2)).toEqual(["stock", "company"]);
    expect(row.company).toBe(company);
  }
  // A stock written up before the Writer wrote company lines has none, and no empty key.
  expect(Object.keys(rowForModel(saved()) as Row)).not.toContain("company");
});
