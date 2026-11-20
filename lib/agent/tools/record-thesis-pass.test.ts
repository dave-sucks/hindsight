/**
 * record-thesis-pass.test.ts — a PASS is terminal at write: it lands PASSED
 * with no triggers, and a PASS sent with triggers is refused.
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
  predicate: { watch: "price", is: "below", value: level },
  action: "REVIEW",
  rationale: `Interesting again if it comes in to $${level}.`,
});

function passArgs(overrides: Record<string, unknown> = {}) {
  return {
    ticker: "TOST",
    direction: "PASS",
    reasoning_summary:
      "Strong convergence in the low-attention cohort, but out of dispatch slots this run. Keeping eyes on it for a pullback.",
    source_kind: "WEB_SEARCH",
    source_rationale: "Discovery batch, capacity overflow.",
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
} {
  expect(mockThesisCreate).toHaveBeenCalled();
  return mockThesisCreate.mock.calls[0][0].data;
}

beforeEach(() => {
  mockThesisCreate.mockClear();
  mockThesisFindFirst.mockReset();
  mockThesisFindFirst.mockResolvedValue(null);
});

describe("record_thesis — a PASS is terminal", () => {
  it("a PASS sent with triggers is refused", async () => {
    const result = await run(passArgs({ triggers: [priceWake(24)] }));
    expect(result.data.status).toBe("FAILED");
    expect(result.data.note).toContain("terminal at write");
    expect(mockThesisCreate).not.toHaveBeenCalled();
  });

  it("a PASS without triggers lands PASSED", async () => {
    const result = await run(passArgs());
    expect(result.ok).toBe(true);
    const row = createdRow();
    expect(row.status).toBe("PASSED");
    expect(row.triggers).toEqual([]);
  });
});
