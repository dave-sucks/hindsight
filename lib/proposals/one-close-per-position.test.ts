/**
 * one-close-per-position.test.ts — replay of SMMT, LIVE, 2026-09-15 16:45:24 UTC.
 *
 * The $17.40 floor (PRICE_BELOW) and the 8% trail (TRAILING_FROM_HIGH) fired on
 * the same trigger check. Two DIRECT tactical runs started 122 ms apart and
 * each called closeOpenPosition(price_monitor, STOP); two 450-share close
 * proposals landed 180 ms apart on a 450-share position:
 *   cmu2wkntn000204jpapem7hp3  "Floor — sell if the price drops to $17.40…"
 *   cmu2wknyg000404jpn5j6l6o3  "If $SMMT gives back 8% from the high…"
 * approveProposal checked only the order's own status, so approving both
 * before the first fill would have sent a second whole-position market sell.
 *
 * DAV-282 (second block): every sale sells only what is still held. A full
 * close is a market sell of the share count it carries and so is a trim — a
 * count from before a trim filled sells shares that are gone (a short on a
 * margin account).
 *
 * The fake database below keeps rows in memory and models the one Postgres
 * behavior the fix relies on: `SELECT … FOR NO KEY UPDATE` on a Position row
 * blocks a second transaction until the first ends.
 */

type Row = Record<string, unknown>;

const POSITION_ID = "cmtiwz2ua000704l7l0z60jfl";
const THESIS_ID = "cmtc1kp7o000l04ikm6kf9h1b";
const ACCOUNT_ID = "34f5c589-e216-4afe-9ee8-613c13f300e7";
const FLOOR_ORDER = "cmu2wkntn000204jpapem7hp3";
const TRAIL_ORDER = "cmu2wknyg000404jpn5j6l6o3";
const FLOOR_RATIONALE =
  "Floor — sell if the price drops to $17.40. Below this the plan is wrong.";
const TRAIL_RATIONALE =
  "If $SMMT gives back 8% from the high after this breakout, protect the gain rather than let momentum fully unwind.";

const db = {
  orders: [] as Row[],
  positions: new Map<string, Row>(),
  events: [] as Row[],
  account: {} as Row,
  /** One-shot: runs the moment something reads the account's approval settings. */
  onAccountRead: null as (() => Promise<unknown>) | null,
};

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; not?: unknown };
      if (c.in) return c.in.includes(value);
      if ("not" in c) return value !== c.not;
    }
    return value === cond;
  });
}

let seq = 0;
const orderModel = {
  findFirst: async ({ where }: { where: Row }) => {
    const hit = db.orders.find((o) => matches(o, where));
    return hit ? { ...hit } : null;
  },
  findMany: async ({ where }: { where: Row }) =>
    db.orders.filter((o) => matches(o, where)).map((o) => ({ ...o })),
  findUnique: async ({ where }: { where: { id: string } }) => {
    const hit = db.orders.find((o) => o.id === where.id);
    return hit
      ? { ...hit, position: { ...db.positions.get(hit.positionId as string) } }
      : null;
  },
  create: async ({ data }: { data: Row }) => {
    const row = { id: `order-${++seq}`, createdAt: new Date(), ...data };
    db.orders.push(row);
    return { ...row };
  },
  update: async ({ where, data }: { where: { id: string }; data: Row }) => {
    const row = db.orders.find((o) => o.id === where.id)!;
    Object.assign(row, data);
    return { ...row };
  },
  updateMany: async ({ where, data }: { where: Row; data: Row }) => {
    const hits = db.orders.filter((o) => matches(o, where));
    hits.forEach((o) => Object.assign(o, data));
    return { count: hits.length };
  },
};
const positionModel = {
  findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({
    ...db.positions.get(where.id)!,
  }),
  findUnique: async ({ where }: { where: { id: string } }) => {
    const hit = db.positions.get(where.id);
    return hit ? { ...hit } : null;
  },
  findFirst: async ({ where }: { where: Row }) => {
    const hit = [...db.positions.values()].find((p) => matches(p, where));
    return hit ? { ...hit, analyst: { name: "Secular Compounder" } } : null;
  },
  update: async ({ where, data }: { where: { id: string }; data: Row }) => {
    const row = db.positions.get(where.id)!;
    for (const [key, value] of Object.entries(data)) {
      const dec = (value as { decrement?: number } | null)?.decrement;
      row[key] = dec != null ? (row[key] as number) - dec : value;
    }
    return { ...row };
  },
};
const recordEvent = async ({ data }: { data: Row }) => {
  db.events.push(data);
  return data;
};

// Row locks: position id → promise that resolves when the holder's tx ends.
const rowLocks = new Map<string, Promise<void>>();

function makeTx(held: Map<string, () => void>) {
  return {
    $queryRaw: async (_sql: TemplateStringsArray, positionId: string) => {
      if (held.has(positionId)) return [];
      while (rowLocks.has(positionId)) await rowLocks.get(positionId);
      let release!: () => void;
      rowLocks.set(positionId, new Promise<void>((r) => (release = r)));
      held.set(positionId, () => {
        rowLocks.delete(positionId);
        release();
      });
      return [];
    },
    order: orderModel,
    position: positionModel,
    positionEvent: { create: recordEvent },
    positionManagementAction: { create: recordEvent },
    runEvent: { create: recordEvent },
    tradeDecision: { create: recordEvent },
  };
}

jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: {
      findUnique: async () => {
        const hook = db.onAccountRead;
        db.onAccountRead = null;
        await hook?.();
        return { ...db.account };
      },
    },
    order: orderModel,
    position: positionModel,
    positionEvent: { create: recordEvent },
    runEvent: { create: recordEvent },
    gateRejection: { create: recordEvent },
    thesis: { findFirst: async () => ({ id: THESIS_ID }), findUnique: async () => null },
    researchRun: { findUnique: async () => null },
    agentConfig: { findUnique: async () => ({ emailAlerts: false }) },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const held = new Map<string, () => void>();
      try {
        return await cb(makeTx(held));
      } finally {
        held.forEach((release) => release());
      }
    },
  },
}));

const mockPlaceMarketOrder = jest.fn();
const mockClosePositionPartial = jest.fn();
const mockGetOrder = jest.fn();
jest.mock("@/lib/alpaca", () => ({
  placeMarketOrder: (...a: unknown[]) => mockPlaceMarketOrder(...a),
  closePositionPartial: (...a: unknown[]) => mockClosePositionPartial(...a),
  getOrder: (...a: unknown[]) => mockGetOrder(...a),
  getLatestPrice: async () => 17.3,
  cancelOrder: jest.fn(),
}));
jest.mock("@/lib/actions/api-keys.actions", () => ({
  resolveAlpacaCredentials: async () => undefined,
}));
jest.mock("@/lib/proposals/thesis-flips", () => ({
  promoteThesisOnApproval: jest.fn(),
  closeThesisOnApproval: jest.fn(),
  closeThesisForPosition: jest.fn(),
}));
jest.mock("@/lib/agent/thesis-updates", () => ({
  writeThesisUpdate: jest.fn().mockResolvedValue("tu-1"),
}));
jest.mock("@/lib/emails/proposal-pending", () => ({
  sendProposalPendingEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/notify/proposal-push", () => ({
  sendProposalPendingPush: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/inngest/client", () => ({ inngest: { send: jest.fn() } }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }));
jest.mock("@/lib/emails/recipients", () => ({ getEmailRecipients: async () => [] }));
jest.mock("@/lib/emails/trade-closed", () => ({ tradeClosedHtml: () => "" }));
jest.mock("@/lib/email-suppression", () => ({ isInsideMorningBatch: () => false }));

import { closeOpenPosition } from "@/lib/actions/closeTrade.actions";
import { managePosition } from "@/lib/agent/tools/manage-position";
import type { ToolContext } from "@/lib/agent/tool-context";
import { approveProposal } from "./execute";

function closeOrder(
  id: string,
  status: string,
  rationale: string,
  intent = "CLOSE",
  quantity = intent === "CLOSE" ? 450 : 100,
): Row {
  return {
    id,
    positionId: POSITION_ID,
    userId: ACCOUNT_ID,
    environment: "LIVE",
    symbol: "SMMT",
    side: "SELL",
    orderType: "MARKET",
    quantity,
    status,
    intent,
    idempotencyKey: `idem-${id}`,
    closeReason: "STOP",
    closeSource: "price_monitor",
    closeBeliefSurvived: null,
    thesisId: THESIS_ID,
    rationale,
    expiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000),
    createdAt: new Date(),
  };
}

const openCloses = (status: string) =>
  db.orders.filter((o) => o.intent === "CLOSE" && o.status === status);

beforeEach(() => {
  jest.clearAllMocks();
  seq = 0;
  db.orders = [];
  db.events = [];
  db.onAccountRead = null;
  db.account = { requireApprovalSellsLive: true, requireApprovalBuysLive: true };
  db.positions = new Map([
    [
      POSITION_ID,
      {
        id: POSITION_ID,
        accountId: ACCOUNT_ID,
        userId: ACCOUNT_ID,
        analystId: "cmmmh0wxu000004js7yoyzvlf",
        symbol: "SMMT",
        direction: "LONG",
        status: "OPEN",
        environment: "LIVE",
        quantity: 450,
        avgCost: 14.35,
        stopLoss: 17.4,
        targetPrice: 26,
        peakPrice: 18.725,
        openedAt: new Date("2026-09-01T21:15:27.803Z"),
      },
    ],
  ]);
  mockPlaceMarketOrder.mockImplementation(async (o: { clientOrderId: string }) => ({
    id: `alpaca-${o.clientOrderId}`,
  }));
  mockClosePositionPartial.mockResolvedValue({ id: "alpaca-trim" });
});

describe("SMMT 2026-09-15 — two sell rules on one trigger check", () => {
  it("stages one close proposal, not two", async () => {
    const [floor, trail] = await Promise.all([
      closeOpenPosition(POSITION_ID, "STOP", undefined, "price_monitor", FLOOR_RATIONALE, "cmu2wkn46000b04jqkl18mu5k"),
      closeOpenPosition(POSITION_ID, "STOP", undefined, "price_monitor", TRAIL_RATIONALE, "cmu2wkn7k000004jp9jdsdt53"),
    ]);

    expect(openCloses("AWAITING_APPROVAL")).toHaveLength(1);
    expect(floor.kind).toBe("proposed");
    expect(trail.kind).toBe("proposed");
    if (floor.kind === "proposed" && trail.kind === "proposed") {
      expect(trail.proposal.orderId).toBe(floor.proposal.orderId);
      expect(trail.proposal.rationale).toBe(FLOOR_RATIONALE);
    }
    expect(mockPlaceMarketOrder).not.toHaveBeenCalled();
  });

  it("approving both twins at once sends one sell", async () => {
    db.orders.push(
      closeOrder(FLOOR_ORDER, "AWAITING_APPROVAL", FLOOR_RATIONALE),
      closeOrder(TRAIL_ORDER, "AWAITING_APPROVAL", TRAIL_RATIONALE),
    );

    const results = await Promise.allSettled([
      approveProposal(FLOOR_ORDER, ACCOUNT_ID),
      approveProposal(TRAIL_ORDER, ACCOUNT_ID),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(mockPlaceMarketOrder).toHaveBeenCalledTimes(1);
    expect(openCloses("PENDING")).toHaveLength(1);
  });

  it("approving one twin cancels the other before any fill", async () => {
    db.orders.push(
      closeOrder(FLOOR_ORDER, "AWAITING_APPROVAL", FLOOR_RATIONALE),
      closeOrder(TRAIL_ORDER, "AWAITING_APPROVAL", TRAIL_RATIONALE),
    );

    await approveProposal(FLOOR_ORDER, ACCOUNT_ID);

    const trail = db.orders.find((o) => o.id === TRAIL_ORDER)!;
    expect(trail.status).toBe("CANCELLED");
    expect(trail.rejectionMessage).toContain(FLOOR_ORDER);
    await expect(approveProposal(TRAIL_ORDER, ACCOUNT_ID)).rejects.toMatchObject({
      code: "NOT_AWAITING",
    });
    expect(mockPlaceMarketOrder).toHaveBeenCalledTimes(1);
  });

  it("refuses a close proposal while another close is already submitted", async () => {
    db.orders.push(
      closeOrder(FLOOR_ORDER, "PENDING", FLOOR_RATIONALE),
      closeOrder(TRAIL_ORDER, "AWAITING_APPROVAL", TRAIL_RATIONALE),
    );

    await expect(approveProposal(TRAIL_ORDER, ACCOUNT_ID)).rejects.toMatchObject({
      code: "SALE_UNDER_WAY",
    });
    expect(db.orders.find((o) => o.id === TRAIL_ORDER)!.status).toBe("AWAITING_APPROVAL");
    expect(mockPlaceMarketOrder).not.toHaveBeenCalled();
  });

  it("refuses a trim while the full close is submitted, but lets trims stack", async () => {
    db.orders.push(
      closeOrder(FLOOR_ORDER, "PENDING", FLOOR_RATIONALE),
      closeOrder("trim-1", "AWAITING_APPROVAL", "trim", "PARTIAL_CLOSE"),
    );
    await expect(approveProposal("trim-1", ACCOUNT_ID)).rejects.toMatchObject({
      code: "SALE_UNDER_WAY",
    });

    db.orders = [
      closeOrder("trim-0", "PENDING", "trim", "PARTIAL_CLOSE"),
      closeOrder("trim-1", "AWAITING_APPROVAL", "trim", "PARTIAL_CLOSE"),
    ];
    await approveProposal("trim-1", ACCOUNT_ID);
    expect(mockClosePositionPartial).toHaveBeenCalledTimes(1);
  });

  it("with approval off, a second close while one is submitted sends nothing", async () => {
    db.account = { requireApprovalSellsLive: false };
    db.orders.push(closeOrder(FLOOR_ORDER, "PENDING", FLOOR_RATIONALE));

    const outcome = await closeOpenPosition(POSITION_ID, "STOP", undefined, "price_monitor", TRAIL_RATIONALE);

    expect(outcome).toMatchObject({ kind: "closed", fillStatus: "PENDING", orderId: FLOOR_ORDER });
    expect(mockPlaceMarketOrder).not.toHaveBeenCalled();
    expect(db.orders).toHaveLength(1);
  });

  it("a manual close still goes through while a proposal waits, and clears it on the fill", async () => {
    db.orders.push(closeOrder(FLOOR_ORDER, "AWAITING_APPROVAL", FLOOR_RATIONALE));
    mockGetOrder.mockResolvedValue({
      status: "filled",
      filled_avg_price: "17.30",
      filled_at: "2026-09-15T16:50:00Z",
    });

    const outcome = await closeOpenPosition(POSITION_ID, "MANUAL", undefined, "user");

    expect(outcome).toMatchObject({ kind: "closed", fillStatus: "FILLED" });
    expect(mockPlaceMarketOrder).toHaveBeenCalledTimes(1);
    expect(db.orders.find((o) => o.id === FLOOR_ORDER)!.status).toBe("CANCELLED");
  });
});

const position = () => db.positions.get(POSITION_ID)!;
const trim = (args: { pct: number }) =>
  (
    managePosition({
      runId: "run-trim",
      userId: ACCOUNT_ID,
      accountId: ACCOUNT_ID,
      analystId: "cmmmh0wxu000004js7yoyzvlf",
      runEnvironment: "LIVE",
      alpacaCreds: { keyId: "k", secretKey: "s" },
      groupId: (phase: string) => phase,
    } as unknown as ToolContext) as unknown as {
      execute: (a: unknown) => Promise<{ data: Record<string, unknown> }>;
    }
  ).execute({ symbol: "SMMT", action: "partial_close", close_pct: args.pct, reason: "take some off" });

describe("DAV-282 — a sale sells only what is still held", () => {
  it("an approved full close sells the 350 shares left after a 100-share trim filled, not the 450 it was queued at", async () => {
    db.orders.push(closeOrder("trim-filled", "FILLED", "trim", "PARTIAL_CLOSE", 100));
    position().quantity = 350;
    db.orders.push(closeOrder(FLOOR_ORDER, "AWAITING_APPROVAL", FLOOR_RATIONALE));

    await approveProposal(FLOOR_ORDER, ACCOUNT_ID);

    expect(mockPlaceMarketOrder).toHaveBeenCalledTimes(1);
    expect(mockPlaceMarketOrder.mock.calls[0][0]).toMatchObject({ symbol: "SMMT", qty: 350, side: "sell" });
    expect(db.orders.find((o) => o.id === FLOOR_ORDER)!.quantity).toBe(350);
  });

  it("a close approved after trims sold every share is cancelled with a plain reason, not sent", async () => {
    position().quantity = 0;
    db.orders.push(closeOrder(FLOOR_ORDER, "AWAITING_APPROVAL", FLOOR_RATIONALE));

    await expect(approveProposal(FLOOR_ORDER, ACCOUNT_ID)).rejects.toMatchObject({ code: "NOTHING_HELD" });

    const floor = db.orders.find((o) => o.id === FLOOR_ORDER)!;
    expect(floor.status).toBe("CANCELLED");
    expect(floor.rejectionMessage).toBe("Auto-cancelled — no SMMT shares are left to sell.");
    expect(mockPlaceMarketOrder).not.toHaveBeenCalled();
  });

  it("a trim approved while another trim is sent sells no more than is left", async () => {
    db.orders.push(
      closeOrder("trim-sent", "PENDING", "trim", "PARTIAL_CLOSE", 300),
      closeOrder("trim-waiting", "AWAITING_APPROVAL", "trim", "PARTIAL_CLOSE", 300),
    );

    await approveProposal("trim-waiting", ACCOUNT_ID);

    expect(mockClosePositionPartial).toHaveBeenCalledTimes(1);
    expect(mockClosePositionPartial.mock.calls[0][1]).toBe(150);
  });

  it("with approval off, a trim while a full close is sent sends nothing", async () => {
    db.account = { requireApprovalSellsLive: false };
    db.orders.push(closeOrder(FLOOR_ORDER, "PENDING", FLOOR_RATIONALE));

    const result = await trim({ pct: 30 });

    expect(result.data).toMatchObject({ success: true, status: "NO_POSITION" });
    expect(String(result.data.message)).toContain(FLOOR_ORDER);
    expect(mockClosePositionPartial).not.toHaveBeenCalled();
    expect(db.orders).toHaveLength(1);
  });

  it("with approval off, a trim sizes from the shares held under the lock, not the count it read first", async () => {
    db.account = { requireApprovalSellsLive: false };
    // Another 100-share sale fills right after the tool reads the position.
    db.onAccountRead = async () => {
      position().quantity = 350;
    };
    mockGetOrder.mockResolvedValue({ status: "filled", filled_avg_price: "18.10" });

    const result = await trim({ pct: 30 });

    expect(mockClosePositionPartial.mock.calls[0][1]).toBe(105);
    expect(result.data).toMatchObject({ status: "PARTIAL_CLOSE", closedQty: 105, remainingQty: 245 });
    expect(position().quantity).toBe(245);
  });

  it("a trim on a position that went flat after the tool read it says nothing is left", async () => {
    db.account = { requireApprovalSellsLive: false };
    db.onAccountRead = async () => {
      position().quantity = 0;
    };

    const result = await trim({ pct: 30 });

    expect(result.data).toMatchObject({ success: true, status: "NO_POSITION" });
    expect(mockClosePositionPartial).not.toHaveBeenCalled();
    expect(db.orders).toHaveLength(0);
  });

  it("with approval off, a full close while a 100-share trim is sent sells only the other 350", async () => {
    db.account = { requireApprovalSellsLive: false };
    db.orders.push(closeOrder("trim-sent", "PENDING", "trim", "PARTIAL_CLOSE", 100));
    mockGetOrder.mockResolvedValue({ status: "filled", filled_avg_price: "17.30", filled_at: "2026-09-15T16:50:00Z" });

    const outcome = await closeOpenPosition(POSITION_ID, "STOP", undefined, "price_monitor", FLOOR_RATIONALE);

    expect(outcome).toMatchObject({ kind: "closed", fillStatus: "FILLED" });
    expect(mockPlaceMarketOrder).toHaveBeenCalledTimes(1);
    expect(mockPlaceMarketOrder.mock.calls[0][0]).toMatchObject({ qty: 350 });
  });

  it("with approval on, a trim is created already waiting — a close approved while it is queued is not refused", async () => {
    db.orders.push(closeOrder(FLOOR_ORDER, "AWAITING_APPROVAL", FLOOR_RATIONALE));
    let approval: Promise<unknown> = Promise.resolve();
    db.onAccountRead = async () => {
      approval = approveProposal(FLOOR_ORDER, ACCOUNT_ID);
      await approval.catch(() => undefined);
    };

    await trim({ pct: 30 });

    await expect(approval).resolves.toMatchObject({ ok: true, intent: "CLOSE" });
    expect(mockPlaceMarketOrder).toHaveBeenCalledTimes(1);
    expect(mockClosePositionPartial).not.toHaveBeenCalled();
    expect(db.orders.filter((o) => o.intent === "PARTIAL_CLOSE" && o.status === "AWAITING_APPROVAL")).toHaveLength(0);
  });

  it("if Alpaca refuses an approved close, its twin is still there to approve", async () => {
    db.orders.push(
      closeOrder(FLOOR_ORDER, "AWAITING_APPROVAL", FLOOR_RATIONALE),
      closeOrder(TRAIL_ORDER, "AWAITING_APPROVAL", TRAIL_RATIONALE),
    );
    mockPlaceMarketOrder.mockRejectedValueOnce(Object.assign(new Error("insufficient qty"), { statusCode: 403 }));

    await expect(approveProposal(FLOOR_ORDER, ACCOUNT_ID)).rejects.toMatchObject({ code: "ALPACA_REJECTED" });

    expect(db.orders.find((o) => o.id === FLOOR_ORDER)!.status).toBe("REJECTED");
    expect(db.orders.find((o) => o.id === TRAIL_ORDER)!.status).toBe("AWAITING_APPROVAL");
  });
});
