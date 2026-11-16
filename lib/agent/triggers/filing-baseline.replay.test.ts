/**
 * filing-baseline.replay.test.ts — a filing rule fires only on a filing filed on or after the day it was
 * written, or the day its thesis was, whichever is later.
 *
 * Replayed from PRAX, Mon 2026-11-16. The Catalyst Event PM's 08:02 ET morning run read the 8-K of Nov 12
 * (accession 0001689548-26-000091, items 7.01 and 8.01), which the account's filing rule had already sent to
 * the morning run on the Friday the thesis was written, and added two filing rules of its own. A new rule has
 * no fired-filing memory, so at 09:30 both fired on that same 8-K and started two trigger runs.
 *
 * The write goes through the real write path (applyTriggerOps, as update_thesis calls it, with no live price:
 * the market is closed at 08:02 and freshQuotePrice gives none) and the fire through the real rule
 * (shouldFire, as the evaluator calls it). The evaluator's own handler is replayed in
 * lib/inngest/functions/trigger-evaluator.one-run-per-stock.replay.test.ts.
 */
import { applyTriggerOps } from "./ops";
import { shouldFire } from "./evaluate";
import { filingsBehindFire, filingsSince, type SecFiling } from "@/lib/market-data/sec-events";
import type { Trigger } from "./types";

const NOV_12_8K: SecFiling = {
  accession: "0001689548-26-000091",
  cik: "0001689548",
  ticker: "PRAX",
  form: "8-K",
  rootForm: "8-K",
  items: ["7.01", "8.01"],
  filedDate: "2026-11-12",
  tier: "CONTEXT",
  url: "https://www.sec.gov/Archives/edgar/data/1689548/000168954826000091/prax-20261112.htm",
};
const NOV_16_8K: SecFiling = { ...NOV_12_8K, accession: "0001689548-26-000107", filedDate: "2026-11-16" };

// 08:02 ET on Monday Nov 16 (EST, UTC−5), and the 09:30 pass.
const WRITTEN = new Date("2026-11-16T08:02:22-05:00");
const PASS = new Date("2026-11-16T09:30:20-05:00");
const OLD_THESIS = new Date("2026-06-12T15:00:00Z");

const ids = ["a05c58e2", "3ca27b95"];
function writeRules(now = WRITTEN, stored: Trigger[] = []) {
  let n = 0;
  return applyTriggerOps({
    stored,
    ops: [
      { op: "add", trigger: { id: "", predicate: { watch: "filing", variable: "item:7.01" }, action: "REVIEW", fireMode: "ASK_NOW", rationale: "A press release." } },
      { op: "add", trigger: { id: "", predicate: { watch: "filing", variable: "item:8.01" }, action: "REVIEW", fireMode: "ASK_NOW", rationale: "Other events." } },
    ],
    direction: "LONG",
    status: "WATCHING",
    actor: "AGENT",
    currentPrice: null,
    writtenPrice: null, // no fresh quote before the open
    now,
    mintId: () => ids[n++],
  });
}

const check = (t: Trigger, filings: SecFiling[], thesisCreatedAt = OLD_THESIS, now = PASS) =>
  shouldFire(t, { filings, thesis: { createdAt: thesisCreatedAt, direction: "LONG" }, now, latestQuote: { price: 322, changePct: 0, prevClose: 323 } });

describe("PRAX 2026-11-16 — rules written at 08:02, before the open", () => {
  const { triggers } = writeRules();

  it("each carries the time it was written, with no price (on main: neither stamp was written)", () => {
    expect(triggers.map((t) => t.id)).toEqual(ids);
    for (const t of triggers) {
      expect(t.writtenAt).toBe(WRITTEN.toISOString());
      expect(t.writtenPrice).toBeUndefined();
    }
  });

  it("neither fires on the Nov 12 8-K at 09:30 (on main both did)", () => {
    for (const t of triggers) {
      expect(check(t, [NOV_12_8K])).toEqual({ fires: false, reason: "no-match" });
      expect(filingsBehindFire(t, [NOV_12_8K], filingsSince(t, OLD_THESIS))).toEqual([]);
    }
  });

  it("both fire on a filing dated the day they were written, and name only it", () => {
    for (const t of triggers) {
      expect(check(t, [NOV_16_8K, NOV_12_8K])).toEqual({ fires: true, reason: "match" });
      expect(filingsBehindFire(t, [NOV_16_8K, NOV_12_8K], filingsSince(t, OLD_THESIS)).map((f) => f.accession)).toEqual([NOV_16_8K.accession]);
    }
  });

  it("an edit that doesn't change what the rule watches keeps its time; one that does starts it again", () => {
    const later = new Date("2026-11-18T08:03:00-05:00");
    const kept = applyTriggerOps({
      stored: triggers,
      ops: [{ op: "edit", id: ids[0], fireMode: "NEXT_MORNING" }],
      direction: "LONG",
      status: "WATCHING",
      actor: "AGENT",
      writtenPrice: null,
      now: later,
      mintId: () => "x",
    });
    expect(kept.triggers.find((t) => t.id === ids[0])?.writtenAt).toBe(WRITTEN.toISOString());
    const moved = applyTriggerOps({
      stored: triggers,
      ops: [{ op: "replace", id: ids[0], trigger: { id: "", predicate: { watch: "filing", variable: "item:5.02" }, action: "REVIEW", fireMode: "ASK_NOW", rationale: "A change of officers." } }],
      direction: "LONG",
      status: "WATCHING",
      actor: "AGENT",
      writtenPrice: null,
      now: later,
      mintId: () => "x",
    });
    // Replaced into another slot it is a new rule with no memory of what the old one fired on: the day it was written is its memory.
    const replacement = moved.triggers.find((t) => (t.predicate as { variable?: string }).variable === "item:5.02");
    expect(replacement?.writtenAt).toBe(later.toISOString());
  });
});

describe("the first filing day a rule can fire on", () => {
  it("is the later of the day the rule was written and the day its thesis was, in New York", () => {
    expect(filingsSince({ writtenAt: WRITTEN.toISOString() }, OLD_THESIS)).toBe("2026-11-16");
    expect(filingsSince({ writtenAt: "2026-06-01T12:00:00Z" }, new Date("2026-11-13T18:47:48Z"))).toBe("2026-11-13");
    // Friday 9 PM ET is already Saturday in UTC; EDGAR's date for it is Friday's.
    expect(filingsSince({ writtenAt: "2026-11-14T02:00:00Z" }, OLD_THESIS)).toBe("2026-11-13");
  });

  it("is the thesis's day alone for a rule with no stamp (an analyst's or the account's, or one from before 2026-11-16)", () => {
    expect(filingsSince({}, new Date("2026-11-13T18:47:48Z"))).toBe("2026-11-13");
    expect(filingsSince({}, undefined)).toBeUndefined();
  });

  it("the account's rule on a thesis written the Friday after the Nov 12 8-K does not fire on it (PRAX, 11-13 18:50)", () => {
    const rule: Trigger = { id: "b5b2a019", action: "REVIEW", predicate: { watch: "filing", variable: "item:8.01" }, rationale: "r", fireMode: "NEXT_MORNING" };
    const created = new Date("2026-11-13T18:47:48.290Z");
    expect(check(rule, [NOV_12_8K], created, new Date("2026-11-13T18:50:06Z")).fires).toBe(false);
    expect(check(rule, [NOV_12_8K], OLD_THESIS, new Date("2026-11-13T18:50:06Z")).fires).toBe(true);
  });
});
