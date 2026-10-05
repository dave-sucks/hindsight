/**
 * The condition shape against every trigger stored in production.
 *
 * The fixture is every distinct (predicate, action) stored on 2026-10-04
 * (487, behind 909 triggers: thesis triggers live and retired, analyst rules,
 * account rules) plus the four first stored on 2026-10-05. To refresh it, add
 * the rows this returns that aren't there yet, and never remove one:
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
 *   - every one reads in the form's words, with no blanks;
 *   - the rules the kinds used to answer (the cascade slot, the default
 *     cooldown, the weekly floor on a state review, which sales propose
 *     directly and the label they close with, what a trigger does on a stock
 *     we don't hold, a watched floor read on the close) give the same answer
 *     from the catalog, for every stored condition under every action. The old
 *     answers are frozen in ./__fixtures__/kind-rules.ts.
 *
 * And that the catalog is the pattern: one entry per measure, and no code
 * outside an entry branches on a measure.
 */

import fs from "fs";
import path from "path";
import stored from "./__fixtures__/stored-triggers.json";
import * as kinds from "./__fixtures__/kind-rules";
import { UNSTORED } from "./__fixtures__/unstored-triggers";
import { triggerBucket } from "../bucket";
import { defaultCooldownDaysForPredicate } from "../defaults";
import { flooredCooldownDays, isStatePredicate } from "../state-cooldown";
import {
  effectiveTriggerAction,
  isDirectEligiblePredicate,
  protectiveExitCloseReason,
  watchedFloorOnClose,
  type TriggerAction,
  type TriggerPredicate,
} from "../types";
import {
  MEASURES,
  TRIGGER_TYPES,
  conditionProblem,
  conditionsOf,
  fromLegacy,
  isRetired,
  pillParts,
  toLegacy,
  triggerText,
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
  it("covers the book: 491 distinct conditions behind 913 triggers", () => {
    expect(rows.length).toBe(491);
    expect(rows.reduce((a, r) => a + r.count, 0)).toBe(913);
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

  it("reads in the form's words, with no blanks", () => {
    for (const r of rows) {
      const w = fromLegacy(r.predicate);
      if (isRetired(w)) continue;
      expect(triggerText(r.action, w)).not.toMatch(/undefined|NaN|null|  /);
      for (const part of pillParts(w).parts) {
        expect(part.label).toMatch(/^[a-z]/);
        expect(part.value ?? "").not.toMatch(/undefined|NaN/);
      }
    }
  });
});

/**
 * The rules the kinds used to answer, from the catalog: each stored condition
 * (and the ones in ./__fixtures__/unstored-triggers.ts the book lacks) under
 * every action, both directions and none, held and watched, with a buy and
 * without, against the kinds' answer frozen in ./__fixtures__/kind-rules.ts.
 * The removed kind is left out: the kinds had no answer for it, it sits only on
 * retired theses, and it never fires.
 */
describe("the rules the kinds answered, from the catalog", () => {
  const ACTIONS: TriggerAction[] = ["ENTER", "ADD", "TRIM", "EXIT", "REVIEW", "MOVE_STOP", "DEMOTE"];
  const DIRECTIONS = ["LONG", "SHORT", null];
  const live = [...rows.map((r) => r.predicate), ...UNSTORED].filter((p) => !isRetired(fromLegacy(p)));
  const grid = live.flatMap((predicate) => ACTIONS.map((action) => ({ predicate, action })));

  /** Where the frozen answer and today's differ: none, or the count and the first few. */
  function disagree<C>(cases: C[], then: (c: C) => unknown, now: (c: C) => unknown) {
    const out = cases.flatMap((c) => {
      const was = JSON.stringify(then(c));
      const is = JSON.stringify(now(c));
      return was === is ? [] : [{ case: c, was, is }];
    });
    return { count: out.length, first: out.slice(0, 5) };
  }
  const agree = { count: 0, first: [] };
  /** How many different answers the frozen rule gives: one answer everywhere would prove nothing. */
  const answers = <C,>(cases: C[], then: (c: C) => unknown) => new Set(cases.map((c) => JSON.stringify(then(c)))).size;

  it("covers every stored condition under every action", () => {
    expect(live.length).toBe(rows.length - 1 + UNSTORED.length);
    expect(grid.length).toBe(live.length * ACTIONS.length);
  });

  it("the cascade: two triggers share a slot exactly when they shared a bucket", () => {
    const slotsOf = new Map<string, Set<string>>();
    const bucketsOf = new Map<string, Set<string>>();
    for (const t of grid) {
      const bucket = kinds.triggerBucket(t);
      const slot = triggerBucket(t);
      (slotsOf.get(bucket) ?? slotsOf.set(bucket, new Set()).get(bucket)!).add(slot);
      (bucketsOf.get(slot) ?? bucketsOf.set(slot, new Set()).get(slot)!).add(bucket);
    }
    const split = [...slotsOf].filter(([, s]) => s.size > 1).map(([bucket, s]) => ({ bucket, slots: [...s] }));
    const merged = [...bucketsOf].filter(([, b]) => b.size > 1).map(([slot, b]) => ({ slot, buckets: [...b] }));
    expect({ split, merged }).toEqual({ split: [], merged: [] });
    expect(slotsOf.size).toBeGreaterThan(100);
  });

  it("the default cooldown", () => {
    const cases = [...grid, ...live.map((predicate) => ({ predicate, action: undefined }))];
    const then = (t: (typeof cases)[number]) => kinds.defaultCooldownDaysForPredicate(t.predicate, t.action);
    expect(disagree(cases, then, (t) => defaultCooldownDaysForPredicate(t.predicate, t.action))).toEqual(agree);
    expect(answers(cases, then)).toBeGreaterThan(5);
  });

  it("the weekly floor on a state review", () => {
    const state = (t: (typeof grid)[number]) => kinds.isStatePredicate(t.predicate);
    expect(disagree(grid, state, (t) => isStatePredicate(t.predicate))).toEqual(agree);
    expect(answers(grid, state)).toBe(2);
    const cases = grid.flatMap((t) => [0, 1, 3, 7, 30].map((days) => ({ ...t, days })));
    expect(disagree(cases, (c) => kinds.flooredCooldownDays(c, c.days), (c) => flooredCooldownDays(c, c.days))).toEqual(agree);
  });

  it("which sales propose directly, and the label they close with", () => {
    const direct = (p: TriggerPredicate) => kinds.isDirectEligiblePredicate(p.kind);
    expect(disagree(live, direct, (p) => isDirectEligiblePredicate(p))).toEqual(agree);
    expect(answers(live, direct)).toBe(2);
    const cases = live.flatMap((predicate) => DIRECTIONS.map((direction) => ({ predicate, direction })));
    const then = (c: (typeof cases)[number]) => kinds.protectiveExitCloseReason(c.predicate, c.direction);
    expect(disagree(cases, then, (c) => protectiveExitCloseReason(c.predicate, c.direction))).toEqual(agree);
    expect(answers(cases, then)).toBe(3);
  });

  it("what a trigger does on a stock we don't hold", () => {
    const cases = grid.flatMap((t) =>
      ["HOLDING", "WATCHING", "PROMOTED", null].flatMap((status) =>
        DIRECTIONS.flatMap((direction) => [true, false, undefined].map((hasBuy) => ({ t, state: { status, direction, hasBuy } }))),
      ),
    );
    const then = (c: (typeof cases)[number]) => kinds.effectiveTriggerAction(c.t, c.state);
    expect(disagree(cases, then, (c) => effectiveTriggerAction(c.t, c.state))).toEqual(agree);
    expect(answers(cases, then)).toBe(ACTIONS.length);
  });

  it("a watched stock's floor reads the close", () => {
    const cases = grid.flatMap((t) => ["HOLDING", "WATCHING", null].map((status) => ({ t, status })));
    /** The same object back, or the predicate it changed to, in the spelling the checker reads. */
    const read = <T extends { predicate: unknown }>(out: T, t: T) => (out === t ? "unchanged" : sortKeys(normalise(out.predicate)));
    const then = (c: (typeof cases)[number]) => read(kinds.watchedFloorOnClose(c.t, { status: c.status }), c.t);
    expect(disagree(cases, then, (c) => read(watchedFloorOnClose(c.t, { status: c.status }), c.t))).toEqual(agree);
    expect(answers(cases, then)).toBeGreaterThan(10);
  });
});

describe("what people read: the form's words, direction · value", () => {
  const say = (action: TriggerAction, p: TriggerPredicate) => triggerText(action, fromLegacy(p) as When);
  it.each([
    ["EXIT", { kind: "PRICE_BELOW", level: 248 }, "Sell if below $248"],
    ["EXIT", { kind: "TRAILING_FROM_HIGH", pct: 25 }, "Sell if below 25% from the high"],
    ["REVIEW", { kind: "VS_SMA", period: 200, direction: "BELOW" }, "Review if below 200-day average"],
    ["ADD", { kind: "PRICE_MOVE_PCT", pct: 7, direction: "DOWN", window: "1D" }, "Add if below 7% from yesterday's close"],
    ["ENTER", { kind: "NEAR_SMA", period: 50, withinPct: 2 }, "Buy if within 2% of 50-day average"],
    ["REVIEW", { kind: "GAIN_FROM_ENTRY", pct: 15, direction: "UP" }, "Review if above 15% from our entry"],
    ["ENTER", { kind: "PRICE_ABOVE", level: 183, basis: "close" }, "Buy if above $183 · only on the close"],
    ["REVIEW", { kind: "REVIEW_CADENCE", days: 30 }, "Review if every 30 days"],
    ["EXIT", { kind: "REVIEW_CADENCE", days: 60, from: "BUY" }, "Sell if after 60 days from the buy"],
    ["REVIEW", { kind: "EARNINGS_WITHIN", days: 5 }, "Review if before earnings 5 days"],
    ["REVIEW", { kind: "EARNINGS_BEAT" }, "Review if earnings beat any amount"],
    ["REVIEW", { kind: "EARNINGS_MISS", minSurprisePct: 3 }, "Review if earnings miss 3% or more"],
    ["REVIEW", { kind: "SEC_EVENT", tier: "MATERIAL" }, "Review if files anything material"],
    ["REVIEW", { kind: "RS_VS_SPY", window: "6M", min: 0 }, "Review if at least 0 points ahead of the S&P · over 6 months"],
    ["REVIEW", { kind: "RSI", threshold: 30, direction: "BELOW" }, "Review if below RSI 30"],
  ] as [TriggerAction, TriggerPredicate, string][])("%s %j", (action, p, expected) => {
    expect(say(action, p)).toBe(expected);
  });

  it("names the plan coming down on a stock we don't own", () => {
    expect(triggerText("EXIT", fromLegacy({ kind: "PRICE_BELOW", level: 225 }) as When, false)).toBe("Take the plan down if below $225");
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
    expect(triggerText("EXIT", trail)).toBe("Sell if below 25% from the high, once it has been up 20%");
    expect(withVariable(trail, "prev_close").settings).toBeUndefined();
  });
});

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
}
