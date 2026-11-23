/**
 * The row is one table (ROW_FIELDS): the same fields whatever the stock's
 * situation and whoever reads it. A field is included always, when the stock
 * has it, or when the read asks for it.
 */
import { ROW_FIELDS, rowForModel } from "@/lib/agent/row-for-model";
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";

type Row = Record<string, unknown>;

// MU on 2026-11-23: held, a sale signal up; its row had 11 fields under the per-situation map and its assumptions were not among them.
const mu = (over: Row = {}): Row => ({
  id: "t_mu", ticker: "MU", status: "HOLDING", direction: "LONG", setupId: "COMPOUNDER_ACCUMULATION", outlook: "NEUTRAL", conviction: "MEDIUM",
  company: "Micron makes memory chips.", coreBelief: "HBM supply stays short.", keyAssumptions: ["HBM margin holds"], invalidationConds: ["A guidance cut"],
  convictionRationale: "The next report decides it.", outlookReason: "Volatile until Dec 17.", variantView: "The Street prices a 2027 peak.",
  bullCase: { bullets: [{ text: "Contracted pricing." }] }, bearCase: { bullets: [{ text: "Cycle rolls over." }] }, snapshot: { text: "A long summary." },
  context: "the Activity list", triggers: [{ id: "f", says: "Sell if below $804" }], history: [{ id: "u1" }],
  position: { quantity: 11, avgCost: 911.42, openedAt: "2026-10-01T14:00:00.000Z", peakPrice: 1100 }, price: { current: 708.2, dayChangePct: 19.1 },
  setup: { id: "COMPOUNDER_ACCUMULATION", name: "Compounder accumulation", lines: ["Fails on a guidance cut."] },
  situations: ["PROTECTIVE_SALE"], ...over,
});

describe("the row", () => {
  it("is the same fields whatever situation the stock is in", () => {
    const keys = (codes: SituationCode[]) => Object.keys(rowForModel(mu({ situations: codes }))).filter((k) => k !== "situations");
    const sale = keys(["PROTECTIVE_SALE"]);
    for (const code of Object.keys(SITUATIONS) as SituationCode[]) expect([code, keys([code])]).toEqual([code, sale]);
    expect(keys([])).toEqual(sale);
    expect(sale).toEqual(expect.arrayContaining(["company", "assumptions", "would_prove_it_wrong", "conviction_rationale", "outlook_reason", "variant_view", "playbook_checks", "position"]));
  });

  it("carries the long research and the raw history only when the read asks for them", () => {
    const row = rowForModel(mu());
    for (const k of ["bull_case", "bear_case", "snapshot", "history"]) expect([k, k in row]).toEqual([k, false]);
    const asked = rowForModel(mu(), { research: true, history: true });
    expect(asked).toMatchObject({ bull_case: ["Contracted pricing."], bear_case: ["Cycle rolls over."], snapshot: "A long summary.", history: [{ id: "u1" }] });
    expect("history" in rowForModel(mu(), { research: true })).toBe(false);
  });

  it("includes a field the stock has and leaves off one it doesn't: the position on a holding, the paper record on a promoted stock", () => {
    const watch = rowForModel(mu({ status: "WATCHING", position: null }));
    expect("position" in watch).toBe(false);
    expect(watch.playbook_checks).toEqual(["Fails on a guidance cut."]);
    expect("paper_record" in watch).toBe(false);
    expect(rowForModel(mu({ status: "PROMOTED", position: null, paperTenureDays: 41, paperRealizedPnl: 812.5, paperReviewCount: 3 })).paper_record).toBe("held 41 days on paper, realized $812.50, 3 reviews");
    // A playbook with no checks to list is its one line.
    const bare = rowForModel(mu({ setup: { id: "COMPOUNDER_ACCUMULATION", name: "Compounder accumulation", failureSigns: ["Guidance cut"] } }));
    expect("playbook_checks" in bare).toBe(false);
    expect(bare.setup).toBe("COMPOUNDER_ACCUMULATION, Compounder accumulation. Failure looks like: Guidance cut.");
  });

  it("every field says what it is and when it is included, once", () => {
    const keys = ROW_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of ROW_FIELDS) expect([f.key, f.what.length > 0 && f.when.length > 0]).toEqual([f.key, true]);
    expect(ROW_FIELDS.filter((f) => f.ask).map((f) => f.key)).toEqual(["bull_case", "bear_case", "snapshot", "history"]);
  });
});
