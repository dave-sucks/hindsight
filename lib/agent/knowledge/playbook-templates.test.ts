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
import { fillTemplateOps, fillValue, playbookRefs, playbookTemplates, pricedTemplate, templateSchema } from "./playbooks";
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
      "Buy if above {pivot} and above 1.5× normal volume and below {pivotChase}",
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

  it("naming a playbook on a holding writes its fill templates; one whose kind the stock has is kept out and named", () => {
    let n = 0;
    const has: Trigger = { id: "clock", predicate: { watch: "repeat", value: 14 }, action: "REVIEW", rationale: "Every two weeks." };
    const { ops, notWritten: kept } = fillTemplateOps(PLAYBOOK_TEMPLATES.COMPOUNDER_ACCUMULATION, [has], () => `t${++n}`);
    expect(ops.map((o) => (o.op === "add" ? sentenceOf(o.trigger) : o.op))).toEqual(["Review 60 days after the buy", "Add if above 7% from our entry"]);
    expect(kept).toEqual([{ op: "kept", id: "clock", text: "Kept Review every 14 days; the playbook's Review every 30 days not written" }]);
  });
});

/**
 * A holding trigger's number comes from a template's own fields, never from
 * its reason's prose: a fallback is a placeholder.
 */
describe("the triggers that come with the buy, priced from the chart and the buy", () => {
  /** A chart with every number a placeholder reads. */
  const FULL: PriceStructure = {
    price: 100, base: { pivot: 105, low: 90 }, range: { high20: 106, low20: 92, high52w: 120, low52w: 70 },
    swings: { lastHigh: { price: 112, date: "2026-11-01" }, lastLow: { price: 93, date: "2026-11-06" } },
    gaps: [{ date: "2026-11-03", direction: "UP", pct: 6, volumeRatio: 2, low: 95, mid: 97, high: 99 }],
  } as unknown as PriceStructure;
  const isTheSale = (t: Template) => t.action === "EXIT" && templatePlaceholders(t.predicate).includes("{sellPrice}");
  const written = SETUPS.flatMap((s) => s.triggers.filter((t) => t.writtenOn === "PROPOSAL" && !isTheSale(t)).map((t) => [s.id, t] as const));

  it("every placeholder a template may name resolves from PLACEHOLDERS alone", () => {
    for (const name of Object.keys(PLACEHOLDERS) as Placeholder[]) expect([name, typeof fillValue(name, { chart: FULL, buy: 100, sale: 95 })]).toEqual([name, "number"]);
    for (const [id, t] of written) for (const m of templatePlaceholders(t.predicate)) expect([id, m, Object.hasOwn(PLACEHOLDERS, m)]).toEqual([id, m, true]);
  });

  it("no fallback lives only in a reason: an 'else' is a placeholder that carries it", () => {
    for (const [id, t] of written) if (/\belse\b/.test(t.rationale)) expect([id, templatePlaceholders(t.predicate)]).toEqual([id, ["{priorHighOrTwiceRisk}"]]);
  });

  // AAPL 2026-11-13: buy $359.36, sale $325.33, the chart's last swing high $351.73 (under the buy).
  const AAPL = { chart: { ...FULL, swings: { lastHigh: { price: 351.73, date: "2026-10-23" }, lastLow: { price: 325.33, date: "2026-11-03" } } } as PriceStructure, buy: 359.36, sale: 325.33 };
  /** A playbook's holding triggers that come with the buy, each priced as edit_triggers prices its reference, or the keys it lacks. */
  const priced = (templates: Template[], at: typeof AAPL | (Omit<typeof AAPL, "chart"> & { chart: null })) =>
    playbookRefs(templates)
      .filter((r) => r.template.writtenOn === "PROPOSAL" && !isTheSale(r.template))
      .map((r) => {
        const p = pricedTemplate(r.template, at);
        return "missing" in p ? `${r.ref}: no ${p.missing.join(", ")}` : `${r.ref}: ${sentenceOf(p.trigger as Trigger)}`;
      });

  it("BASE_BREAKOUT with no prior high above the buy: the Trim at twice the risk above it, $427.42 on AAPL", () => {
    expect(priced(PLAYBOOK_TEMPLATES.BASE_BREAKOUT, AAPL)).toEqual(["H2: Trim 50% if above $427.42", "H3: Review if above 9.47% from our entry"]);
  });

  it("BASE_BREAKOUT with no chart: whether a prior high is above the buy is unknown, so the Trim has no number", () => {
    expect(priced(PLAYBOOK_TEMPLATES.BASE_BREAKOUT, { ...AAPL, chart: null })).toEqual(["H2: no {priorHighOrTwiceRisk}", "H3: Review if above 9.47% from our entry"]);
  });

  it("MA_PULLBACK with no prior high above the buy: the Trim has no number", () => {
    expect(priced(PLAYBOOK_TEMPLATES.MA_PULLBACK, AAPL)).toEqual(["H2: no {priorHigh}"]);
  });
});

describe("a playbook's buy reads during the day", () => {
  const closeOnly = (p: unknown): boolean => {
    const c = p as { settings?: { close?: boolean }; conditions?: unknown[] };
    return c.settings?.close === true || (c.conditions ?? []).some(closeOnly);
  };
  it("no buy template waits for the close, and no buy reason says it does", () => {
    const buys = Object.values(PLAYBOOK_TEMPLATES).flat().filter((t) => t.action === "ENTER");
    expect(buys.length).toBeGreaterThan(0);
    expect(buys.filter((t) => closeOnly(t.predicate))).toEqual([]);
    expect(buys.filter((t) => /\ba close\b/i.test(t.rationale))).toEqual([]);
  });
  it("the breakout keeps its chase limit, and the watch's Stop watching still waits for the close", () => {
    const list = PLAYBOOK_TEMPLATES.BASE_BREAKOUT;
    expect(JSON.stringify(list.find((t) => t.action === "ENTER")!.predicate)).toContain("{pivotChase}");
    expect(closeOnly(list.find((t) => t.action === "STOP_WATCHING")!.predicate)).toBe(true);
  });
});
