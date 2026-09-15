/**
 * sec-event.replay.test.ts — replayed from MU, a stock we hold.
 *
 * On 2026-08-26 Micron filed an 8-K, item 5.02: an officer leaving or
 * joining. MU was HOLDING. On main nothing woke — the old FILING kind was
 * deleted because nothing could fire it, and there was no filing trigger at
 * all. This test runs that real EDGAR row through the evaluator's own
 * pieces: the account rule resolved onto the thesis, shouldFire, the filings
 * behind the fire, the fire stamp, and the next pass.
 *
 * No red filing has touched the book yet. The closest real one is a
 * restatement 8-K (items 4.01, 4.02) from 2026-08-18, used for the same-day
 * case.
 */

jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})) } }));

const stored: { triggers: unknown; triggerState: unknown } = { triggers: [], triggerState: {} };
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<void>) =>
      fn({
        thesis: {
          findUnique: async () => ({ triggers: stored.triggers, triggerState: stored.triggerState }),
          update: async ({ data }: { data: { triggers: unknown; triggerState: unknown } }) => {
            stored.triggers = data.triggers;
            stored.triggerState = data.triggerState;
          },
        },
      }),
  },
}));

import fixture from "@/lib/market-data/__fixtures__/edgar-search-2026-09.json";
import { parseSearchHits } from "@/lib/market-data/sec-filings";
import { filingNeedsSameDayLook, filingsBehindFire } from "@/lib/market-data/sec-events";
import { resolveThesisLadder } from "./load-levels";
import { shouldFire } from "./evaluate";
import { splitFiresByLevel } from "./levels";
import { secFilingStandingTriggers } from "./seed-account";
import { triggerBucket } from "./bucket";
import { __test__ } from "@/lib/inngest/functions/trigger-evaluator";
import type { Trigger } from "./types";

const filings = parseSearchHits(fixture.hits.hits, new Map([["0000723125", "MU"], ["0001414767", "NCPL"]]));
const mu = filings.filter((f) => f.ticker === "MU");
const restatement = filings.filter((f) => f.ticker === "NCPL");

const account = secFilingStandingTriggers().map((t) => ({ ...t, id: "acct-sec" })) as Trigger[];
const now = new Date("2026-08-27T14:00:00Z");

function ladder() {
  return resolveThesisLadder(
    { triggers: stored.triggers, triggerState: stored.triggerState, status: "HOLDING", horizon: "TARGET", direction: "LONG" },
    { analyst: [], account },
  );
}
const ctx = (f = mu) => ({
  filings: f,
  thesis: { createdAt: new Date("2026-06-01"), direction: "LONG" },
  now,
});

describe("MU 8-K 5.02, 2026-08-26 — held, under the account's filing rule", () => {
  beforeEach(() => {
    stored.triggers = [];
    stored.triggerState = {};
  });

  it("wakes a review once, names the filing, and waits for the morning", async () => {
    const rule = ladder().find((t) => t.predicate.kind === "SEC_EVENT")!;
    expect(rule).toMatchObject({ inherited: true, action: "REVIEW" });
    expect(shouldFire(rule, ctx())).toEqual({ fires: true, reason: "match" });

    const behind = filingsBehindFire(rule, mu);
    expect(behind.map((f) => f.accession)).toEqual(["0001104659-26-101067"]);
    // Material, not serious: the next daily review, no tactical run.
    expect(filingNeedsSameDayLook(behind, "HOLDING")).toBe(false);

    await __test__.stampLastFiredAt({
      thesisId: "mu",
      ...splitFiresByLevel([rule]),
      firedFilings: new Map([[rule.id, behind.map((f) => f.accession)]]),
      now,
    });
    expect(stored.triggerState).toEqual({
      "acct-sec": { firedAt: now.toISOString(), firedFilings: ["0001104659-26-101067"] },
    });

    // The next pass, five minutes later, reads the same filing: no second fire.
    const again = ladder().find((t) => t.predicate.kind === "SEC_EVENT")!;
    expect(again.firedFilings).toEqual(["0001104659-26-101067"]);
    expect(shouldFire(again, { ...ctx(), now: new Date(now.getTime() + 300_000) }).fires).toBe(false);
  });

  it("a new filing the next day fires again — no cooldown", async () => {
    stored.triggerState = { "acct-sec": { firedAt: now.toISOString(), firedFilings: ["0001104659-26-101067"] } };
    const rule = ladder().find((t) => t.predicate.kind === "SEC_EVENT")!;
    const nextDay = { ...mu[0], accession: "0001104659-26-101999", filedDate: "2026-08-27" };
    expect(shouldFire(rule, { ...ctx([nextDay, ...mu]), now: new Date(now.getTime() + 3_600_000) }).fires).toBe(true);
    expect(filingsBehindFire(rule, [nextDay, ...mu]).map((f) => f.accession)).toEqual(["0001104659-26-101999"]);
  });

  it("a thesis rule for its own filing is stamped on the thesis and never silences the account's", async () => {
    const own: Trigger = { id: "own-502", predicate: { kind: "SEC_EVENT", items: ["5.02"] }, action: "REVIEW", rationale: "New CEO is the thesis." };
    stored.triggers = [own];
    expect(triggerBucket(own)).not.toBe(triggerBucket(account[0]));
    const fired = ladder().filter((t) => shouldFire(t, ctx()).fires);
    expect(fired.map((t) => t.id).sort()).toEqual(["acct-sec", "own-502"]);

    await __test__.stampLastFiredAt({
      thesisId: "mu",
      ...splitFiresByLevel(fired),
      firedFilings: new Map(fired.map((t) => [t.id, ["0001104659-26-101067"]])),
      now,
    });
    expect((stored.triggers as Trigger[])[0].firedFilings).toEqual(["0001104659-26-101067"]);
    expect(ladder().filter((t) => shouldFire(t, ctx()).fires)).toEqual([]);
  });

  it("a serious filing on a stock we hold goes to a tactical run the same day", () => {
    const rule = ladder().find((t) => t.predicate.kind === "SEC_EVENT")!;
    const behind = filingsBehindFire(rule, restatement);
    expect(behind[0].tier).toBe("RED");
    expect(filingNeedsSameDayLook(behind, "HOLDING")).toBe(true);
  });

  it("the evaluator loads filings only for a ladder with a filing trigger, and the cron path evaluates it", () => {
    expect(__test__.needsFilings({ kind: "SEC_EVENT", tier: "MATERIAL" })).toBe(true);
    expect(__test__.needsFilings({ kind: "EARNINGS_BEAT" })).toBe(false);
    expect(__test__.isPriceSidePredicate({ kind: "SEC_EVENT", tier: "RED" })).toBe(true);
  });
});
