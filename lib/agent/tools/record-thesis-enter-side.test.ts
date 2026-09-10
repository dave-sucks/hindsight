/**
 * record-thesis-enter-side.test.ts — the buy level's side is read off a
 * price, never guessed.
 *
 * The HPE shape (2026-09-09): the writer wrote "pullback entry at $54.75"
 * with the stock at $57.08. record_thesis's own quote failed (three writers
 * hitting the vendor at once), the old fail-open picked "breakout", and the
 * row stored ENTER PRICE_ABOVE 54.75 — a buy that could only fire after a
 * dip below and a re-cross. DOCU and FIVE in the same batch got a quote and
 * the right side. These tests pin the fix: the caller's `current_price`
 * stands in for a failed quote, and with neither the mint is refused.
 */

const mockGetStockQuote = jest.fn();
jest.mock("@/lib/actions/finnhub.actions", () => ({
  getStockQuote: (...a: unknown[]) => mockGetStockQuote(...a),
}));

const mockPositionFindFirst = jest.fn().mockResolvedValue(null);
const mockAnalystSignalRouteFindMany = jest.fn().mockResolvedValue([]);
const mockThesisCount = jest.fn().mockResolvedValue(0);
const mockThesisFindFirst = jest.fn().mockResolvedValue(null);
const mockThesisUpdateFindFirst = jest.fn().mockResolvedValue(null);
const mockThesisUpdateCreate = jest.fn().mockResolvedValue({ id: "tu_1" });
const mockAgentConfigFindFirst = jest.fn().mockResolvedValue({
  id: "analyst_1",
  enabled: true,
  archetype: "GROWTH",
  holdDurations: ["DAY", "SWING", "POSITION"],
});
const mockThesisCreate = jest.fn().mockResolvedValue({ id: "thesis_new_1" });
const mockThesisUpdate = jest.fn().mockResolvedValue({});

jest.mock("@/lib/prisma", () => ({
  prisma: {
    position: { findFirst: mockPositionFindFirst },
    analystSignalRoute: { findMany: mockAnalystSignalRouteFindMany },
    thesis: {
      count: mockThesisCount,
      findFirst: mockThesisFindFirst,
      create: mockThesisCreate,
      update: mockThesisUpdate,
    },
    thesisUpdate: {
      findFirst: mockThesisUpdateFindFirst,
      create: mockThesisUpdateCreate,
    },
    agentConfig: { findFirst: mockAgentConfigFindFirst },
    runEvent: { create: jest.fn().mockResolvedValue({}) },
  },
}));

import { recordThesis } from "./record-thesis";
import type { ToolContext } from "@/lib/agent/tool-context";
import type { Trigger } from "@/lib/agent/triggers/types";

function makeCtx(): ToolContext {
  return {
    runId: "run_test_enter_side",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    groupId: (phase: string) => phase,
  };
}

/** HPE as minted 2026-09-09: pullback plan, price above the level. */
function hpeArgs(overrides: Record<string, unknown> = {}) {
  return {
    ticker: "HPE",
    direction: "LONG",
    horizon: "TARGET",
    entry_price: 54.75,
    target_price: 64,
    stop_loss: 50.35,
    core_belief: "Clean beat-and-raise; the gap-down was emotional and the drift resumes.",
    key_assumptions: ["Estimate revisions keep flowing.", "No guidance walk-back."],
    invalidation_conditions: ["Close below $50.35.", "FY27 framework withdrawn."],
    source_kind: "WEB_SEARCH",
    source_rationale: "Discovery batch.",
    conviction: "MEDIUM",
    conviction_rationale: "Non-standard reaction, strong print.",
    scoring: {
      trendStrength: { score: 2, note: "Above both SMAs." },
      relativeStrength: { score: 1, note: "Lags DELL." },
      entryQuality: { score: 1, note: "Pullback to the 20-day." },
      catalystFreshness: { score: 2, note: "Day 7 post-print." },
    },
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(args: Record<string, unknown>): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = recordThesis(makeCtx()) as unknown as { execute: (a: any) => Promise<any> };
  return tool.execute(args);
}

function enterRung(): Trigger {
  expect(mockThesisCreate).toHaveBeenCalled();
  const data = mockThesisCreate.mock.calls[0][0].data as { triggers: Trigger[] };
  const enter = (data.triggers ?? []).find((t) => t.action === "ENTER");
  expect(enter).toBeDefined();
  return enter as Trigger;
}

beforeEach(() => {
  mockThesisCreate.mockClear();
  mockGetStockQuote.mockReset();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

describe("record_thesis — the buy level's side needs a price", () => {
  it("quote fails, current_price passed → pullback level below the price is PRICE_BELOW (the HPE shape)", async () => {
    mockGetStockQuote.mockRejectedValue(new Error("429"));
    const result = await run(hpeArgs({ current_price: 57.08 }));
    expect(result.ok).toBe(true);
    expect(enterRung().predicate).toEqual({ kind: "PRICE_BELOW", level: 54.75 });
  });

  it("quote fails, current_price passed → level above the price is PRICE_ABOVE (a breakout)", async () => {
    mockGetStockQuote.mockResolvedValue(null);
    const result = await run(hpeArgs({ entry_price: 60, target_price: 80, stop_loss: 54, current_price: 57.08 }));
    expect(result.ok).toBe(true);
    expect(enterRung().predicate).toEqual({ kind: "PRICE_ABOVE", level: 60 });
  });

  it("a live quote wins over current_price", async () => {
    mockGetStockQuote.mockResolvedValue({ c: 57.08 });
    const result = await run(hpeArgs({ current_price: 50 })); // stale hint says breakout; the quote says pullback
    expect(result.ok).toBe(true);
    expect(enterRung().predicate).toEqual({ kind: "PRICE_BELOW", level: 54.75 });
  });

  it("no quote and no current_price → a priced mint is refused, nothing is written", async () => {
    mockGetStockQuote.mockRejectedValue(new Error("timeout"));
    const result = await run(hpeArgs());
    expect(result.data.status).toBe("NO_LIVE_PRICE");
    expect(result.data.thesis_id).toBeNull();
    expect(result.data.note).toContain("current_price");
    expect(mockThesisCreate).not.toHaveBeenCalled();
  });

  it("no price is fine when there is no buy level to place", async () => {
    mockGetStockQuote.mockRejectedValue(new Error("timeout"));
    const result = await run(
      hpeArgs({ entry_price: undefined, target_price: undefined, stop_loss: undefined }),
    );
    expect(result.ok).toBe(true);
    expect(mockThesisCreate).toHaveBeenCalled();
  });
});
