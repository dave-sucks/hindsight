/**
 * The short row carries the whole view (the bull and bear cases, the conviction rationale, the variant view) on every
 * stock an agent decides on. Fixture: CEG's held row from scripts/hero-cases/ceg-plan-stands, cut short, with every field set.
 */
import fixture from "@/lib/agent/__fixtures__/short-row-ceg-2026-09-25.json";
import { rowForModel } from "@/lib/agent/row-for-model";

type Row = Record<string, unknown>;
const saved = (): Row => ({ ...fixture }) as Row;

it("the short row prints these keys, in this order", () => {
  const row = rowForModel(saved(), { named: false, size: "short" }) as Row;
  expect(Object.keys(row)).toEqual([
    "stock", "id", "analyst", "situations", "said", "position", "proposal_waiting", "price", "plan", "plan_checks",
    "protection", "floor_risk", "triggers", "belief", "assumptions", "would_prove_it_wrong",
    "bull_case", "bear_case", "conviction_rationale", "variant_view",
    "setup", "nameTheSetup", "buyBlockedByFull", "heldThroughFloor", "supersededBy", "snapshot", "score", "chart",
    "research", "catalyst", "repeat", "note",
  ]);
});

it("the full row is the short row plus the score notes, the seven research sections and the history", () => {
  // The trigger run's short row, so both carry the setup's lines (the full row always does).
  const short = Object.keys(rowForModel(saved(), { named: true, size: "short", setupLines: true }) as Row);
  const full = Object.keys(rowForModel(saved(), { named: true, size: "full" }) as Row);
  const sections = ["recentCatalysts", "fundamentals", "latestEarnings", "catalystsAndEvents", "analystConsensus", "insiderTechnical", "researchData"];
  expect([...full].sort()).toEqual([...short, "score_notes", ...sections, "history"].sort());
  expect(full.filter((k) => short.includes(k))).toEqual(short);
});

it("the company line sits right under the stock line, on the short row and the full one (2026-11-03)", () => {
  const company = "Sells widgets; revenue is subscription.";
  for (const size of ["short", "full"] as const) {
    const row = rowForModel({ ...saved(), company }, { named: size === "full", size }) as Row;
    expect(Object.keys(row).slice(0, 2)).toEqual(["stock", "company"]);
    expect(row.company).toBe(company);
  }
  // A stock written up before the Writer wrote company lines has none, and no empty key.
  expect(Object.keys(rowForModel(saved(), { named: false, size: "short" }) as Row)).not.toContain("company");
});
