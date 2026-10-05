/**
 * The condition shape against every trigger stored in production.
 *
 * The fixture is every distinct (predicate, action) on 2026-10-04: 487 of
 * them, behind 909 stored triggers (thesis triggers live and retired, analyst
 * rules, account rules). Regenerate it with:
 *
 *   select trig->'predicate', trig->>'action', count(*) from (
 *     select x as trig from "Thesis", jsonb_array_elements(triggers) x
 *     union all select x from "AgentConfig", jsonb_array_elements(triggers) x
 *     union all select x from "Account", jsonb_array_elements(triggers) x
 *   ) t group by 1, 2;
 *
 * What it proves (docs/plans/TRIGGER_TYPES.md §9):
 *   - every stored kind translates, and only the deleted REVIEW_DATE_HIT is retired;
 *   - every one comes back as the same kind it was (round trip);
 *   - the cascade slots are the same classes as today's triggerBucket;
 *   - every one reads as a sentence and a pill.
 *
 * And that the catalog is the pattern: one entry per measure, and no code
 * outside an entry branches on a measure.
 */

import fs from "fs";
import path from "path";
import stored from "./__fixtures__/stored-triggers.json";
import { triggerBucket } from "../bucket";
import type { TriggerAction, TriggerPredicate } from "../types";
import {
  MEASURES,
  TRIGGER_TYPES,
  conditionProblem,
  conditionsOf,
  fromLegacy,
  isRetired,
  pillParts,
  toLegacy,
  triggerSentence,
  triggerSlot,
  variableOptions,
  withVariable,
  type Condition,
  type When,
} from ".";

type Row = { action: TriggerAction; predicate: TriggerPredicate; scopes: string[]; count: number };
const rows = (stored as { rows: Row[] }).rows;

/**
 * Spellings today's checker reads the same way, so a round trip may write
 * either. Each one is in the stored book:
 *   - an explicit default (`from: "LAST_REVIEW"`, `basis: "intraday"`, `side: "AFTER"` on an event count);
 *   - a field the kind ignores (`side` on a last-review cadence: one retired row);
 *   - a minimum surprise of 0 or below, which the checker ignores (two retired rows carry -3 and -5).
 */
function normalise(p: unknown): unknown {
  if (Array.isArray(p)) return p.map(normalise);
  if (!p || typeof p !== "object") return p;
  const q = p as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    if (k === "from" && v === "LAST_REVIEW") continue;
    if (k === "basis" && v === "intraday") continue;
    if (k === "minSurprisePct" && typeof v === "number" && v <= 0) continue;
    if (k === "side" && q.kind === "REVIEW_CADENCE" && (q.from !== "EVENT" || v === "AFTER")) continue;
    out[k] = normalise(v);
  }
  return out;
}

describe("every stored trigger", () => {
  it("covers the book: 487 distinct conditions behind 909 triggers", () => {
    expect(rows.length).toBe(487);
    expect(rows.reduce((a, r) => a + r.count, 0)).toBe(909);
  });

  it("translates, and only the kind deleted in August is retired", () => {
    const retired = rows.filter((r) => isRetired(fromLegacy(r.predicate)));
    expect([...new Set(retired.map((r) => r.predicate.kind))]).toEqual(["REVIEW_DATE_HIT"]);
    expect(retired.every((r) => r.scopes.every((s) => s === "retired"))).toBe(true);
  });

  it("comes back as the same kind it was", () => {
    const mismatches = rows
      .filter((r) => !isRetired(fromLegacy(r.predicate)))
      .map((r) => ({ was: normalise(r.predicate), back: normalise(toLegacy(fromLegacy(r.predicate) as When)) }))
      .filter((m) => JSON.stringify(sortKeys(m.was)) !== JSON.stringify(sortKeys(m.back)));
    expect(mismatches).toEqual([]);
  });

  it("keeps today's cascade: two triggers share a slot exactly when they share a bucket", () => {
    const live = rows.filter((r) => !isRetired(fromLegacy(r.predicate)));
    const bucketToSlots = new Map<string, Set<string>>();
    const slotToBuckets = new Map<string, Set<string>>();
    for (const r of live) {
      const bucket = triggerBucket({ predicate: r.predicate, action: r.action });
      const slot = triggerSlot(fromLegacy(r.predicate) as When, r.action);
      (bucketToSlots.get(bucket) ?? bucketToSlots.set(bucket, new Set()).get(bucket)!).add(slot);
      (slotToBuckets.get(slot) ?? slotToBuckets.set(slot, new Set()).get(slot)!).add(bucket);
    }
    const split = [...bucketToSlots].filter(([, s]) => s.size > 1).map(([b, s]) => ({ bucket: b, slots: [...s] }));
    const merged = [...slotToBuckets].filter(([, b]) => b.size > 1).map(([s, b]) => ({ slot: s, buckets: [...b] }));
    expect({ split, merged }).toEqual({ split: [], merged: [] });
  });

  it("reads as a sentence and a pill, with no blanks", () => {
    for (const r of rows) {
      const w = fromLegacy(r.predicate);
      if (isRetired(w)) continue;
      const sentence = triggerSentence(r.action, w, r.scopes.includes("live") ? undefined : true);
      expect(sentence).not.toMatch(/undefined|NaN|null/);
      expect(sentence).toMatch(/^[A-Z].+\.$/);
      for (const part of pillParts(w).parts) {
        expect(part.label).not.toMatch(/undefined|NaN/);
        expect(`${part.value ?? ""}${part.chip ?? ""}`).not.toMatch(/undefined|NaN/);
      }
    }
  });
});

describe("the sentences people read", () => {
  const say = (action: TriggerAction, p: TriggerPredicate) => triggerSentence(action, fromLegacy(p) as When);
  it.each([
    ["EXIT", { kind: "PRICE_BELOW", level: 248 }, "Sell when the price falls below $248."],
    ["EXIT", { kind: "TRAILING_FROM_HIGH", pct: 25 }, "Sell when the price is down 25% from the high since we bought."],
    ["REVIEW", { kind: "VS_SMA", period: 200, direction: "BELOW" }, "Review when the price falls below the 200-day average."],
    ["ADD", { kind: "PRICE_MOVE_PCT", pct: 7, direction: "DOWN", window: "1D" }, "Add when the price is down 7% today."],
    ["ENTER", { kind: "NEAR_SMA", period: 50, withinPct: 2 }, "Buy when the price is within 2% of the 50-day average."],
    ["REVIEW", { kind: "GAIN_FROM_ENTRY", pct: 15, direction: "UP" }, "Review when the price is up 15% from our entry."],
    ["ENTER", { kind: "PRICE_ABOVE", level: 183, basis: "close" }, "Buy when the price closes above $183."],
    ["REVIEW", { kind: "REVIEW_CADENCE", days: 30 }, "Review every 30 days."],
    ["EXIT", { kind: "REVIEW_CADENCE", days: 60, from: "BUY" }, "Sell 60 days after the buy."],
    ["REVIEW", { kind: "EARNINGS_WITHIN", days: 5 }, "Review when earnings are 5 days away or less."],
    ["REVIEW", { kind: "EARNINGS_BEAT" }, "Review when earnings beat the estimate."],
    ["REVIEW", { kind: "SEC_EVENT", tier: "MATERIAL" }, "Review when the company files something material with the SEC."],
    ["REVIEW", { kind: "RS_VS_SPY", window: "6M", min: 0 }, "Review when it is beating the S&P over 6 months."],
  ] as [TriggerAction, TriggerPredicate, string][])("%s %j", (action, p, expected) => {
    expect(say(action, p)).toBe(expected);
  });

  it("names the plan coming down on a stock we don't own", () => {
    expect(triggerSentence("EXIT", fromLegacy({ kind: "PRICE_BELOW", level: 225 }) as When, false)).toBe(
      "Take the plan down when the price falls below $225.",
    );
  });

  it("folds a rule naming two filing events back into one kind", () => {
    const p: TriggerPredicate = { kind: "SEC_EVENT", items: ["8.01", "7.01"] };
    const w = fromLegacy(p) as When;
    expect(conditionsOf(w)).toHaveLength(2);
    expect(toLegacy(w)).toEqual(p);
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
      it(`${type.label} · ${m.label}: a filled-in condition saves as today's kind`, () => {
        const c: Condition = { ...m.fresh(), ...(m.value.none ? {} : { value: SAMPLE[m.id] }) };
        const level = m.id === "price" ? "THESIS" : "ACCOUNT";
        expect(conditionProblem(c, { level, held: true })).toBeNull();
        expect(toLegacy(c)).not.toBeNull();
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
    const trail = fromLegacy({ kind: "TRAILING_FROM_HIGH", pct: 25, armAtGainPct: 20 }) as Condition;
    expect(trail.settings).toEqual({ startOnceUpPct: 20 });
    expect(triggerSentence("EXIT", trail)).toBe("Sell when the price is down 25% from the high since we bought, once it has been up 20%.");
    expect(withVariable(trail, "prev_close").settings).toBeUndefined();
  });
});

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
}
