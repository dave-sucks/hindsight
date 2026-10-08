/**
 * declined-sale.answered.test.ts — a declined sale dates from when it was
 * answered, not when it was proposed.
 *
 * Production, MU: the protective sale proposed 2026-10-06 19:40 UTC expired
 * at 2026-10-07 19:40 UTC (the expiry cron flipped it at 20:00). The line the
 * run and the owner read said "most recently 2026-10-06".
 */
import { declinedSaleLine, declinedSaleWork, foldDeclines } from "./declined-sale";

const mu = [
  { createdAt: new Date("2026-10-01T18:06:06.880Z"), status: "EXPIRED", expiresAt: new Date("2026-10-02T14:06:06.880Z"), updatedAt: new Date("2026-10-02T14:30:12.741Z"), rejectionMessage: null },
  { createdAt: new Date("2026-10-06T19:40:25.054Z"), status: "EXPIRED", expiresAt: new Date("2026-10-07T19:40:25.054Z"), updatedAt: new Date("2026-10-07T20:00:42.972Z"), rejectionMessage: null },
];

it("MU: the expiry's time, not the proposal's", () => {
  const folded = foldDeclines(mu)!;
  expect(folded.lastDeclinedAt.toISOString()).toBe("2026-10-07T19:40:25.054Z");
  const work = declinedSaleWork({ status: "HOLDING", direction: "LONG", decline: folded, floorPrice: 1060, currentPrice: 1040, recentLow: null, now: new Date("2026-10-08T14:00:00Z") })!;
  expect(declinedSaleLine(work)).toContain("most recently 2026-10-07");
});

it("a decline dates from the order's change; a row without the dates keeps the proposal's", () => {
  const rejected = { createdAt: new Date("2026-10-06T15:00:00Z"), status: "REJECTED", expiresAt: new Date("2026-10-07T15:00:00Z"), updatedAt: new Date("2026-10-06T18:12:00Z"), rejectionMessage: "hold" };
  expect(foldDeclines([rejected])!.lastDeclinedAt.toISOString()).toBe("2026-10-06T18:12:00.000Z");
  expect(foldDeclines([{ createdAt: new Date("2026-10-06T15:00:00Z"), rejectionMessage: null }])!.lastDeclinedAt.toISOString()).toBe("2026-10-06T15:00:00.000Z");
});
