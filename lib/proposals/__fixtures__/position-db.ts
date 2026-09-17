/**
 * position-db.ts — the in-memory database the position tests run against.
 *
 * It models the one Postgres behavior the position lock relies on: `SELECT …
 * FOR NO KEY UPDATE` on a Position row blocks a second transaction until the
 * first ends. Shared by the tests that put several writers on one position.
 */

export type Row = Record<string, unknown>;

export const db = {
  orders: [] as Row[],
  positions: new Map<string, Row>(),
  events: [] as Row[],
  account: {} as Row,
  analyst: {} as Row,
  thesisId: "thesis-1",
  /** One-shot: runs the moment something reads the account's approval settings. */
  onAccountRead: null as (() => Promise<unknown>) | null,
};

export function matches(row: Row, where: Row = {}): boolean {
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
      const step = value as { decrement?: number; increment?: number } | null;
      if (step?.decrement != null) row[key] = (row[key] as number) - step.decrement;
      else if (step?.increment != null) row[key] = (row[key] as number) + step.increment;
      else row[key] = value;
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
    agentConfig: { findUnique: async () => ({ ...db.analyst }) },
    thesis: { findFirst: async () => null, update: recordEvent },
  };
}


export const prismaFake = {
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
  agentConfig: { findUnique: async () => ({ ...db.analyst }) },
  thesis: { findFirst: async () => ({ id: db.thesisId }), findUnique: async () => null },
  researchRun: { findUnique: async () => null },
  $transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
    const held = new Map<string, () => void>();
    try {
      return await cb(makeTx(held));
    } finally {
      held.forEach((release) => release());
    }
  },
};

/** Fresh rows for one test: an open position plus the account's settings. */
export function resetDb(position: Row, over: { account?: Row; analyst?: Row; thesisId?: string } = {}) {
  seq = 0;
  db.orders = [];
  db.events = [];
  db.onAccountRead = null;
  db.account = over.account ?? { requireApprovalSellsLive: true, requireApprovalBuysLive: true };
  db.analyst = over.analyst ?? { emailAlerts: false, maxPositionSize: 5000, maxPositionTotal: 10000 };
  db.thesisId = over.thesisId ?? "thesis-1";
  db.positions = new Map([[position.id as string, { ...position }]]);
}
