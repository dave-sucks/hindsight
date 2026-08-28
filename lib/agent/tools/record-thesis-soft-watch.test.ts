/**
 * record-thesis-soft-watch.test.ts — the W2 soft-watch mint path
 * (DAV-209, docs/plans/WATCHLIST_STATES.md §2/§5 W2).
 *
 * PASS + status:"WATCHING" = the soft watch: "researched, decided not to
 * trade, keep eyes on it." Stored as direction null / status WATCHING with
 * REVIEW-only wake triggers, unpriced, no cadence stamp. These tests pin the
 * shape gates (wake invariant, REVIEW-only, unpriced), the storage shape,
 * the already-covered redirect, and that terminal PASS is unchanged.
 */

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
  },
}));

import { recordThesis } from "./record-thesis";
import type { ToolContext } from "@/lib/agent/tool-context";
import type { Trigger } from "@/lib/agent/triggers/types";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    runId: "run_test_soft",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    groupId: (phase: string) => phase,
    ...overrides,
  };
}

const priceWake = (level: number, id = "wake-price"): Record<string, unknown> => ({
  id,
  predicate: { kind: "PRICE_BELOW", level },
  action: "REVIEW",
  rationale: `Interesting again if it comes in to $${level}.`,
});

function softWatchArgs(overrides: Record<string, unknown> = {}) {
  return {
    ticker: "TOST",
    direction: "PASS",
    status: "WATCHING",
    reasoning_summary:
      "Strong convergence in the low-attention cohort, but out of dispatch slots this run. Keeping eyes on it for a pullback.",
    source_kind: "WEB_SEARCH",
    source_rationale: "Discovery batch, capacity overflow.",
    triggers: [priceWake(24)],
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(args: Record<string, unknown>): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = recordThesis(makeCtx()) as unknown as { execute: (a: any) => Promise<any> };
  return tool.execute(args);
}

function createdRow(): {
  direction: unknown;
  status: unknown;
  triggers: Trigger[];
  entryPrice: unknown;
  stopLoss: unknown;
} {
  expect(mockThesisCreate).toHaveBeenCalled();
  return mockThesisCreate.mock.calls[0][0].data;
}

beforeEach(() => {
  mockThesisCreate.mockClear();
  mockThesisFindFirst.mockReset();
  mockThesisFindFirst.mockResolvedValue(null);
});

describe("record_thesis — soft watch (W2, DAV-209)", () => {
  it("mints direction null / status WATCHING with the wake triggers, unpriced, no cadence", async () => {
    const result = await run(softWatchArgs());
    expect(result.ok).toBe(true);

    const row = createdRow();
    expect(row.direction).toBeNull();
    expect(row.status).toBe("WATCHING");
    expect(row.entryPrice).toBeNull();
    expect(row.stopLoss).toBeNull();

    const kinds = row.triggers.map((t) => `${t.action}:${t.predicate.kind}`);
    expect(kinds).toEqual(["REVIEW:PRICE_BELOW"]);
    // No cadence stamped — a soft watch costs no review attention.
    expect(
      row.triggers.some((t) => t.predicate.kind === "REVIEW_CADENCE"),
    ).toBe(false);
  });

  it("rejects a soft watch with no wake condition (invariant 1)", async () => {
    const result = await run(softWatchArgs({ triggers: [] }));
    expect(result.data.status).toBe("FAILED");
    expect(result.data.note).toContain("what brings this back to me?");
    expect(mockThesisCreate).not.toHaveBeenCalled();
  });

  it("rejects non-REVIEW actions — a soft watch has no plan to act on", async () => {
    const result = await run(
      softWatchArgs({
        triggers: [
          {
            id: "bad-enter",
            predicate: { kind: "PRICE_BELOW", level: 24 },
            action: "ENTER",
            rationale: "Buy the dip.",
          },
        ],
      }),
    );
    expect(result.data.status).toBe("FAILED");
    expect(result.data.note).toContain("REVIEW");
    expect(mockThesisCreate).not.toHaveBeenCalled();
  });

  it("rejects price levels — a soft watch is unpriced by definition", async () => {
    const result = await run(softWatchArgs({ entry_price: 24 }));
    expect(result.data.status).toBe("FAILED");
    expect(result.data.note).toContain("don't belong on a soft watch");
    expect(mockThesisCreate).not.toHaveBeenCalled();
  });

  it("allows an explicit REVIEW_CADENCE — an unpriced managed watch is legal", async () => {
    const result = await run(
      softWatchArgs({
        triggers: [
          {
            id: "own-clock",
            predicate: { kind: "REVIEW_CADENCE", days: 30 },
            action: "REVIEW",
            rationale: "Look monthly whether the cohort has moved.",
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    const row = createdRow();
    expect(row.triggers.map((t) => t.predicate.kind)).toEqual(["REVIEW_CADENCE"]);
  });

  it("redirects to update_thesis when the name is already covered", async () => {
    mockThesisFindFirst.mockImplementation(
      (query: { where?: { status?: unknown } }) => {
        const s = query?.where?.status as { in?: string[] } | string | undefined;
        if (typeof s === "object" && s?.in?.includes("WATCHING")) {
          return Promise.resolve({
            id: "thesis_existing",
            direction: "LONG",
            status: "WATCHING",
          });
        }
        return Promise.resolve(null);
      },
    );
    const result = await run(softWatchArgs());
    expect(result.data.status).toBe("USE_UPDATE_THESIS");
    expect(result.data.existing_thesis_id).toBe("thesis_existing");
    expect(result.data.note).toContain("DEMOTE");
    expect(mockThesisCreate).not.toHaveBeenCalled();
  });

  it("terminal PASS is unchanged: triggers still rejected, no status field needed", async () => {
    const result = await run(
      softWatchArgs({ status: undefined, triggers: [priceWake(24)] }),
    );
    expect(result.data.status).toBe("FAILED");
    expect(result.data.note).toContain("SOFT WATCH");
    expect(mockThesisCreate).not.toHaveBeenCalled();
  });

  it("terminal PASS without triggers still lands PASSED", async () => {
    const result = await run(
      softWatchArgs({ status: undefined, triggers: undefined }),
    );
    expect(result.ok).toBe(true);
    const row = createdRow();
    expect(row.status).toBe("PASSED");
    expect(row.triggers).toEqual([]);
  });
});
