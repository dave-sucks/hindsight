/**
 * Conditions no stored trigger uses yet, so every reader and every rule is
 * exercised: the kinds and options nobody has saved (RSI, a gap, an insider
 * cluster, the trail's options…), and the cases the book happens to lack (two
 * RSI lengths on the same side, a group of states, a group holding a price
 * line read intraday). read.test.ts and condition.test.ts run them beside the
 * stored ones.
 */

import type { TriggerPredicate } from "../../types";

export const UNSTORED: TriggerPredicate[] = [
  { kind: "RSI", threshold: 30, direction: "BELOW" },
  { kind: "RSI", period: 2, threshold: 70, direction: "ABOVE" },
  { kind: "GAP_UP", minPct: 4, minVolRatio: 3 },
  { kind: "GAP_UP", minPct: 4, minVolRatio: 2, withinDays: 3 },
  { kind: "INSIDER_CLUSTER", minBuyers: 2, days: 30 },
  { kind: "INSIDER_CLUSTER", minBuyers: 3, days: 90 },
  { kind: "NEW_HIGH", window: "20D" },
  { kind: "NEW_HIGH", window: "52W" },
  { kind: "PCT_FROM_52W_HIGH", max: 8 },
  { kind: "PRICE_MOVE_PCT", pct: 6, direction: "UP", window: "20D" },
  { kind: "TRAILING_FROM_HIGH", pct: 12, armAtGainPct: 15, atrMultiple: 3 },
  { kind: "GAIN_FROM_ENTRY", pct: 20, direction: "UP", skipIfPeakGainPct: 20, skipIfPeakWithinDays: 21 },
  { kind: "EARNINGS_SINCE", min: 1, max: 3 },
  { kind: "SEC_EVENT", tier: "RED" },
  { kind: "SEC_EVENT", forms: ["S-3", "NT 10-Q"] },
  { kind: "SEC_EVENT", tier: "MATERIAL", items: ["8.01"] },
  { kind: "REVIEW_CADENCE", days: 10, from: "EVENT", side: "AFTER" },
  { kind: "OR", predicates: [{ kind: "VS_SMA", period: 50, direction: "BELOW" }, { kind: "RSI", threshold: 25, direction: "BELOW" }] },
  { kind: "RSI", period: 2, threshold: 10, direction: "BELOW" },
  { kind: "AND", predicates: [{ kind: "VS_SMA", period: 200, direction: "BELOW" }, { kind: "RS_VS_SPY", window: "3M", min: 0 }] },
  { kind: "AND", predicates: [{ kind: "PRICE_BELOW", level: 90 }, { kind: "VOLUME_RATIO", min: 2 }] },
];
