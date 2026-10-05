/**
 * run-input.fired.test.ts — the morning run's list of triggers fired since
 * its last run says each one in words.
 *
 * Storage hands every trigger back in the condition shape. The list used to
 * read the predicate's old `kind` field, which the shape doesn't have, so
 * every fire would have reached the run as "(predicate removed)".
 */

const fire = {
  thesisId: "thesis_1",
  triggerId: "floor",
  timestamp: new Date("2026-10-05T14:00:00Z"),
  summary: "",
  rationale: "Under the floor.",
  thesis: {
    ticker: "TRV",
    triggers: [{ id: "floor", action: "EXIT", predicate: { watch: "price", is: "below", value: 359.87 }, rationale: "Under the floor." }],
    triggerState: null,
    horizon: "TRADE",
    status: "WATCHING",
  },
};

// Every other read comes back empty: this test is about the fired list only.
const table = new Proxy(
  {},
  {
    get: (_t, op: string) => async () => (op === "findMany" ? [] : op === "count" ? 0 : null),
  },
);
jest.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, name: string) => {
        if (name === "agentConfig") return { findFirst: async () => ({ id: "analyst_1", userId: "u", name: "Test" }) };
        if (name === "thesisUpdate") return { findMany: async () => [fire] };
        return table;
      },
    },
  ),
}));
jest.mock("@/lib/alpaca", () => ({ getLatestPrices: async () => ({}), getAccount: async () => null }));
jest.mock("@/lib/agent/triggers/load-levels", () => ({
  ...jest.requireActual("@/lib/agent/triggers/load-levels"),
  loadLevelSources: async () => new Map(),
}));
jest.mock("@/lib/agent/triggers/earnings", () => ({
  ...jest.requireActual("@/lib/agent/triggers/earnings"),
  fetchEarningsWindow: async () => ({ reported: new Map(), upcoming: new Map() }),
}));
jest.mock("@/lib/agent/filings-on-book", () => ({ filingsOnBook: async () => [] }));
jest.mock("@/lib/agent/gate-rejections", () => ({ listOpenRefusalsForAnalyst: async () => [] }));

import { buildRunInput } from "./run-input";

it("a fired trigger reaches the run as its sentence, not as a removed condition", async () => {
  const input = await buildRunInput("analyst_1", "u");
  expect(input.triggersFiredSinceLastRun).toEqual([
    expect.objectContaining({ ticker: "TRV", triggerId: "floor", action: "EXIT", predicateSummary: "Take the plan down if below $359.87" }),
  ]);
});
