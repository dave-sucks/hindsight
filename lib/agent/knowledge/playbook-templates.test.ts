/**
 * The playbook seed is the spec's tables (docs/plans/PLAYBOOK_TRIGGERS.md):
 * every template, read as the trigger sentence the pill and the agents read,
 * is a row of its playbook's table, and every row is a template. A "Kept"
 * holding row is the watch's line staying through the fill; a kept clock is
 * also a fill template, so a holding gets its playbook's clock.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { readFileSync } from "fs";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { PLAYBOOK_TEMPLATES, type Template, type WrittenOn } from "./playbook-templates";
import { fillTemplateOps, fillValue, playbookGap, playbookTemplates, templateSchema, withTheBuyTriggers } from "./playbooks";
import { PLACEHOLDERS, SETUPS, templatePlaceholders, type Placeholder } from "./setups";
import type { PriceStructure } from "@/lib/market-data/price-structure";
import type { Trigger } from "@/lib/agent/triggers/types";

const SPEC = readFileSync("docs/plans/PLAYBOOK_TRIGGERS.md", "utf8");

/** The letters each table names its chart levels by. */
const LETTERS: Record<string, Record<string, string>> = {
  PRE_CATALYST: { "{pivot}": "$P", "{pivotChase}": "$C", "{high20}": "$H", "{swingLow}": "$L", "{sellPrice}": "$S", "{priorHigh}": "$H" },
  BASE_BREAKOUT: { "{pivot}": "$P", "{pivotChase}": "$C", "{baseLow}": "$L", "{sellPrice}": "$S", "{priorHighOrTwiceRisk}": "$H", "{riskPct}": "N%" },
  MA_PULLBACK: { "{sellPrice}": "$S", "{priorHigh}": "$H" },
  PEAD: { "{gapDayMid}": "$M", "{gapDayLow}": "$L", "{sellPrice}": "$S", "{priorHighOrTwiceRisk}": "$H" },
  EPISODIC_PIVOT: { "{gapDayHigh}": "$H", "{gapDayMid}": "$M", "{gapDayLow}": "$L", "{sellPrice}": "$L" },
  COMPOUNDER_ACCUMULATION: { "{pivot}": "$P", "{sellPrice}": "$S" },
};

/** The spec's English and the app's sentence, said one way: its notes and commas off, sessions as the calendar days stored. */
const said = (s: string) =>
  s
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/, only if .*$/, "")
    .replace(/ · only on the close/g, " on the close")
    .replace(/(\d+) sessions/g, (_, n) => `${(Number(n) * 7) / 5} days`)
    .replace(/, (and|or) /g, " $1 ")
    .replace(/, /g, " and ");

function rendered(id: string, t: Template): string {
  let text = sentenceOf(t as unknown as Trigger);
  for (const [mark, letter] of Object.entries(LETTERS[id])) text = text.replaceAll(mark, letter);
  return said(text);
}

/** The spec's rows for one playbook, as [written on, sentence]. */
function specRows(id: string): Array<[WrittenOn, string]> {
  const section = SPEC.split("\n### ").find((s) => s.includes(`(\`${id}\`)`))!;
  const rows = (header: string) =>
    section
      .split(`| ${header} |`)[1]
      .split("\n\n")[0]
      .split("\n")
      .filter((l) => l.startsWith("| ") && !l.startsWith("|---"))
      .map((l) => l.split("|").map((c) => c.trim()).filter(Boolean));
  const watch = rows("On a watch").filter(([text]) => !text.startsWith("None")).map(([text]) => ["WATCH", said(text)] as [WrittenOn, string]);
  const holding = rows("On a holding").flatMap(([text, how, from]): Array<[WrittenOn, string]> => {
    const at = from ?? how;
    if (at === "Proposal") return [["PROPOSAL", said(text)]];
    if (at === "Template") return [["FILL", said(text)]];
    // Kept: the watch triggers come off at the fill, so a clock is written again at the fill and any other kept trigger comes with the buy.
    return text.startsWith("Review every") ? [["FILL", said(text)]] : [["PROPOSAL", said(text)]];
  });
  return [...watch, ...holding];
}

const USED = Object.keys(LETTERS);

describe("the seed is the spec's tables, row for row", () => {
  for (const id of USED) {
    it(`${id}: every template reads as a row of its table, and every row is a template`, () => {
      const mine = PLAYBOOK_TEMPLATES[id as keyof typeof PLAYBOOK_TEMPLATES].map((t) => [t.writtenOn, rendered(id, t)]);
      expect(mine.sort()).toEqual(specRows(id).sort());
    });
  }

  it("a Kept trigger that isn't a clock is on the watch and comes again with the buy (the fill takes the watch triggers off)", () => {
    const ep = PLAYBOOK_TEMPLATES.EPISODIC_PIVOT;
    expect(ep.filter((t) => t.writtenOn === "WATCH").map((t) => rendered("EPISODIC_PIVOT", t))).toContain("Review if below $M on the close");
    expect(ep.filter((t) => t.writtenOn === "PROPOSAL").map((t) => rendered("EPISODIC_PIVOT", t))).toContain("Review if below $M on the close");
  });

  it("reads the way the pill does: a chart level by its name", () => {
    expect(PLAYBOOK_TEMPLATES.BASE_BREAKOUT.map((t) => sentenceOf(t as unknown as Trigger))).toEqual([
      "Buy if above {pivot} · only on the close and at least 1.5× normal volume and below {pivotChase}",
      "Review every 7 days",
      "Review every 7 days",
      "Stop watching if below {baseLow} · only on the close",
      "Sell if below {sellPrice}",
      "Trim 50% if above {priorHighOrTwiceRisk}",
      "Review 28 days after the buy",
      "Review if above {riskPct} from our entry",
    ]);
  });
});

describe("the template shape", () => {
  it("every seeded template, all twelve playbooks, passes the one schema", () => {
    for (const s of SETUPS) for (const t of s.triggers) expect({ id: s.id, ok: templateSchema.safeParse(t).success }).toEqual({ id: s.id, ok: true });
    expect(SETUPS.filter((s) => s.triggers.length === 0).map((s) => s.id)).toEqual(["ESTIMATE_REVISION", "SECTOR_ROTATION"]);
  });

  it("refuses a fill template that names a chart level: the run fills that with the buy proposal", () => {
    const r = templateSchema.safeParse({ action: "EXIT", predicate: { watch: "price", is: "below", value: "{swingLow}" }, rationale: "x", writtenOn: "FILL" });
    expect(r.success ? null : r.error.issues[0].message).toMatch(/A fill template is written as listed/);
  });

  it("refuses a name that isn't a chart level, a sale on a watch, and a number out of range", () => {
    const refusal = (t: object) => {
      const r = templateSchema.safeParse({ rationale: "x", ...t });
      return r.success ? null : r.error.issues[0].message;
    };
    expect(refusal({ action: "ENTER", predicate: { watch: "price", is: "above", value: "{moon}" }, writtenOn: "WATCH" })).toMatch(/isn't a chart level/);
    expect(refusal({ action: "EXIT", predicate: { watch: "price", is: "below", value: "{swingLow}" }, writtenOn: "WATCH" })).toMatch(/Stop watching/);
    expect(refusal({ action: "REVIEW", predicate: { watch: "volume", value: 99 }, writtenOn: "FILL" })).toMatch(/Volume/);
  });
});

describe("an account's playbooks", () => {
  it("unseeded is the catalog; seeded is the account's own list, an empty one included", () => {
    expect(playbookTemplates(null, "PEAD")).toBe(PLAYBOOK_TEMPLATES.PEAD);
    expect(playbookTemplates({ playbooks: {}, playbooksSeededAt: null }, "PEAD")).toBe(PLAYBOOK_TEMPLATES.PEAD);
    expect(playbookTemplates({ playbooks: {}, playbooksSeededAt: new Date() }, "PEAD")).toEqual([]);
    const mine = [{ action: "REVIEW", predicate: { watch: "repeat", value: 14 }, rationale: "Every two weeks.", writtenOn: "FILL" }];
    expect(playbookTemplates({ playbooks: { PEAD: [...mine, { action: "REVIEW", predicate: { kind: "OLD" }, rationale: "x", writtenOn: "FILL" }] }, playbooksSeededAt: new Date() }, "PEAD")).toEqual(mine);
  });

  it("the fill writes its fill templates; one whose kind the stock has is kept out and named", () => {
    let n = 0;
    const has: Trigger = { id: "clock", predicate: { watch: "repeat", value: 14 }, action: "REVIEW", rationale: "Every two weeks." };
    const { ops, notWritten: kept } = fillTemplateOps(PLAYBOOK_TEMPLATES.COMPOUNDER_ACCUMULATION, [has], () => `t${++n}`);
    expect(ops.map((o) => (o.op === "add" ? sentenceOf(o.trigger) : o.op))).toEqual(["Review 60 days after the buy", "Add if above 7% from our entry"]);
    expect(kept).toEqual([{ op: "kept", id: "clock", text: "Kept Review every 14 days; the playbook's Review every 30 days not written" }]);
  });
});

/**
 * What code writes at the fill comes from a template's own fields, never from
 * its reason's prose: a fallback is a placeholder, a judgment is `judged`.
 */
describe("the triggers that come with the buy, written at the fill", () => {
  /** A chart with every number a placeholder reads. */
  const FULL: PriceStructure = {
    price: 100, base: { pivot: 105, low: 90 }, range: { high20: 106, low20: 92, high52w: 120, low52w: 70 },
    swings: { lastHigh: { price: 112, date: "2026-11-01" }, lastLow: { price: 93, date: "2026-11-06" } },
    gaps: [{ date: "2026-11-03", direction: "UP", pct: 6, volumeRatio: 2, low: 95, mid: 97, high: 99 }],
  } as unknown as PriceStructure;
  const isTheSale = (t: Template) => t.action === "EXIT" && templatePlaceholders(t.predicate).includes("{sellPrice}");
  const written = SETUPS.flatMap((s) => s.triggers.filter((t) => t.writtenOn === "PROPOSAL" && !isTheSale(t) && !t.judged).map((t) => [s.id, t] as const));

  it("every placeholder a template may name resolves from PLACEHOLDERS alone", () => {
    for (const name of Object.keys(PLACEHOLDERS) as Placeholder[]) expect([name, typeof fillValue(name, { chart: FULL, buy: 100, sale: 95, gap: FULL.gaps[0] })]).toEqual([name, "number"]);
    for (const [id, t] of written) for (const m of templatePlaceholders(t.predicate)) expect([id, m, Object.hasOwn(PLACEHOLDERS, m)]).toEqual([id, m, true]);
  });

  it("no fallback or condition lives only in a reason: an 'else' is a placeholder that carries it, an 'only if' is judged", () => {
    for (const [id, t] of written) {
      if (/\belse\b/.test(t.rationale)) expect([id, templatePlaceholders(t.predicate)]).toEqual([id, ["{priorHighOrTwiceRisk}"]]);
      expect([id, /only if/i.test(t.rationale)]).toEqual([id, false]);
    }
    expect(PLAYBOOK_TEMPLATES.PRE_CATALYST.find((t) => t.action === "TRIM")).toMatchObject({ judged: true, rationale: "The prior high. Only if the analyst believes it." });
  });

  it("each placeholder's definition is complete: no buffer, alternative or range left to the reader", () => {
    for (const [name, says] of Object.entries(PLACEHOLDERS)) {
      expect([name, /\badd\b|\(or |\d–\d|day 2|\bentry\)/.test(says)]).toEqual([name, false]);
    }
    // What the chart can't hold is no number: a swing low at or above the price, a gap no playbook screen meets.
    const above = { ...FULL, swings: { ...FULL.swings, lastLow: { price: 101, date: "2026-11-06" } } } as PriceStructure;
    expect(fillValue("{swingLow}", { chart: above, buy: 100, sale: 95 })).toBeUndefined();
    expect(fillValue("{pivot}", { chart: FULL, buy: 100, sale: 95 })).toBe(105.21);
  });

  it("the playbook's gap: EPISODIC_PIVOT's meets its own screen (at least 8% on at least 3× volume), PEAD's is the newest up gap", () => {
    const gaps = { ...FULL, gaps: [
      { date: "2026-11-13", direction: "UP", pct: 6.45, volumeRatio: 0.93, low: 78.64, mid: 82.31, high: 85.99 },
      { date: "2026-11-10", direction: "UP", pct: 13.9, volumeRatio: 3.7, low: 67.72, mid: 73.96, high: 80.19 },
    ] } as PriceStructure;
    expect(playbookGap(PLAYBOOK_TEMPLATES.EPISODIC_PIVOT, gaps)?.date).toBe("2026-11-10");
    expect(playbookGap(PLAYBOOK_TEMPLATES.PEAD, gaps)?.date).toBe("2026-11-13");
    expect(playbookGap(PLAYBOOK_TEMPLATES.PEAD, { ...gaps, gaps: [{ ...gaps.gaps[0], direction: "DOWN", pct: -6 }] } as PriceStructure)).toBeNull();
  });

  it("no reason the code writes describes a choice code doesn't make: an alternative is the run's a review wakes", () => {
    const codeWritten = SETUPS.flatMap((s) => s.triggers.filter((t) => (t.writtenOn === "WATCH" || (t.writtenOn === "PROPOSAL" && !isTheSale(t))) && !t.judged && t.action !== "REVIEW").map((t) => [s.id, t.rationale] as const));
    for (const [id, why] of codeWritten) expect([id, why, / or /.test(why)]).toEqual([id, why, false]);
  });

  // AAPL 2026-11-13: buy $359.36, sale $325.33, the chart's last swing high $351.73 (under the buy).
  const AAPL = { chart: { ...FULL, swings: { lastHigh: { price: 351.73, date: "2026-10-23" }, lastLow: { price: 325.33, date: "2026-11-03" } } } as PriceStructure, buy: 359.36, sale: 325.33 };
  const ids = () => "t";

  it("BASE_BREAKOUT with no prior high above the buy: the Trim at twice the risk above it, $427.42 on AAPL", () => {
    const { triggers, notWritten } = withTheBuyTriggers(PLAYBOOK_TEMPLATES.BASE_BREAKOUT, AAPL, ids);
    expect(triggers.map((t) => sentenceOf(t))).toEqual(["Trim 50% if above $427.42", "Review if above 9.47% from our entry"]);
    expect(notWritten).toEqual([]);
  });

  it("BASE_BREAKOUT with no chart: whether a prior high is above the buy is unknown, so no Trim, and the line says so", () => {
    const { triggers, notWritten } = withTheBuyTriggers(PLAYBOOK_TEMPLATES.BASE_BREAKOUT, { ...AAPL, chart: null }, ids);
    expect(triggers.map((t) => sentenceOf(t))).toEqual(["Review if above 9.47% from our entry"]);
    expect(notWritten.map((n) => n.text)).toEqual(["Not written: the playbook's Trim 50% if above {priorHighOrTwiceRisk}; the chart had no {priorHighOrTwiceRisk}"]);
  });

  it("MA_PULLBACK with no prior high above the buy: no Trim, and the line says so", () => {
    const { triggers, notWritten } = withTheBuyTriggers(PLAYBOOK_TEMPLATES.MA_PULLBACK, AAPL, ids);
    expect(triggers).toEqual([]);
    expect(notWritten.map((n) => n.text)).toEqual(["Not written: the playbook's Trim 50% if above {priorHigh}; the chart had no {priorHigh}"]);
  });

  it("PRE_CATALYST: its Trim is a run's judgment, so the fill never writes it, whatever the chart", () => {
    expect(withTheBuyTriggers(PLAYBOOK_TEMPLATES.PRE_CATALYST, { chart: FULL, buy: 100, sale: 95 }, ids)).toEqual({ triggers: [], notWritten: [] });
  });
});
