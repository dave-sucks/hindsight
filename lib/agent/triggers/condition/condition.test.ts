/**
 * The condition shape against every condition stored in production.
 *
 * The fixture is every distinct (condition, action) stored on 2026-10-04 and
 * 2026-10-05 (491, behind 913 triggers: thesis triggers live and retired,
 * analyst rules, account rules), in the shape since the cutover. To refresh
 * it, add the rows this returns that aren't there yet, and never remove one:
 *
 *   select trig->'predicate', trig->>'action', count(*) from (
 *     select x as trig from "Thesis", jsonb_array_elements(triggers) x
 *     union all select x from "AgentConfig", jsonb_array_elements(triggers) x
 *     union all select x from "Account", jsonb_array_elements(triggers) x
 *   ) t group by 1, 2;
 *
 * What it proves: every stored condition is in the shape (only a condition
 * removed in August is not), passes the save, and reads in the form's words
 * with no blanks; and the catalog is the pattern: one entry per measure, and
 * no code outside an entry branches on a measure.
 */

import fs from "fs";
import path from "path";
import stored from "./__fixtures__/stored-triggers.json";
import type { TriggerAction } from "../types";
import {
  MEASURES,
  TRIGGER_TYPES,
  conditionProblem,
  pillParts,
  shapeOf,
  triggerText,
  variableOptions,
  whenValid,
  withVariable,
  type Condition,
  type When,
} from ".";

type Row = { action: TriggerAction; predicate: unknown; scopes: string[]; count: number };
const rows = (stored as unknown as { rows: Row[] }).rows;

describe("every stored condition", () => {
  it("covers the book: 491 distinct conditions behind 913 triggers", () => {
    expect(rows.length).toBe(491);
    expect(rows.reduce((a, r) => a + r.count, 0)).toBe(913);
  });

  it("is in the shape, except the one condition removed in August, on retired theses only", () => {
    const removed = rows.filter((r) => shapeOf(r.predicate) == null);
    expect(removed).toHaveLength(1);
    expect(removed.every((r) => r.scopes.every((s) => s === "retired"))).toBe(true);
  });

  it("passes the save", () => {
    const refused = rows.filter((r) => shapeOf(r.predicate) != null && !whenValid(r.predicate)).map((r) => r.predicate);
    expect(refused).toEqual([]);
  });

  it("reads in the form's words, with no blanks", () => {
    for (const r of rows) {
      const w = shapeOf(r.predicate);
      if (!w) continue;
      expect(triggerText(r.action, w)).not.toMatch(/undefined|NaN|null|  /);
      for (const part of pillParts(w).parts) {
        expect(part.label).toMatch(/^[a-z]/);
        expect(part.value ?? "").not.toMatch(/undefined|NaN/);
      }
    }
  });
});

describe("what people read: the form's words, direction · value", () => {
  it.each([
    ["EXIT", { watch: "price", is: "below", value: 248 }, "Sell if below $248"],
    ["EXIT", { watch: "move", is: "below", value: 25, variable: "peak" }, "Sell if below 25% from the high since we bought"],
    ["REVIEW", { watch: "price", is: "below", variable: "sma200" }, "Review if below the 200-day average"],
    ["ADD", { watch: "move", is: "below", value: 7, variable: "prev_close" }, "Add if below 7% from yesterday's close"],
    ["ENTER", { watch: "move", is: "near", value: 2, variable: "sma50" }, "Buy if within 2% of the 50-day average"],
    ["REVIEW", { watch: "move", is: "above", value: 15, variable: "entry" }, "Review if above 15% from our entry"],
    ["ENTER", { watch: "price", is: "above", value: 183, settings: { close: true } }, "Buy if above $183 · only on the close"],
    ["REVIEW", { watch: "repeat", value: 30 }, "Review every 30 days"],
    ["EXIT", { watch: "from_date", is: "after", value: 60, variable: "buy" }, "Sell 60 days after the buy"],
    ["REVIEW", { watch: "report", is: "before", value: 5 }, "Review if within 5 days before earnings"],
    ["REVIEW", { watch: "surprise", is: "beat", value: 0 }, "Review if earnings beat any amount"],
    ["REVIEW", { watch: "surprise", is: "miss", value: 3 }, "Review if earnings miss 3% or more"],
    ["REVIEW", { watch: "filing", variable: "tier:MATERIAL" }, "Review if it files something material with the SEC"],
    ["REVIEW", { watch: "strength", value: 0, settings: { window: "6M" } }, "Review if at least 0 points ahead of the S&P · over 6 months"],
    ["REVIEW", { watch: "rsi", is: "below", value: 30 }, "Review if below RSI 30"],
  ] as [TriggerAction, When, string][])("%s %j", (action, w, expected) => {
    expect(triggerText(action, w)).toBe(expected);
  });

  it("names the plan coming down on a stock we don't own", () => {
    expect(triggerText("EXIT", { watch: "price", is: "below", value: 225 }, false)).toBe("Take the plan down if below $225");
  });
});

describe("the catalog", () => {
  /** A sample number for each measure, the way a person would fill it in. */
  const SAMPLE: Record<string, number> = { price: 248, move: 7, volume: 1.5, rsi: 30, strength: 0, gap: 4, report: 3, surprise: 0, insiders: 3, repeat: 30, from_date: 60 };

  it("has one entry per measure, each in one type of the Add trigger menu", () => {
    const listed = TRIGGER_TYPES.flatMap((t) => t.measures.map((m) => m.id));
    expect([...listed].sort()).toEqual(Object.keys(MEASURES).sort());
    for (const [id, m] of Object.entries(MEASURES)) {
      expect(m.id).toBe(id);
      expect(m.fresh().watch).toBe(id);
      // Two choices draw as buttons; one is a word in the input, never a lone button.
      expect(m.buttons ? m.buttons.length > 1 && !m.word : !!m.word).toBe(true);
    }
  });

  for (const type of TRIGGER_TYPES) {
    for (const m of type.measures) {
      it(`${type.label} · ${m.label}: a filled-in condition saves`, () => {
        const c: Condition = { ...m.fresh(), ...(m.value.none ? {} : { value: SAMPLE[m.id] }) };
        const level = m.id === "price" ? "THESIS" : "ACCOUNT";
        expect(conditionProblem(c, { level, held: true })).toBeNull();
        expect(whenValid(c)).toBe(true);
      });
    }
  }

  it("has no switch, and nothing outside a measure's entry names a measure", () => {
    const dir = __dirname;
    const files = [
      ...fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")),
      ...fs.readdirSync(path.join(dir, "measures")).map((f) => path.join("measures", f)),
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect({ f, switches: src.match(/switch \(/g)?.length ?? 0 }).toEqual({ f, switches: 0 });
      if (!f.startsWith("measures")) expect({ f, named: src.match(/\.watch === "/g)?.length ?? 0 }).toEqual({ f, named: 0 });
    }
  });

  it("says what to fix instead of changing the form", () => {
    expect(conditionProblem({ watch: "move", is: "below", value: 7 }, { level: "THESIS", held: true })).toBe(
      "Choose what the % is measured from.",
    );
    expect(conditionProblem({ watch: "price", is: "below", value: 248 }, { level: "ANALYST", held: true })).toMatch(
      /typed price can't apply to every stock/,
    );
    expect(conditionProblem({ watch: "move", is: "below", value: 25, variable: "peak" }, { level: "THESIS", held: false })).toMatch(
      /only once we own the stock/,
    );
    expect(conditionProblem({ watch: "from_date", is: "before", value: 10, variable: "buy" }, { level: "THESIS", held: true })).toBe(
      "The buy is already in the past. Pick After.",
    );
    expect(conditionProblem({ watch: "price", is: "below", variable: "high52" }, { level: "THESIS", held: true })).toMatch(
      /52-week high doesn't work with Below/,
    );
  });

  it("offers only the variables that save with the button", () => {
    const ids = (c: Condition, held = true) => variableOptions(c, { level: "THESIS", held }).map((o) => o.id);
    expect(ids({ watch: "price", is: "below" })).toEqual(["sma20", "sma50", "sma150", "sma200"]);
    expect(ids({ watch: "price", is: "above" })).toEqual(["sma20", "sma50", "sma150", "sma200", "high20", "high52"]);
    expect(ids({ watch: "move", is: "below", value: 5 })).toEqual(["prev_close", "close_5d", "close_20d", "entry", "peak"]);
    expect(ids({ watch: "move", is: "below", value: 5 }, false)).toEqual(["prev_close", "close_5d", "close_20d"]);
    expect(ids({ watch: "from_date", is: "before", value: 5 })).toEqual(["event"]);
  });

  it("keeps a variable's own settings with it, and drops them when it goes", () => {
    const trail: Condition = { watch: "move", is: "below", value: 25, variable: "peak", settings: { startOnceUpPct: 20 } };
    expect(triggerText("EXIT", trail)).toBe("Sell if below 25% from the high since we bought, once it has been up 20%");
    expect(withVariable(trail, "prev_close").settings).toBeUndefined();
  });
});
