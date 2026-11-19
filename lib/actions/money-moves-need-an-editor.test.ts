/**
 * Every action a browser can call that sells, cancels or moves an analyst
 * between Paper and Live: signed in, an owner or an editor, on your own account.
 *
 * Before this, Close and Cancel checked nothing (any position id sold, Live
 * included, as "your own click"), the reconcile actions and promote / demote /
 * delete took any member, and delete and cancel used Paper keys on Live
 * positions. The holdings are production's on 2026-11-19: PEAD Specialist,
 * Live, holding NVDA and IOT.
 */
let mockUser: { id: string } | null = { id: "owner_1" };
let mockRole: string | null = "OWNER";
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mockUser } }) } }) }));
jest.mock("@/lib/auth/account", () => ({
  getAccountId: async () => "acct_1",
  getUserRole: async () => mockRole,
  getOwnerUserId: async () => "owner_1",
}));

/** Every database call, as "model.op"; one that a test did not answer throws. */
const mockDb = jest.fn<unknown, [string, { where?: Record<string, unknown> }?]>();
const mockPrisma: Record<string, unknown> = new Proxy({}, {
  get: (_t, name: string) =>
    name === "$transaction"
      ? async (work: unknown) => (typeof work === "function" ? work(mockPrisma) : Promise.all(work as Promise<unknown>[]))
      : new Proxy({}, { get: (_m, op: string) => async (args: { where?: Record<string, unknown> }) => mockDb(`${name}.${op}`, args) }),
});
jest.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const mockBroker = jest.fn<Promise<unknown>, unknown[]>();
jest.mock("@/lib/alpaca", () => ({
  closePosition: (...a: unknown[]) => mockBroker("closePosition", ...a),
  cancelOrder: (...a: unknown[]) => mockBroker("cancelOrder", ...a),
  placeMarketOrder: (...a: unknown[]) => mockBroker("placeMarketOrder", ...a),
  getOrder: async () => ({ status: "canceled" }),
  getAllPositions: async () => [],
  getLatestPrice: async () => 100,
  getAccount: async () => ({}),
}));
const mockKeys = jest.fn(async (_userId: string, book?: string) => ({ keyId: `${book}_key`, secretKey: "s" }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: (u: string, b?: string) => mockKeys(u, b) }));
const mockCloseOpenPosition = jest.fn(async (..._a: unknown[]) => ({ kind: "closed" }));
jest.mock("@/lib/actions/closeTrade.actions", () => ({
  ...jest.requireActual("@/lib/actions/closeTrade.actions"),
  closeOpenPosition: (...a: unknown[]) => mockCloseOpenPosition(...a),
}));
jest.mock("next/cache", () => ({ revalidatePath: () => {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: () => ({}), send: async () => undefined } }));
jest.mock("@/lib/agent/triggers/seed-analyst", () => ({ seedAnalystTriggers: async () => {} }));

import { cancelTrade, closeTrade } from "@/lib/actions/trade.actions";
import { closeStaleDbRow, liquidateOrphan, trustAlpacaQty } from "@/lib/actions/sync-reconcile.actions";
import { closeAllLivePositionsAndDemote, demoteAnalystToPaper, promoteAnalystToLive } from "@/lib/actions/promote-analyst.actions";
import { deleteAnalyst } from "@/lib/actions/analyst.actions";

/** What the action said, whether it threw it or returned it. */
const said = (p: Promise<unknown>): Promise<string> =>
  p.then((r) => String((r as { error?: string; refused?: string } | undefined)?.error ?? (r as { refused?: string } | undefined)?.refused ?? "done"), (e: Error) => e.message);

beforeEach(() => {
  mockUser = { id: "owner_1" };
  mockRole = "OWNER";
  mockBroker.mockReset().mockResolvedValue({ id: "alp_1" });
  mockKeys.mockClear();
  mockCloseOpenPosition.mockClear();
  mockDb.mockReset().mockImplementation((call) => {
    throw new Error(`unanswered database call: ${call}`);
  });
});

const ACTIONS: Array<[string, () => Promise<unknown>]> = [
  ["Close a trade", () => closeTrade("pos_nvda", "MANUAL")],
  ["Cancel a trade", () => cancelTrade("pos_nvda")],
  ["Liquidate an orphan", () => liquidateOrphan("NVDA", "LIVE")],
  ["Close a stale row", () => closeStaleDbRow("pos_nvda")],
  ["Trust the broker's count", () => trustAlpacaQty("NVDA", "LIVE")],
  ["Promote to live", () => promoteAnalystToLive("analyst_pead")],
  ["Demote to paper", () => demoteAnalystToPaper("analyst_pead")],
  ["Close all and demote", () => closeAllLivePositionsAndDemote("analyst_pead")],
  ["Delete analyst", () => deleteAnalyst("analyst_pead")],
];

describe.each(ACTIONS)("%s", (_name, act) => {
  it("with nobody signed in: refused before the database or the broker is touched", async () => {
    mockUser = null;
    expect(await said(act())).toBe("Not authenticated");
    expect([mockDb.mock.calls, mockBroker.mock.calls, mockCloseOpenPosition.mock.calls]).toEqual([[], [], []]);
  });

  it("by a view-only member: refused before the database or the broker is touched", async () => {
    mockRole = "VIEWER";
    expect(await said(act())).toBe("View-only members can't do this.");
    expect([mockDb.mock.calls, mockBroker.mock.calls, mockCloseOpenPosition.mock.calls]).toEqual([[], [], []]);
  });
});

describe("Close and Cancel act only on your own account's positions", () => {
  it("another account's position id is not found, and nothing is sold", async () => {
    mockDb.mockImplementation((call) => (call === "position.findUnique" ? { accountId: "acct_other" } : undefined));
    expect(await said(closeTrade("pos_theirs", "MANUAL"))).toBe("Position not found");
    expect(await said(cancelTrade("pos_theirs"))).toBe("Position not found");
    expect(mockCloseOpenPosition).not.toHaveBeenCalled();
  });

  it("your own is sold as your own click", async () => {
    mockDb.mockImplementation((call) => (call === "position.findUnique" ? { accountId: "acct_1" } : undefined));
    await closeTrade("pos_nvda", "MANUAL");
    expect(mockCloseOpenPosition).toHaveBeenCalledWith("pos_nvda", "MANUAL", undefined, "user");
  });

  it("a reason the buttons never send is refused", async () => {
    expect(await said(closeTrade("pos_nvda", "ANYTHING" as never))).toBe("Unknown close reason");
  });
});

describe("Cancel uses the position's own book", () => {
  it("a Live position's pending order is looked up and cancelled with Live keys on Live", async () => {
    mockDb.mockImplementation((call) => {
      if (call === "position.findUnique") return { accountId: "acct_1" };
      if (call === "position.findUniqueOrThrow") return { id: "pos_nvda", userId: "owner_1", status: "OPEN", environment: "LIVE", avgCost: 150 };
      if (call === "order.findMany") return [{ id: "ord_1", alpacaOrderId: "alp_9", idempotencyKey: "idem", intent: "ADD", side: "BUY", quantity: 5 }];
      return {};
    });
    await cancelTrade("pos_nvda");
    expect(mockKeys).toHaveBeenCalledWith("owner_1", "LIVE");
    expect(mockBroker).toHaveBeenCalledWith("cancelOrder", "alp_9", { keyId: "LIVE_key", secretKey: "s" }, "LIVE");
  });
});

describe("Liquidate an orphan sells only what the app has no row for", () => {
  it("NVDA, which PEAD Specialist holds on Live, is refused: it is sold from its trade", async () => {
    mockDb.mockImplementation((call) => (call === "position.count" ? 1 : undefined));
    expect(await said(liquidateOrphan("nvda", "LIVE"))).toBe("NVDA is a position the app holds. Sell it from its trade.");
    expect(mockBroker).not.toHaveBeenCalled();
  });

  it("a holding with no row is sold on the book it was found in", async () => {
    mockDb.mockImplementation((call) => (call === "position.count" ? 0 : {}));
    await liquidateOrphan("XYZ", "LIVE");
    expect(mockBroker).toHaveBeenCalledWith("closePosition", "XYZ", { keyId: "LIVE_key", secretKey: "s" }, "LIVE");
  });
});

describe("Delete analyst never touches a Live holding", () => {
  const analyst = (positions: Array<Record<string, unknown>>) =>
    mockDb.mockImplementation((call) => {
      if (call === "agentConfig.findFirst") return { id: "analyst_pead", userId: "owner_1", name: "PEAD Specialist" };
      if (call === "position.findMany") return positions;
      return call.endsWith(".findMany") ? [] : {};
    });
  const writes = () => mockDb.mock.calls.map(([call]) => call).filter((c) => /delete/i.test(c));

  it("PEAD Specialist, holding NVDA and IOT on Live: refused, nothing deleted, nothing sent", async () => {
    analyst([{ id: "p1", symbol: "NVDA", status: "OPEN", environment: "LIVE" }, { id: "p2", symbol: "IOT", status: "OPEN", environment: "LIVE" }]);
    expect(await said(deleteAnalyst("analyst_pead"))).toBe("PEAD Specialist holds 2 Live positions (NVDA, IOT). Close them before deleting this analyst.");
    expect([writes(), mockBroker.mock.calls]).toEqual([[], []]);
  });

  it("a Paper analyst's open position is closed with Paper keys on Paper, then it is deleted", async () => {
    analyst([{ id: "p3", symbol: "MU", status: "OPEN", environment: "PAPER" }]);
    expect(await said(deleteAnalyst("analyst_pead"))).toBe("done");
    expect(mockBroker.mock.calls).toEqual([["closePosition", "MU", { keyId: "PAPER_key", secretKey: "s" }, "PAPER"]]);
    expect(writes()).toContain("agentConfig.delete");
  });
});
