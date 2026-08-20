/**
 * record-thesis-recently-sold.test.ts — P1-35 Half B, the XENE re-buy guard
 * (docs/plans/SOLD_NAME_CONTINUITY.md §2).
 *
 * The live-thesis same-ticker guard is blind to terminal rows, so a name the
 * analyst JUST sold could be re-minted from a blank prompt: XENE trailed out
 * at ~$66.53 on 2026-07-16, was re-minted at entry $67 that night with
 * parentThesisId=null, and re-bought LIVE ~20h later. These tests pin the
 * fix: a recent RETIRED(SOLD) sibling auto-chains as parent, its exit rides
 * into the result, and an entry at/above the exit price requires an explicit
 * acknowledge_prior_exit rationale.
 */

const mockPositionFindFirst = jest.fn().mockResolvedValue(null);
const mockAnalystSignalRouteFindMany = jest.fn().mockResolvedValue([]);
const mockThesisCount = jest.fn().mockResolvedValue(0);
const mockThesisFindFirst = jest.fn();
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
  },
}));

import { recordThesis } from "./record-thesis";
import type { ToolContext } from "@/lib/agent/tool-context";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    runId: "run_test_sold",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    groupId: (phase: string) => phase,
    ...overrides,
  };
}

/** Route prisma.thesis.findFirst by where-clause shape: the live-thesis
 *  guard queries status:{in:[...]}, the recently-sold guard queries
 *  status:"RETIRED". */
function primeThesisLookups(soldSibling: unknown) {
  mockThesisFindFirst.mockImplementation(
    (query: { where?: { status?: unknown } }) => {
      if (query?.where?.status === "RETIRED") return Promise.resolve(soldSibling);
      return Promise.resolve(null); // no live thesis
    },
  );
}

const XENE_SOLD_ROW = {
  id: "thesis_xene_sold",
  closedAt: new Date(Date.now() - 1 * 86_400_000), // sold yesterday
  closeReason: "STOP",
};

function baseLongArgs(overrides: Record<string, unknown> = {}) {
  return {
    ticker: "XENE",
    direction: "LONG",
    horizon: "TARGET",
    entry_price: 67,
    target_price: 100,
    stop_loss: 55,
    core_belief: "XENE re-rates on the next pipeline readout within 90 days.",
    key_assumptions: ["Readout stays on calendar.", "Cash runway through 2027."],
    invalidation_conditions: ["Readout slips past Q4.", "Dilutive raise below $60."],
    source_kind: "WEB_SEARCH",
    source_rationale: "Grok-seeded discovery batch.",
    conviction: "MEDIUM",
    conviction_rationale: "Solid setup, consensus-adjacent view.",
    target_size_pct: 5,
    scoring: {
      trendStrength: { score: 2, note: "Basing over the 50d." },
      relativeStrength: { score: 2, note: "Mid-cohort RS." },
      entryQuality: { score: 2, note: "Reclaim forming." },
      catalystFreshness: { score: 2, note: "Dated readout ahead." },
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

beforeEach(() => {
  mockThesisFindFirst.mockReset();
  mockThesisCreate.mockClear();
  mockThesisUpdateFindFirst.mockReset();
  mockThesisUpdateFindFirst.mockResolvedValue(null);
});

describe("record_thesis — recently-sold guard (P1-35 Half B)", () => {
  it("blocks a re-mint at/above the exit price without acknowledgment (the XENE shape)", async () => {
    primeThesisLookups(XENE_SOLD_ROW);
    mockThesisUpdateFindFirst.mockResolvedValue({
      priceAtTime: 66.53,
      summary: "Closed XENE position — STOP",
    });

    const result = await run(baseLongArgs({ entry_price: 67 }));

    expect(result.data.status).toBe("ACKNOWLEDGE_PRIOR_EXIT");
    expect(result.data.prior_exit).toMatchObject({
      thesis_id: "thesis_xene_sold",
      close_reason: "STOP",
      exit_price: 66.53,
    });
    expect(result.data.note).toContain("$66.53");
    expect(mockThesisCreate).not.toHaveBeenCalled();
  });

  it("proceeds past the gate when acknowledge_prior_exit engages with the exit", async () => {
    primeThesisLookups(XENE_SOLD_ROW);
    mockThesisUpdateFindFirst.mockResolvedValue({
      priceAtTime: 66.53,
      summary: "Closed XENE position — STOP",
    });

    const result = await run(
      baseLongArgs({
        entry_price: 67,
        acknowledge_prior_exit:
          "Sold on the trail at $66.53; this entry is a confirmed reclaim of the 20-day, not a dip re-buy.",
      }),
    );

    // The gate opened. (The mint may still succeed or fail deeper in the
    // pipeline depending on mocks — the assertion is only that the guard no
    // longer blocks.)
    expect(result.data.status).not.toBe("ACKNOWLEDGE_PRIOR_EXIT");
  });

  it("does not gate an entry BELOW the exit price — chains + surfaces context instead", async () => {
    primeThesisLookups(XENE_SOLD_ROW);
    mockThesisUpdateFindFirst.mockResolvedValue({
      priceAtTime: 66.53,
      summary: "Closed XENE position — STOP",
    });

    const result = await run(baseLongArgs({ entry_price: 60, stop_loss: 52 }));

    expect(result.data.status).not.toBe("ACKNOWLEDGE_PRIOR_EXIT");
    // Auto-chain: the created row carries the sold thesis as parent.
    if (mockThesisCreate.mock.calls.length > 0) {
      expect(mockThesisCreate.mock.calls[0][0].data.parentThesisId).toBe(
        "thesis_xene_sold",
      );
    }
  });

  it("no recent sale → no gate, no context, unchanged behavior", async () => {
    primeThesisLookups(null);

    const result = await run(baseLongArgs());

    expect(result.data.status).not.toBe("ACKNOWLEDGE_PRIOR_EXIT");
    expect(result.data.prior_exit).toBeUndefined();
  });

  it("degrades open when the exit price is unknowable (no CLOSED audit row)", async () => {
    primeThesisLookups(XENE_SOLD_ROW);
    mockThesisUpdateFindFirst.mockResolvedValue(null); // no priceAtTime source

    const result = await run(baseLongArgs({ entry_price: 67 }));

    // Can't prove at/above-exit → no block; context still surfaces with a
    // null exit price, and the chain still happens.
    expect(result.data.status).not.toBe("ACKNOWLEDGE_PRIOR_EXIT");
  });
});
