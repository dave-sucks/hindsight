/**
 * The yardstick's grades on made-up runs: each catches what it is for and
 * passes a run that does it right.
 */
import { beliefProblems, grade, inventedNumbers, pricesSet, salePricesShown, saleLoosened } from "./grade";

const INPUTS = [
  "Current: $78.71 · 20-day $70.79 · 50-day $76.83 · gap-day low $67.72 · last swing low $53.13",
  "EPS $0.83 vs $0.58 est (+42%), revenue $707M, sales up 84% YoY, backlog ~$1.87B",
  '"Sell if below $280 · \\"Under the swing low.\\" [id sale_1]"',
  "      - rev_1: Review every 30 days",
  "      - sale_2: Sell if below $236 — \"the floor\"",
].join("\n");

describe("the yardstick's grades", () => {
  it("a price from the chart passes; a round number it wasn't shown does not", () => {
    const calls = [{ toolName: "submit_thesis", input: { triggers: [{ action: "ENTER", predicate: { watch: "price", is: "below", value: 76.9 } }, { action: "STOP_WATCHING", predicate: { watch: "price", is: "below", value: 60 } }] } }];
    expect(pricesSet(calls)).toEqual([76.9, 60]);
    expect(grade({ calls, narration: "" }, INPUTS, {}).prices).toEqual({ set: 2, offInputs: [60] });
  });

  it("a number it was shown passes, rounded; one from nowhere is listed", () => {
    expect(inventedNumbers("Sales grew 84% and the stock sits near $78.7, about 2.5% over the 50-day at $76.83.", INPUTS)).toEqual([]);
    expect(inventedNumbers("Margins hit 31% and the target is $112.", INPUTS)).toEqual(["31%", "$112"]);
  });

  it("a percent worked out from two prices it was shown is not invented", () => {
    // $78.71 over the 50-day's $76.83 is 2.4%; over the gap-day low's $67.72, 16.2%.
    expect(inventedNumbers("It is 2.4% over the 50-day and 16.2% over the gap-day low.", INPUTS)).toEqual([]);
    expect(inventedNumbers("It is 9.7% over the 50-day.", INPUTS)).toEqual(["9.7%"]);
  });

  it("small counts and years are not numbers to check", () => {
    expect(inventedNumbers("Two to 4 assumptions, checked in 2027, 3 times.", INPUTS)).toEqual([]);
  });

  it("a checkable belief passes; a price in it, a KPI with no point it is read at or a KPI that reads a price does not", () => {
    expect(beliefProblems({
      core_belief: "AAON sells cooling for data centers, and orders are growing faster than it can build.",
      kpis: ["Backlog: on track above $1.5B, broken if it falls two quarters in a row. Read at each report.", "Data-center sales: on track at 100%+ a year, broken by a guidance cut. Read at each quarterly report."],
    })).toEqual([]);
    expect(beliefProblems({
      core_belief: "Worth $120 within 60 days.",
      kpis: ["Demand stays strong."],
    })).toEqual([
      "the belief names a price",
      "the belief names a target or a time to a price",
      "1 KPIs (two to four)",
      'a KPI with no point it is read at: "Demand stays strong."',
    ]);
    expect(beliefProblems({ core_belief: "AAON sells cooling.", kpis: ["Orders grow, read at each report.", "A close below the 50-day average, checked each week."] })).toEqual([
      'a KPI reads a price: "A close below the 50-day average, checked each week."',
    ]);
  });

  it("a business figure is not a price: CORT's revenue and guidance bars pass; a share price fails (2026-11-18)", () => {
    const thesis = (belief: string, kpis: string[]) => ({ core_belief: belief, kpis });
    expect(beliefProblems(thesis("Corcept sells Korlym ($91M a quarter) and is worth more once relacorilant is approved.", [
      "Korlym revenue falls below $200M in a quarter.",
      "Full-year guidance cut below $1.0B at the Q4 report.",
      "EPS below $1.10 at the next report.",
    ]))).toEqual([]);
    expect(beliefProblems(thesis("Worth more at $72.40 than the market thinks.", ["A dilutive raise at a price below $80, read in the next 10-Q.", "The stock closes below its 200-day average, checked at each report."]))).toEqual([
      "the belief names a price",
      'a KPI reads a price: "A dilutive raise at a price below $80, read in the next 10-Q."',
      'a KPI reads a price: "The stock closes below its 200-day average, checked at each report."',
    ]);
  });

  it("the bars it sets in its KPIs are not facts it claims", () => {
    const calls = [{ toolName: "submit_thesis", input: { rationale: "Sales grew 84%.", kpis: ["Revenue: on track above $230M, read at the Q4 report.", "Guidance: broken below $1.3B."] } }];
    expect(grade({ calls, narration: "" }, INPUTS, {}).invented).toEqual([]);
  });

  it("reads the sale prices it was shown, on a row's lines and a thesis's triggers", () => {
    expect([...salePricesShown(INPUTS)]).toEqual([["sale_1", 280], ["sale_2", 236]]);
  });

  it("a lowered or removed sale price is caught; a raised one is not", () => {
    const shown = salePricesShown(INPUTS);
    const calls = [{ toolName: "update_thesis", input: { edit_triggers: [{ id: "sale_1", value: 231 }, { id: "sale_2", value: 240 }], remove_trigger_ids: ["rev_1"] } }];
    expect(saleLoosened(calls, shown)).toEqual(["sale_1: $280 → $231"]);
    expect(saleLoosened([{ toolName: "update_thesis", input: { remove_trigger_ids: ["sale_2"] } }], shown)).toEqual(["sale_2: removed"]);
  });

  it("the playbook is right when the case accepts it, and 'none' stands for no playbook", () => {
    const run = (setup_id?: string) => ({ calls: [{ toolName: "submit_thesis", input: setup_id ? { setup_id } : {} }], narration: "" });
    expect(grade(run("EPISODIC_PIVOT"), INPUTS, { playbooks: ["EPISODIC_PIVOT"] }).playbook).toEqual({ named: "EPISODIC_PIVOT", right: true });
    expect(grade(run("PEAD"), INPUTS, { playbooks: ["EPISODIC_PIVOT"] }).playbook).toEqual({ named: "PEAD", right: false });
    expect(grade(run(), INPUTS, { playbooks: ["none"] }).playbook).toEqual({ named: "none", right: true });
    expect(grade(run(), INPUTS, {}).playbook).toBeNull();
  });
});
