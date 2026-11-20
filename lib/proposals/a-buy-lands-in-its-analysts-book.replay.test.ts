/**
 * A new buy lands in its analyst's own book, on its own account.
 *
 * A run page's composer stays live after the run ends, and a proposal waits
 * in the queue. Promote or demote the analyst in between and the old run, or
 * the old proposal, would buy in the book the analyst has left: a Paper
 * holding under a Live analyst, its thesis marked held. Both are refused now,
 * through place_trade's and the approval's real entry points.
 */
import { prismaDouble, replayTool, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_USER_ID } from "@/lib/replay";

const APPROVALS = { requireApprovalBuysPaper: false, requireApprovalSellsPaper: false, requireApprovalBuysLive: true, requireApprovalSellsLive: true };

/** DOCU's buy at $62.50, as a run sends it, for an analyst that trades on `analystBook`, from a run opened on `runBook`. */
const buy = (runBook: "PAPER" | "LIVE", analyst: Record<string, unknown>) =>
  replayTool("place-trade", "placeTrade", {
    seed: {
      thesis: [thesisRow({ id: "thesis_DOCU", ticker: "DOCU", status: "WATCHING", direction: "LONG", setupId: "PEAD", conviction: "MEDIUM" })],
      agentConfig: [agentConfigRow({ name: "PEAD Specialist", ...analyst })],
      account: [accountRow(APPROVALS)],
    },
    args: { ticker: "DOCU", direction: "LONG", entry_price: 62.5, sell_if_below: 58.6, sell_reason: "Under the gap-day low.", thesis_id: "thesis_DOCU" },
    ctx: { runMode: "INTRADAY_TACTICAL", runEnvironment: runBook },
    quotes: { DOCU: 62.5 },
  });

describe("place_trade: the run's book is the analyst's book", () => {
  it("a run opened on Paper, the analyst since promoted to Live: refused, nothing written, nothing sent", async () => {
    const r = await buy("PAPER", { tradingEnvironment: "LIVE" });
    expect(r.result.data?.message).toBe("Trade blocked: this run was opened on Paper and PEAD Specialist now trades on Live. Start a new run to buy it.");
    expect([r.db.store.position ?? [], r.db.store.order ?? [], r.sends]).toEqual([[], [], []]);
  });

  it("the mirror, a Live run for an analyst since demoted to Paper: refused", async () => {
    const r = await buy("LIVE", { tradingEnvironment: "PAPER" });
    expect(r.result.data?.message).toMatch(/opened on Live and PEAD Specialist now trades on Paper/);
    expect(r.db.store.position ?? []).toEqual([]);
  });

  it("an analyst on another account: refused", async () => {
    const r = await buy("PAPER", { tradingEnvironment: "PAPER", accountId: "account_other" });
    expect(r.result.data?.message).toBe("Trade blocked: that analyst is not on this account.");
    expect(r.db.store.position ?? []).toEqual([]);
  });

  it("the same book goes on: with Paper approval off, the buy is written on Paper and sent", async () => {
    const r = await buy("PAPER", { tradingEnvironment: "PAPER" });
    expect(String(r.result.data?.message ?? "")).not.toMatch(/opened on|not on this account/);
    expect((r.db.store.position as Array<{ environment: string }>)[0].environment).toBe("PAPER");
    expect((r.db.store.order as Array<{ environment: string; status: string }>)[0]).toMatchObject({ environment: "PAPER", status: "PENDING" });
    expect(r.sends.map((s) => [s.fn, s.args[2]])).toEqual([["placeMarketOrder", "PAPER"]]);
  });
});

describe("approving a buy proposed before a demote", () => {
  it("WST, proposed on Live, its analyst now on Paper: refused, the proposal is left waiting, nothing is sent", async () => {
    const position = positionRow({ id: "pos_wst", symbol: "WST", status: "PENDING_APPROVAL", environment: "LIVE", analyst: { name: "PEAD Specialist", tradingEnvironment: "PAPER" } });
    const db = prismaDouble({
      position: [position],
      order: [{ id: "order_WST", positionId: "pos_wst", position, userId: REPLAY_USER_ID, environment: "LIVE", symbol: "WST", side: "BUY", orderType: "MARKET", quantity: 10, status: "AWAITING_APPROVAL", intent: "OPEN", idempotencyKey: "idem-wst", triggerIds: [], expiresAt: null, createdAt: new Date() }],
    });
    const sent = jest.fn();
    let refusal: { code?: string; message?: string } = {};
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => ({ keyId: "AK", secretKey: "s", baseUrl: "https://api.alpaca.markets" }) }));
      jest.doMock("@/lib/alpaca", () => ({ placeMarketOrder: sent, closePositionPartial: sent, getLatestPrice: async () => 415 }));
      jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: () => ({}), send: jest.fn() } }));
      const { approveProposal } = await import("./execute");
      refusal = await approveProposal("order_WST", REPLAY_USER_ID).then(() => ({}), (e) => e);
    });
    expect(refusal.code).toBe("WRONG_BOOK");
    expect(refusal.message).toBe("This buy was proposed on Live and PEAD Specialist now trades on Paper. Decline it; a new run proposes it in the right account.");
    expect((db.store.order as Array<{ status: string }>)[0].status).toBe("AWAITING_APPROVAL");
    expect(sent).not.toHaveBeenCalled();
  });
});
