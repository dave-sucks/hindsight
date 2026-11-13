/**
 * The situation decides the row's fields (the owner's grid, 2026-11-06):
 * nine standing fields on every row, a situation's own fields with it, the
 * whole case on the review clock, the research sections and the history by
 * name only. Each situation's guidance (situations.ts) names the row keys
 * its decision reads in backticks; this file holds the map to those texts,
 * so a key a text reads is never left off the row that carries the text.
 */
import fixture from "@/lib/agent/__fixtures__/short-row-ceg-2026-09-25.json";
import { ROW_FIELDS, REVIEW_SITUATION, rowForModel, rowKeysFor } from "@/lib/agent/row-for-model";
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";

type Row = Record<string, unknown>;
const CODES = Object.keys(SITUATIONS) as SituationCode[];
const saved = (situations: SituationCode[]): Row => ({ ...fixture, situations, company: "Sells power; revenue is contracted.", street: { ticker: "CEG", asOf: "2026-09-25", targetLow: 300, targetAvg: 360, targetHigh: 420, analysts: 20, buy: 14, hold: 6, sell: 0 } }) as Row;
const ALWAYS = Object.keys(ROW_FIELDS).filter((k) => ROW_FIELDS[k] === "always");
const REVIEW = Object.keys(ROW_FIELDS).filter((k) => ROW_FIELDS[k] === "review");
const NAMED = Object.keys(ROW_FIELDS).filter((k) => ROW_FIELDS[k] === "named");

describe("the keys a situation's row sends", () => {
  it("every key a situation's guidance names in backticks is sent with that situation", () => {
    const keys = new Set(Object.keys(ROW_FIELDS));
    for (const code of CODES) {
      const named = [...SITUATIONS[code].guidance.matchAll(/`([A-Za-z_]+)(?:\.[A-Za-z_]+)?`/g)].map((m) => m[1]).filter((k) => keys.has(k));
      const sent = rowKeysFor([code], { size: "short", named: false });
      for (const k of named) expect([code, k, sent.has(k)]).toEqual([code, k, true]);
    }
  });
  // The buy text named the variant view in plain words and the backtick scan
  // missed it (the review of 2026-11-10), so the plain names a text uses for
  // a conditional key are held to the row too.
  const PLAIN_NAMES: ReadonlyArray<[RegExp, string]> = [
    [/variant view|where we differ from the street/i, "variant_view"],
    [/\bassumptions?\b/i, "assumptions"],
    [/prove (?:it|us|the view) wrong/i, "would_prove_it_wrong"],
    [/the street|average target|price target/i, "street"],
    [/chart numbers|the chart's/i, "chart"],
    [/\bbull case\b/i, "bull_case"],
    [/\bbear case\b/i, "bear_case"],
    [/company line/i, "company"],
    [/paper record/i, "paper_record"],
    [/plan checks?\b/i, "plan_checks"],
  ];
  // First research describes what the Writer will write (the belief, the assumptions, what would prove it wrong); a seed has none of them to send.
  const WRITES_NOT_READS = new Set<SituationCode>(["FIRST_RESEARCH"]);
  it("every conditional key a situation's guidance names in plain words is sent with that situation", () => {
    for (const code of CODES) {
      if (WRITES_NOT_READS.has(code)) continue;
      const sent = rowKeysFor([code], { size: "short", named: false });
      for (const [re, k] of PLAIN_NAMES) {
        if (!re.test(SITUATIONS[code].guidance)) continue;
        expect([code, k, sent.has(k)]).toEqual([code, k, true]);
      }
    }
  });
  it("the standing fields go on every row; the whole case only on the review clock; the sections and history only by name", () => {
    for (const code of CODES) {
      const sent = rowKeysFor([code], { size: "short", named: false });
      for (const k of ALWAYS) expect([code, k, sent.has(k)]).toEqual([code, k, true]);
      for (const k of NAMED) expect([code, k, sent.has(k)]).toEqual([code, k, false]);
      for (const k of REVIEW) expect([code, k, sent.has(k)]).toEqual([code, k, code === REVIEW_SITUATION]);
    }
  });
  it("a stock in two situations gets the union; with the review clock, everything but the named-only keys", () => {
    const sale = rowKeysFor(["PROTECTIVE_SALE"], { size: "short", named: false });
    const buy = rowKeysFor(["BUY_ARRIVES"], { size: "short", named: false });
    const both = rowKeysFor(["PROTECTIVE_SALE", "BUY_ARRIVES"], { size: "short", named: false });
    expect([...both].sort()).toEqual([...new Set([...sale, ...buy])].sort());
    const review = rowKeysFor(["PROTECTIVE_SALE", REVIEW_SITUATION], { size: "short", named: false });
    expect([...review].sort()).toEqual(Object.keys(ROW_FIELDS).filter((k) => ROW_FIELDS[k] !== "named").sort());
  });
  it("a buy and an add carry an event-driven thesis's event date (a pre-catalyst buy is never the day before it); a sale signal does not", () => {
    for (const code of ["BUY_ARRIVES", "ADD_OR_WINNER", "EARNINGS"] as SituationCode[]) expect([code, rowKeysFor([code], { size: "short", named: false }).has("catalyst")]).toEqual([code, true]);
    expect(rowKeysFor(["PROTECTIVE_SALE"], { size: "short", named: false }).has("catalyst")).toBe(false);
  });
  it("no situation named: every short key, as the book read sends it; the full row by name adds the sections and the history", () => {
    expect([...rowKeysFor([], { size: "short", named: false })].sort()).toEqual(Object.keys(ROW_FIELDS).filter((k) => ROW_FIELDS[k] !== "named").sort());
    expect([...rowKeysFor([], { size: "full", named: true })].sort()).toEqual(Object.keys(ROW_FIELDS).sort());
    expect(rowKeysFor([], { size: "full", named: false }).has("history")).toBe(false);
  });
});

describe("the row a situation builds (CEG, held)", () => {
  it("a sale signal: the standing fields with the chart, what would prove us wrong and the floor's risk; no Street, no cases", () => {
    const row = rowForModel(saved(["PROTECTIVE_SALE"]), { named: false, size: "short" }) as Row;
    expect(Object.keys(row)).toEqual(["stock", "id", "analyst", "situations", "said", "position", "proposal_waiting", "price", "floor_risk", "triggers", "belief", "would_prove_it_wrong", "heldThroughFloor", "chart", "research", "repeat", "note"].filter((k) => k in row));
    for (const k of ["street", "bull_case", "bear_case", "company", "snapshot", "assumptions", "setup", "catalyst"]) expect([k, k in row]).toEqual([k, false]);
    expect(row.would_prove_it_wrong).toBeDefined();
    expect(row.triggers).toBeDefined();
  });
  it("a buy level reached: the chart numbers, the Street, the setup and the plan checks come with it", () => {
    const row = rowForModel(saved(["BUY_ARRIVES"]), { named: false, size: "short" }) as Row;
    for (const k of ["chart", "street", "setup", "plan_checks"]) expect([k, k in row || k === "plan_checks"]).toEqual([k, true]);
    for (const k of ["bull_case", "would_prove_it_wrong", "company"]) expect([k, k in row]).toEqual([k, false]);
  });
  it("the review clock: the whole case", () => {
    const row = rowForModel(saved([REVIEW_SITUATION]), { named: false, size: "short" }) as Row;
    for (const k of ["company", "bull_case", "bear_case", "conviction_rationale", "variant_view", "snapshot", "chart", "street", "setup", "assumptions", "would_prove_it_wrong"]) expect([k, k in row]).toEqual([k, true]);
    expect(row).not.toHaveProperty("history");
  });
  it("the trigger run's row carries the setup's lines whatever its situation", () => {
    const withLines = { ...saved(["PROTECTIVE_SALE"]), setup: { ...(fixture as Row).setup as Row, lines: ["Entry: the gap day's close.", "Stop: under the gap day's low."] } };
    const row = rowForModel(withLines, { named: true, size: "short", setupLines: true }) as Row;
    expect(row.setup_lines).toHaveLength(2);
    expect(row).not.toHaveProperty("bull_case");
  });
});
