/**
 * The read says each level once. The plan is the triggers: a buy, a floor
 * and an upside rule are trigger sentences on the row, so the row carries no
 * separate `plan` line, no `protection` line, and the quiet one-line row
 * names no target or floor. Fixtures: V's and MU's real held rows as
 * get_theses read them on 2026-11-04 (activity text and history left out).
 */
import v from "@/lib/agent/__fixtures__/row-v-2026-11-04.json";
import mu from "@/lib/agent/__fixtures__/row-mu-2026-11-04.json";
import { rowForModel } from "@/lib/agent/row-for-model";

type Row = Record<string, unknown>;
const rows: Array<[string, Row]> = [["V", v as Row], ["MU", mu as Row]];

describe("the read says each level once (V and MU, 2026-11-04)", () => {
  it.each(rows)("%s: the short row has no plan line and no protection line", (_t, row) => {
    const short = rowForModel(row, { named: false, size: "short" }) as Row;
    expect(short).not.toHaveProperty("plan");
    expect(short).not.toHaveProperty("protection");
  });

  it("V: the levels are the trigger sentences, with their ids", () => {
    const short = rowForModel(v as Row, { named: false, size: "short" }) as Row;
    const triggers = short.triggers as string[];
    expect(triggers.some((t) => t.startsWith("Sell if below $401.91"))).toBe(true);
    expect(triggers.some((t) => t.startsWith("Review if above $434"))).toBe(true);
  });

  it("MU: the floor that fired is its trigger sentence, said once", () => {
    const short = rowForModel(mu as Row, { named: false, size: "short" }) as Row;
    const text = JSON.stringify(short);
    expect((short.triggers as string[]).some((t) => t.startsWith("Sell if below $930.60 · fired"))).toBe(true);
    // The number appears in the trigger sentence and nowhere else on the row.
    expect(text.match(/\$930\.60/g)).toHaveLength(1);
  });

  it.each(rows)("%s: the quiet one-line row keeps the entry and drops the target and the floor", (_t, row) => {
    const line = rowForModel(row, { named: false, size: "line" }) as string;
    expect(line).toMatch(/· entry \$\d/);
    expect(line).not.toMatch(/· target \$/);
    expect(line).not.toMatch(/· floor \$/);
  });

  it("V: the short row's keys, in order, with the two lines gone and nothing else", () => {
    const short = rowForModel(v as Row, { named: false, size: "short" }) as Row;
    expect(Object.keys(short)).toEqual([
      "stock", "id", "situations", "said", "position", "price", "floor_risk", "triggers", "belief", "assumptions",
      "would_prove_it_wrong", "bull_case", "bear_case", "conviction_rationale", "variant_view", "setup", "snapshot",
      "chart", "street", "research", "catalyst",
    ].filter((k) => k in short));
    expect(Object.keys(short)).not.toContain("plan");
    expect(Object.keys(short)).not.toContain("protection");
  });
});
