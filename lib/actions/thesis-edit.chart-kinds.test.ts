/**
 * thesis-edit.chart-kinds.test.ts — every chart condition the Add-trigger
 * dialog can post is accepted by the write path, on a watch and at the
 * account/analyst level (DAV-247). The shapes below are exactly what
 * AddTriggerDialog's chartPredicate() builds.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { ADDABLE_PREDICATE_KINDS, applyTriggerAdd, buildPrincipalTrigger } from "./thesis-edit";
import { addLevelTrigger } from "./level-triggers";
import { LEVEL_ELIGIBLE_PREDICATE_KINDS } from "./level-triggers";
import type { TriggerPredicate } from "@/lib/agent/triggers/types";

const DIALOG_POSTS: TriggerPredicate[] = [
  { kind: "NEAR_SMA", period: 50, withinPct: 2 },
  { kind: "VS_SMA", period: 200, direction: "ABOVE" },
  { kind: "NEW_HIGH", window: "52W" },
  { kind: "PCT_FROM_52W_HIGH", max: 5 },
  { kind: "VOLUME_RATIO", min: 1.5 },
  { kind: "GAP_UP", minPct: 8, minVolRatio: 3 },
  { kind: "RSI", period: 2, threshold: 10, direction: "BELOW" },
  { kind: "RS_VS_SPY", window: "3M", min: 0 },
  { kind: "INSIDER_CLUSTER", minBuyers: 3, days: 30 },
  { kind: "PRICE_ABOVE", level: 517.88, basis: "close" },
  { kind: "PRICE_MOVE_PCT", pct: 8, direction: "DOWN", window: "5D" },
];

describe("the Add-trigger dialog's chart conditions", () => {
  it.each(DIALOG_POSTS.map((p) => [p.kind, p] as const))("%s is addable from the sheet", (_k, p) => {
    expect(ADDABLE_PREDICATE_KINDS.has(p.kind)).toBe(true);
    const t = buildPrincipalTrigger({
      action: p.kind === "PRICE_ABOVE" ? "ENTER" : "REVIEW",
      predicate: p,
      defaultRationale: "test",
      allowDirect: false,
    });
    expect(t.predicate).toEqual(p);
    expect(t.source).toBe("PRINCIPAL");
    expect(t.cooldownDays).toBeGreaterThan(0);
  });

  it("the chart kinds can also be account / analyst standing rules", () => {
    for (const p of DIALOG_POSTS.filter((x) => x.kind !== "PRICE_ABOVE")) {
      expect({ kind: p.kind, eligible: LEVEL_ELIGIBLE_PREDICATE_KINDS.has(p.kind) }).toEqual({
        kind: p.kind,
        eligible: true,
      });
    }
  });

  it("a deleted kind is refused by the schema", () => {
    expect(() =>
      buildPrincipalTrigger({
        action: "REVIEW",
        predicate: { kind: "FILING", formType: "8-K" } as unknown as TriggerPredicate,
        defaultRationale: "test",
        allowDirect: false,
      }),
    ).toThrow(/Invalid trigger/);
  });

  // DAV-281 — "a beat the market sold", the trigger a PEAD fill writes, built
  // by hand. On main both write paths stop at the first line: the sheet says
  // "can't be added from the sheet (got AND)", the level says it is
  // "specific to one thesis".
  const BEAT_THE_MARKET_SOLD: TriggerPredicate = {
    kind: "AND",
    predicates: [{ kind: "EARNINGS_BEAT" }, { kind: "PRICE_MOVE_PCT", pct: 3, direction: "DOWN", window: "1D" }],
  };
  const ctx = { userId: "u1", accountId: "a1", actorUserId: "u1" } as never;

  it("a beat and a miss are conditions the dialog can post, on a stock and as a standing rule", () => {
    for (const k of ["EARNINGS_BEAT", "EARNINGS_MISS"] as const) {
      expect(ADDABLE_PREDICATE_KINDS.has(k)).toBe(true);
      expect(LEVEL_ELIGIBLE_PREDICATE_KINDS.has(k)).toBe(true);
    }
    const t = buildPrincipalTrigger({ action: "REVIEW", predicate: BEAT_THE_MARKET_SOLD, defaultRationale: "test", allowDirect: false });
    expect(t.predicate).toEqual(BEAT_THE_MARKET_SOLD);
  });

  it("the sheet's add path lets the pair past its kind check (it fails later only because this test has no database)", async () => {
    await expect(applyTriggerAdd("t1", { action: "REVIEW", predicate: BEAT_THE_MARKET_SOLD }, ctx)).rejects.not.toThrow(/can't be added/);
  });

  it("the account / analyst add path lets the pair past its eligibility check", async () => {
    await expect(addLevelTrigger("ACCOUNT", "a1", { action: "REVIEW", predicate: BEAT_THE_MARKET_SOLD }, ctx)).rejects.not.toThrow(/specific to one thesis|can't be added/);
  });

  it("a pair holding a price level is still refused as a standing rule", async () => {
    const p: TriggerPredicate = { kind: "AND", predicates: [{ kind: "EARNINGS_BEAT" }, { kind: "PRICE_BELOW", level: 96 }] };
    await expect(addLevelTrigger("ACCOUNT", "a1", { action: "REVIEW", predicate: p }, ctx)).rejects.toThrow(/PRICE_BELOW/);
  });
});

// DAV-279 — the Catalyst seat's rules are day counts from the event date.
describe("a day count as a standing rule", () => {
  it("REVIEW_CADENCE is level-eligible, so 'review 10 days before the event date' can be an analyst rule", () => {
    expect(LEVEL_ELIGIBLE_PREDICATE_KINDS.has("REVIEW_CADENCE")).toBe(true);
  });
});
