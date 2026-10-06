/**
 * valid.parity.test.ts — the catalog's own check accepts exactly what the
 * translator's did, before the translator goes.
 *
 * Until now a condition was valid when its old spelling passed the old
 * schema. `whenValid` (each measure's `valid` / `validAny`) says the same
 * thing in the shape. This test runs both over every stored condition and a
 * generated set that walks every measure, direction, variable, number edge
 * and setting, plus groups of one to twenty-five, and they must agree on
 * every one. `fits` must agree with "has an old spelling" the same way,
 * because the form's {x} menu read that.
 *
 * It is deleted with the translator; the commit that adds it is where it
 * passed.
 */

import stored from "./__fixtures__/stored-triggers.json";
import { MEASURES } from "./catalog";
import { fromLegacy, toLegacy } from "./legacy";
import { legacyPredicateSchema } from "./legacy-schema";
import type { Condition, Direction, When } from "./types";
import { isRetired } from "./types";
import { whenValid } from "./valid";

const legacyValid = (w: When): boolean => {
  const spelled = toLegacy(w);
  return spelled != null && legacyPredicateSchema.safeParse(spelled).success;
};

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const IS: (Direction | undefined)[] = [undefined, "below", "above", "near", "before", "after", "miss", "beat"];
const VALUES: (number | undefined)[] = [
  undefined, -1000, -101, -100, -5, -0.5, 0, 0.5, 0.99, 1, 1.5, 2, 3, 4, 5, 9.99, 10, 10.01, 13, 14, 15, 20, 21, 50, 50.5, 90, 91,
  99, 100, 100.5, 200, 200.5, 201, 364, 365, 366, 499, 500, 501, 1000,
];
const VARIABLES: (string | undefined)[] = [
  undefined, "bogus", "prev_close", "close_5d", "close_20d", "entry", "peak", "sma20", "sma50", "sma150", "sma200", "high20", "low20",
  "high52", "low52", "buy", "event", "tier:MATERIAL", "tier:RED", "tier:BLUE", "item:8.01", "item:2.02", "item:8.0", "item:123456",
  "item:", "form:S-3", "form:SCHEDULE 13D", "form:", `form:${"X".repeat(21)}`, `form:${"X".repeat(20)}`, "item",
];
const SETTING_VALUES: unknown[] = [undefined, -1, 0, 0.5, 1, 2, 3, 5, 10, 10.5, 11, 14, 20, 21, 30, 50, 51, 90, 91, 200, 201, 365, 366, 500, 501, "3M", "1M", "6M", "2Y", true, false, "x"];
const SETTING_KEYS = ["close", "fastWinnerPct", "fastWinnerDays", "startOnceUpPct", "widenAtr", "period", "window", "volume", "withinDays", "fromDay", "days", "junk"];
const WATCHES = Object.keys(MEASURES) as Condition["watch"][];

function condition(rand: () => number): Condition {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const c: Condition = { watch: pick(WATCHES) };
  const is = pick(IS);
  if (is) c.is = is;
  const value = pick(VALUES);
  if (value !== undefined) c.value = value;
  const variable = pick(VARIABLES);
  if (variable !== undefined) c.variable = variable as Condition["variable"];
  if (rand() < 0.6) {
    const settings: Record<string, unknown> = {};
    const n = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const v = pick(SETTING_VALUES);
      if (v !== undefined) settings[pick(SETTING_KEYS)] = v;
    }
    c.settings = settings as Condition["settings"];
  }
  return c;
}

function group(rand: () => number, depth = 0): When {
  const n = 1 + Math.floor(rand() * (rand() < 0.15 ? 25 : 9));
  const filingOnly = rand() < 0.3;
  const conditions: When[] = [];
  for (let i = 0; i < n; i++) {
    if (depth < 1 && rand() < 0.1) conditions.push(group(rand, depth + 1));
    else {
      const c = condition(rand);
      if (filingOnly) {
        c.watch = "filing";
        if (rand() < 0.8) c.variable = VARIABLES[16 + Math.floor(rand() * 14)] as Condition["variable"];
      }
      conditions.push(c);
    }
  }
  return { match: rand() < 0.5 ? "all" : "any", conditions };
}

describe("whenValid agrees with the translator's check", () => {
  it("on every stored condition", () => {
    let n = 0;
    for (const r of (stored as { rows: { predicate: unknown }[] }).rows) {
      const w = fromLegacy(r.predicate);
      if (isRetired(w)) continue;
      expect([JSON.stringify(w), whenValid(w)]).toEqual([JSON.stringify(w), legacyValid(w)]);
      n++;
    }
    expect(n).toBeGreaterThan(480);
  });

  it("on every measure × direction × variable × number, no settings", () => {
    let n = 0;
    for (const watch of WATCHES)
      for (const is of IS)
        for (const variable of VARIABLES)
          for (const value of VALUES) {
            const c = { watch, ...(is ? { is } : {}), ...(variable !== undefined ? { variable } : {}), ...(value !== undefined ? { value } : {}) } as Condition;
            if (whenValid(c) !== legacyValid(c)) throw new Error(`disagree: ${JSON.stringify(c)} → ${whenValid(c)} vs ${legacyValid(c)}`);
            if (MEASURES[watch].fits(c) !== (toLegacy(c) != null)) throw new Error(`fits disagrees: ${JSON.stringify(c)}`);
            n++;
          }
    expect(n).toBe(WATCHES.length * IS.length * VARIABLES.length * VALUES.length);
  });

  it("on filing groups of every size, with and without tiers and forms", () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ watch: "filing" as const, variable: `item:${(i + 1).toFixed(2).padStart(4, "0")}` }));
    const forms = (n: number) => Array.from({ length: n }, (_, i) => ({ watch: "filing" as const, variable: `form:F-${i}` }));
    const tier = (t: string) => ({ watch: "filing" as const, variable: `tier:${t}` });
    for (const match of ["any", "all"] as const)
      for (let ni = 0; ni <= 25; ni++)
        for (const nf of [0, 1, 9, 10, 11])
          for (const tiers of [[], ["MATERIAL"], ["MATERIAL", "RED"]]) {
            const conditions = [...items(ni), ...forms(nf), ...tiers.map(tier)] as When[];
            if (conditions.length === 0) continue;
            const w: When = { match, conditions };
            if (whenValid(w) !== legacyValid(w)) throw new Error(`disagree: ${match} ${ni} items, ${nf} forms, tiers ${tiers} → ${whenValid(w)} vs ${legacyValid(w)}`);
          }
  });

  it("on 200,000 generated conditions with settings, and 50,000 groups", () => {
    const rand = prng(20261006);
    for (let i = 0; i < 200_000; i++) {
      const c = condition(rand);
      if (whenValid(c) !== legacyValid(c)) throw new Error(`disagree: ${JSON.stringify(c)} → ${whenValid(c)} vs ${legacyValid(c)}`);
      if (MEASURES[c.watch].fits(c) !== (toLegacy(c) != null)) throw new Error(`fits disagrees: ${JSON.stringify(c)}`);
    }
    let accepted = 0;
    for (let i = 0; i < 50_000; i++) {
      const w = group(rand);
      const ok = whenValid(w);
      if (ok !== legacyValid(w)) throw new Error(`disagree: ${JSON.stringify(w)} → ${ok} vs ${legacyValid(w)}`);
      if (ok) accepted++;
    }
    // The set has to exercise both answers, or agreeing proves nothing.
    expect(accepted).toBeGreaterThan(500);
  });
});
