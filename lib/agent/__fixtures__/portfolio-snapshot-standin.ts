/**
 * A stand-in book for the portfolio snapshot's tests: made-up amounts, never
 * the live account's (the repo is public). Two holdings, a sale proposal that
 * keeps coming back and a buy proposed once; nothing bought or sold that day.
 */
import { buildSnapshot, type SnapshotInputs } from "@/lib/portfolio/snapshot";

export const STANDIN_INPUTS: SnapshotInputs = {
  day: "2026-11-11",
  live: false,
  at: "2026-11-12T01:00:00.000Z",
  cash: 40_000,
  contributed: 100_000,
  holdings: [
    { ticker: "AAA", shares: 100, avgCost: 200, price: 250, prevClose: 240, analyst: "Analyst One" },
    { ticker: "BBB", shares: 50, avgCost: 400, price: 300, prevClose: 310, analyst: "Analyst Two" },
  ],
  trades: [],
  waiting: [
    {
      side: "SELL",
      ticker: "BBB",
      shares: 50,
      firstProposed: "2026-10-20T14:40:00.000Z",
      times: 9,
      note: "BBB closed under your sell line again, and I proposed selling all 50 shares. Nothing new broke at the company today.",
      analyst: "Analyst Two",
    },
    { side: "BUY", ticker: "CCC", shares: 10, firstProposed: "2026-11-11T14:35:00.000Z", times: 1, note: "CCC crossed your buy level after a strong quarter.", analyst: "Analyst One" },
  ],
};

export const STANDIN_SNAPSHOT = buildSnapshot(STANDIN_INPUTS);
