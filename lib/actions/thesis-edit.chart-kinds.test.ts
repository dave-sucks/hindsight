/**
 * thesis-edit.chart-kinds.test.ts — every chart condition the Add-trigger
 * dialog can post is accepted by the write path, on a watch and at the
 * account/analyst level (DAV-247). The shapes below are exactly what
 * AddTriggerDialog's chartPredicate() builds.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { ADDABLE_PREDICATE_KINDS, buildPrincipalTrigger } from "./thesis-edit";
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
});
