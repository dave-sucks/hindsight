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
  update: async ({ where, data }: { where: { id: string }; data: Row }) => {
    Object.assign(db.positions.get(where.id)!, data);
    return { ...db.positions.get(where.id)! };
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
  };
}

jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findUnique: async () => ({ ...db.account }) },
    order: orderModel,
    position: positionModel,
    positionEvent: { create: recordEvent },
    thesis: { findFirst: async () => ({ id: THESIS_ID }) },
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
import { approveProposal } from "./execute";

function closeOrder(id: string, status: string, rationale: string, intent = "CLOSE"): Row {
  return {
    id,
    positionId: POSITION_ID,
    userId: ACCOUNT_ID,
    environment: "LIVE",
    symbol: "SMMT",
    side: "SELL",
    orderType: "MARKET",
    quantity: intent === "CLOSE" ? 450 : 100,
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
