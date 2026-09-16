/**
 * sec-events.test.ts — the event list, on real filings.
 *
 * Every row here is a real EDGAR filing (fixture fetched 2026-09-15): MU's
 * officer change on Aug 26, NVDA's three 8-Ks in 17 days, a real
 * restatement-plus-auditor-change 8-K, a real late quarterly report, a real
 * amended activist stake.
 */

import fixture from "./__fixtures__/edgar-search-2026-09.json";
import { parseSearchHits } from "./sec-filings";
import {
  classifyFiling,
  describeFiling,
  filingMatches,
  filingNeedsSameDayLook,
  filingsBehindFire,
  rememberFired,
  unfiredMatches,
  FIRED_FILINGS_KEPT,
} from "./sec-events";

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

const tickerByCik = new Map([
  ["0000723125", "MU"],
  ["0001045810", "NVDA"],
  ["0001414767", "NCPL"],
  ["0001949864", "MGNC"],
  ["0001436126", "MG"],
]);
const filings = parseSearchHits(fixture.hits.hits, tickerByCik);
const by = (ticker: string) => filings.filter((f) => f.ticker === ticker);

describe("the tier table on real filings", () => {
  it("MU's officer change is material; one filing is one row, exhibits included", () => {
    expect(by("MU")).toHaveLength(1);
    expect(by("MU")[0]).toMatchObject({ accession: "0001104659-26-101067", items: ["5.02", "9.01"], tier: "MATERIAL" });
  });

  it("NVDA: a major agreement is material; earnings results and 'other events' are routine", () => {
    const tiers = Object.fromEntries(by("NVDA").map((f) => [f.filedDate, f.tier]));
    expect(tiers).toEqual({ "2026-08-17": "MATERIAL", "2026-08-26": "CONTEXT", "2026-09-03": "CONTEXT" });
  });

  it("a restatement is serious; so is a late quarterly report", () => {
    expect(by("NCPL")[0].tier).toBe("RED");
    expect(by("MGNC")[0].tier).toBe("RED");
  });

  it("an amended activist stake is paperwork on an event already counted", () => {
    expect(by("MG")[0]).toMatchObject({ form: "SCHEDULE 13D/A", rootForm: "SCHEDULE 13D", tier: "CONTEXT" });
    expect(classifyFiling({ form: "SCHEDULE 13D", rootForm: "SCHEDULE 13D", items: [] })).toBe("MATERIAL");
  });

  it("an amended 8-K keeps its items — restatements are often filed as 8-K/A", () => {
    expect(classifyFiling({ form: "8-K/A", rootForm: "8-K", items: ["4.01", "4.02", "9.01"] })).toBe("RED");
  });

  it("the activity line says the event in words, the date, and the link", () => {
    expect(describeFiling(by("MU")[0])).toBe(
      "Filed 8-K — officer or director leaving or joining (5.02), Aug 26. " +
        "https://www.sec.gov/Archives/edgar/data/723125/000110465926101067/tm2624017d1_8k.htm",
    );
  });
});

describe("matching a trigger", () => {
  const material = { kind: "SEC_EVENT" as const, tier: "MATERIAL" as const };
  const red = { kind: "SEC_EVENT" as const, tier: "RED" as const };

  it("tier is 'at least': material matches serious, serious doesn't match material", () => {
    expect(filingMatches(material, by("NCPL")[0])).toBe(true);
    expect(filingMatches(red, by("MU")[0])).toBe(false);
    expect(filingMatches(red, by("NCPL")[0])).toBe(true);
  });

  it("a named event matches its code even when the tier is routine", () => {
    const pressRelease = by("NVDA").find((f) => f.filedDate === "2026-09-03")!;
    expect(filingMatches({ kind: "SEC_EVENT", items: ["8.01"] }, pressRelease)).toBe(true);
    expect(filingMatches({ kind: "SEC_EVENT", forms: ["SCHEDULE 13D"] }, by("MG")[0])).toBe(true);
  });

  it("a filing already fired on never matches that trigger again", () => {
    expect(unfiredMatches(material, by("MU"), [])).toHaveLength(1);
    expect(unfiredMatches(material, by("MU"), ["0001104659-26-101067"])).toHaveLength(0);
  });

  it("NVDA's filings each fire once — no cooldown swallows the second", () => {
    const anyEvent = { kind: "SEC_EVENT" as const, items: ["1.01", "2.02", "8.01"] };
    const first = unfiredMatches(anyEvent, by("NVDA"), []);
    expect(first).toHaveLength(3);
    const remembered = rememberFired([], [first[0].accession]);
    expect(unfiredMatches(anyEvent, by("NVDA"), remembered)).toHaveLength(2);
  });

  it("the filings behind a composite fire come from its SEC leaf", () => {
    const trigger = {
      predicate: { kind: "AND" as const, predicates: [material, { kind: "PRICE_MOVE_PCT" as const, pct: 3, direction: "DOWN" as const, window: "1D" as const }] },
    };
    expect(filingsBehindFire(trigger, by("MU")).map((f) => f.accession)).toEqual(["0001104659-26-101067"]);
  });

  it("the memory is capped, newest kept", () => {
    const many = Array.from({ length: FIRED_FILINGS_KEPT + 5 }, (_, i) => `a${i}`);
    const kept = rememberFired(many.slice(0, FIRED_FILINGS_KEPT), many.slice(FIRED_FILINGS_KEPT));
    expect(kept).toHaveLength(FIRED_FILINGS_KEPT);
    expect(kept.at(-1)).toBe(`a${FIRED_FILINGS_KEPT + 4}`);
  });
});

describe("same-day look", () => {
  it("serious on a holding goes today; material, or serious on a watch, waits for the review", () => {
    expect(filingNeedsSameDayLook(by("NCPL"), "HOLDING")).toBe(true);
    expect(filingNeedsSameDayLook(by("NCPL"), "WATCHING")).toBe(false);
    expect(filingNeedsSameDayLook(by("MU"), "HOLDING")).toBe(false);
  });
});
