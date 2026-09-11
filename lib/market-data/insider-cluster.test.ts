/**
 * insider-cluster.test.ts — open-market buys only, and the window edge.
 */

import { describeCluster, insiderCluster, openMarketBuys } from "./insider-cluster";
import { evaluateTrigger } from "@/lib/agent/triggers/evaluate";
import { triggerPredicateSchema } from "@/lib/agent/triggers/schema";
import type { IndicatorSnapshot } from "./indicator-snapshot";

// Shaped like Finnhub /stock/insider-transactions rows (SMMT, June 2026).
const rows = [
  { name: "Zanganeh Mahkam", change: 3810000, transactionDate: "2026-06-12", transactionCode: "P", transactionPrice: 13.12, isDerivative: false, id: "a" },
  { name: "DUGGAN ROBERT W", change: 3810000, transactionDate: "2026-06-12", transactionCode: "P", transactionPrice: 13.12, isDerivative: false, id: "b" },
  { name: "Soni Manmeet Singh", change: 25000, transactionDate: "2026-06-04", transactionCode: "P", transactionPrice: 14.43, isDerivative: false, id: "c" },
  // Not buying: a grant, an option exercise, a sale, a duplicate filing id.
  { name: "Grant Person", change: 50000, transactionDate: "2026-06-10", transactionCode: "A", transactionPrice: 0, isDerivative: false, id: "d" },
  { name: "Option Person", change: 10000, transactionDate: "2026-06-10", transactionCode: "M", transactionPrice: 5, isDerivative: true, id: "e" },
  { name: "Seller", change: -20000, transactionDate: "2026-06-11", transactionCode: "S", transactionPrice: 14, isDerivative: false, id: "f" },
  { name: "Zanganeh Mahkam", change: 3810000, transactionDate: "2026-06-12", transactionCode: "P", transactionPrice: 13.12, isDerivative: false, id: "a" },
];

describe("openMarketBuys", () => {
  it("keeps open-market purchases only, one per filing, newest first", () => {
    const buys = openMarketBuys(rows);
    expect(buys.map((b) => b.name)).toEqual(["Zanganeh Mahkam", "DUGGAN ROBERT W", "Soni Manmeet Singh"]);
  });
});

describe("insiderCluster — the window edge", () => {
  const buys = openMarketBuys(rows);
  it("counts distinct buyers inside the window", () => {
    const c = insiderCluster(buys, 30, new Date("2026-06-20T12:00:00Z"));
    expect(c.buyers).toBe(3);
    expect(c.lowestPrice).toBe(13.12);
  });
  it("a buy exactly `days` back is still in; a day earlier is out", () => {
    // 2026-06-04 is 30 days before 2026-07-04.
    expect(insiderCluster(buys, 30, new Date("2026-07-04T12:00:00Z")).buyers).toBe(3);
    expect(insiderCluster(buys, 30, new Date("2026-07-05T12:00:00Z")).buyers).toBe(2);
    expect(insiderCluster(buys, 30, new Date("2026-07-13T12:00:00Z")).buyers).toBe(0);
  });
});

describe("describeCluster — the audit row names the buyers", () => {
  it("lists who bought, when, how much, and the lowest price", () => {
    const c = insiderCluster(openMarketBuys(rows), 30, new Date("2026-06-20T12:00:00Z"));
    expect(describeCluster(c)).toBe(
      "3 insiders bought on the open market in the last 30 days: Zanganeh Mahkam (06-12, 3,810,000 sh @ $13.12); DUGGAN ROBERT W (06-12, 3,810,000 sh @ $13.12); Soni Manmeet Singh (06-04, 25,000 sh @ $14.43). Lowest price paid $13.12.",
    );
  });
  it("says so when there is none", () => {
    expect(describeCluster(insiderCluster([], 30))).toBe("No open-market insider buying in the last 30 days.");
  });
});

describe("INSIDER_CLUSTER — the trigger kind", () => {
  const snap = { insiderBuys: openMarketBuys(rows) } as unknown as IndicatorSnapshot;
  const ctx = (now: string) => ({ indicators: snap, thesis: { createdAt: new Date() }, now: new Date(now) });

  it("fires at three buyers in 30 days, not at four", () => {
    expect(evaluateTrigger({ kind: "INSIDER_CLUSTER", minBuyers: 3, days: 30 }, ctx("2026-06-20T12:00:00Z"))).toBe(true);
    expect(evaluateTrigger({ kind: "INSIDER_CLUSTER", minBuyers: 4, days: 30 }, ctx("2026-06-20T12:00:00Z"))).toBe(false);
  });
  it("stops firing once the buys age out", () => {
    expect(evaluateTrigger({ kind: "INSIDER_CLUSTER", minBuyers: 3, days: 30 }, ctx("2026-07-05T12:00:00Z"))).toBe(false);
  });
  it("is false with no insider data on the snapshot", () => {
    expect(
      evaluateTrigger({ kind: "INSIDER_CLUSTER", minBuyers: 1, days: 30 }, {
        indicators: {} as IndicatorSnapshot,
        thesis: { createdAt: new Date() },
        now: new Date(),
      }),
    ).toBe(false);
  });
  it("the schema accepts it and bounds it", () => {
    expect(triggerPredicateSchema.safeParse({ kind: "INSIDER_CLUSTER", minBuyers: 3, days: 30 }).success).toBe(true);
    expect(triggerPredicateSchema.safeParse({ kind: "INSIDER_CLUSTER", minBuyers: 3, days: 120 }).success).toBe(false);
  });
});
