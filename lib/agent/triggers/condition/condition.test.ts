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
  rowLabel,
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
  // 2026-11-17: the one "or" rule (a filing 8.01 or 7.01) is stored as its two parts.
  it("covers the book: 492 distinct conditions behind 914 triggers", () => {
    expect(rows.length).toBe(492);
    expect(rows.reduce((a, r) => a + r.count, 0)).toBe(914);
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
      for (const part of pillParts(w)) {
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

  it("a watch's line is its own action: Stop watching, whatever the stock's state; a sale is always Sell", () => {
    expect(triggerText("STOP_WATCHING", { watch: "price", is: "below", value: 225, settings: { close: true } })).toBe("Stop watching if below $225 · only on the close");
    expect(triggerText("EXIT", { watch: "price", is: "below", value: 225 })).toBe("Sell if below $225");
  });

  it("a row of trim pills says \"Trim\": the pill's own \"50% if\" finishes the sentence", () => {
    expect(rowLabel("TRIM")).toBe("Trim");
    expect(rowLabel("EXIT")).toBe("Sell if");
    expect(rowLabel("STOP_WATCHING")).toBe("Stop watching if");
  });

  it("a pill leaves off only a % move's usual reference, yesterday's close; the popover and the sentence keep it", () => {
    const day: When = { watch: "move", is: "above", value: 6, variable: "prev_close" };
    expect(pillParts(day, true)).toEqual([{ label: "above", value: "6%" }]);
    expect(pillParts(day)).toEqual([{ label: "above", value: "6% from yesterday's close" }]);
    expect(triggerText("REVIEW", day)).toBe("Review if above 6% from yesterday's close");
    // Every other reference changes what the number means, so the pill says it.
    for (const variable of ["peak", "entry", "sma50"] as const) {
      const w: When = { watch: "move", is: "below", value: 6, variable };
      expect(pillParts(w, true)).toEqual(pillParts(w));
    }
    const date: When = { watch: "from_date", is: "before", value: 10, variable: "event" };
    expect(pillParts(date, true)).toEqual(pillParts(date));
  });

  it("volume, strength and a gap say \"above\" on the form and the pill, like every other; their sentence is unchanged", () => {
    expect(pillParts({ watch: "volume", value: 2 })).toEqual([{ label: "above", value: "2× normal volume" }]);
    expect(pillParts({ watch: "gap", value: 4 })).toEqual([{ label: "above", value: "4% gap up" }]);
    expect(pillParts({ watch: "strength", value: 5 })).toEqual([{ label: "above", value: "5 points ahead of the S&P" }]);
    expect(triggerText("REVIEW", { watch: "volume", value: 2 })).toBe("Review if at least 2× normal volume");
    expect(triggerText("REVIEW", { watch: "gap", value: 4 })).toBe("Review if at least 4% gap up");
    // A head count stays "at least": "above 3 insiders" would read as four.
    expect(pillParts({ watch: "insiders", value: 3 })).toEqual([{ label: "at least", value: "3 insiders buying" }]);
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
      // Two or more choices, or one word: the form draws either as the same select.
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
    // The Street's targets are reached from below only (2026-11-04).
    expect(ids({ watch: "price", is: "above" })).toEqual(["sma20", "sma50", "sma150", "sma200", "high20", "high52", "street_avg", "street_high", "street_low"]);
    expect(ids({ watch: "move", is: "below", value: 5 })).toEqual(["prev_close", "close_5d", "close_20d", "entry", "peak"]);
    expect(ids({ watch: "move", is: "below", value: 5 }, false)).toEqual(["prev_close", "close_5d", "close_20d"]);
    expect(ids({ watch: "from_date", is: "before", value: 5 })).toEqual(["event"]);
  });

  it("a stored trail still carrying a deleted key says only its number", () => {
    const trail: Condition = { watch: "move", is: "below", value: 25, variable: "peak", settings: { startOnceUpPct: 20, widenAtr: 3 } };
    expect(triggerText("EXIT", trail)).toBe("Sell if below 25% from the high since we bought");
    expect(withVariable(trail, "prev_close")).toMatchObject({ variable: "prev_close" });
  });
});
