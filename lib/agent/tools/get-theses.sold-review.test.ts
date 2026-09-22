/**
 * get-theses.sold-review.test.ts — the sold-stock review reaches the run
 * under the name the prompt uses (DAV-240).
 *
 * The pure module decides WHAT to ask (sold-review.test.ts) and the prompt
 * tells the run what to do with it (system-prompt.sold-review.test.ts). This
 * is the seam between them: the tool actually emits `sold_to_review`, spelled
 * the way the prompt names it, with the sale's facts on it. A block the
 * response never carries — or carries under a different key — is a paragraph
 * of prompt pointing at nothing.
 *
 * Replay: SMMT, thesis cmtc1kp7o000l04ikm6kf9h1b, position
 * cmtiwz2ua000704l7l0z60jfl. RETIRED(SOLD) 2026-09-21 15:18:44Z at $16.9232
 * for +$1,157.94 (+17.9%) on a protective stop, eight weeks before the
 * November 14 PDUFA it was bought for. The two rows that landed after the
 * close — CLOSED at .537 and PROPOSAL_APPROVED at .852 — are the close's own
 * bookkeeping, not an answer.
 */

const mockThesisFindMany = jest.fn();
const mockThesisUpdateFindMany = jest.fn().mockResolvedValue([]);
const mockPositionFindMany = jest.fn();
const mockPositionCount = jest.fn().mockResolvedValue(0);
const mockOrderFindMany = jest.fn().mockResolvedValue([]);

jest.mock("@/lib/prisma", () => ({
  prisma: {
    thesis: { findMany: mockThesisFindMany },
    thesisUpdate: { findMany: mockThesisUpdateFindMany },
    position: { findMany: mockPositionFindMany, count: mockPositionCount },
    order: { findMany: mockOrderFindMany },
    agentConfig: { findMany: jest.fn().mockResolvedValue([]) },
    account: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));
jest.mock("@/lib/alpaca", () => ({
  getLatestPrices: jest.fn().mockResolvedValue({}),
  getBars: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/proposals/pending-entry", () => ({
  getPendingEntryTickers: jest.fn().mockResolvedValue(new Set()),
}));

import { getTheses } from "./get-theses";
import type { ToolContext } from "@/lib/agent/tool-context";

const ctx = {
  runId: "run_1",
  userId: "user_1",
  accountId: "account_1",
  analystId: "analyst_1",
  runMode: "MORNING_PLAN",
  groupId: (p: string) => p,
} as unknown as ToolContext;

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);
/** SMMT's real close, held at a fixed offset so the "sold today" wording is stable. */
const SOLD_AT = hoursAgo(20);

const SMMT_SOLD = {
  id: "cmtc1kp7o000l04ikm6kf9h1b",
  ticker: "SMMT",
  closedAt: SOLD_AT,
  closeReason: "STOP",
  catalystDate: new Date("2026-11-14T00:00:00Z"),
  // The close's own bookkeeping lands in the same second as the sale. The
  // scan filters to UPDATED / REVIEWED / STATUS_CHANGED, so an empty list
  // here is what production looks like the morning after a sale.
  updates: [],
};

const SMMT_POSITION = {
  symbol: "SMMT",
  closePrice: 16.9232,
  realizedPnl: 1157.94,
  avgCost: 14.3499,
  quantity: 450,
  orders: [{ closeBeliefSurvived: null }],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(args: Record<string, unknown> = {}): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = getTheses(ctx) as unknown as { execute: (a: any) => Promise<any> };
  return tool.execute(args);
}

beforeEach(() => {
  mockThesisUpdateFindMany.mockResolvedValue([]);
  mockOrderFindMany.mockResolvedValue([]);
  mockPositionCount.mockResolvedValue(0);
  // The live book is empty; the sold row comes back on the RETIRED scan.
  mockThesisFindMany.mockImplementation(async (a: { where?: { status?: unknown } }) =>
    a?.where?.status === "RETIRED" ? [SMMT_SOLD] : [],
  );
  mockPositionFindMany.mockImplementation(async (a: { where?: { status?: unknown } }) =>
    a?.where?.status === "CLOSED" ? [SMMT_POSITION] : [],
  );
});

describe("SMMT reaches the run as sold_to_review", () => {
  it("the response carries the block under the name the prompt uses", async () => {
    const res = await run();
    expect(res.data.sold_to_review).toEqual([
      expect.objectContaining({
        thesis_id: "cmtc1kp7o000l04ikm6kf9h1b",
        ticker: "SMMT",
        sold_on: SOLD_AT.toISOString().slice(0, 10),
        days_ago: 0,
      }),
    ]);
  });

  it("the ask carries the sale's own numbers and the catalyst still ahead", async () => {
    const { ask } = (await run()).data.sold_to_review[0];
    expect(ask).toContain("$16.92");
    expect(ask).toContain("+$1,158 (+17.9%)");
    expect(ask).toContain("on a stop");
    expect(ask).toContain("Its catalyst is still ahead — 2026-11-14.");
    expect(ask).toContain('update_thesis(change_status: "WATCHING")');
  });

  it("the run's summary says how many still owe a decision, and names them", async () => {
    expect((await run()).summary).toContain(
      "1 recently sold stock ($SMMT) still needs a keep-watching-or-let-it-go decision",
    );
  });

  it("a sale a run has already answered is gone from the block", async () => {
    mockThesisFindMany.mockImplementation(async (a: { where?: { status?: unknown } }) =>
      a?.where?.status === "RETIRED"
        ? [{ ...SMMT_SOLD, updates: [{ timestamp: new Date(SOLD_AT.getTime() + 3_600_000) }] }]
        : [],
    );
    const res = await run();
    expect(res.data.sold_to_review).toBeUndefined();
    expect(res.summary).not.toContain("keep-watching-or-let-it-go");
  });

  it("the close's own bookkeeping, in the same second, is not an answer", async () => {
    mockThesisFindMany.mockImplementation(async (a: { where?: { status?: unknown } }) =>
      a?.where?.status === "RETIRED"
        ? [{ ...SMMT_SOLD, updates: [{ timestamp: new Date(SOLD_AT.getTime() + 600) }] }]
        : [],
    );
    expect((await run()).data.sold_to_review).toHaveLength(1);
  });

  it("a ticker-filtered drill-down does not drag the sold book in", async () => {
    const res = await run({ tickers: ["AAA"] });
    expect(res.data.sold_to_review).toBeUndefined();
  });

  it("an explicit status scope is a deliberate read and skips it too", async () => {
    const res = await run({ status: ["WATCHING"] });
    expect(res.data.sold_to_review).toBeUndefined();
  });
});
