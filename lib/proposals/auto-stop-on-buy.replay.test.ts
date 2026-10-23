/**
 * Stop when buying, through the approval path every live buy takes
 * (promoteThesisOnApproval → armHeldLadderOnFill), against real rows. Only the
 * database is doubled; fire modes are as the On fire migration stores them.
 *
 *   MU (Secular Compounder, COMPOUNDER), the 10-15 approval at $906.33: floor
 *   $850 on the row and the order, a review at $878 above it, target $1,500.
 *   The two buy triggers are rebuilt from the fill's own Activity line.
 *   IOT (PEAD Specialist, TARGET), the 10-15 approval at $42.21: no floor on
 *   the row; the ticket named $39.80 and a $47 target.
 *   TRV (Secular Compounder, COMPOUNDER), the Trade-button buy waiting on
 *   10-22 at $398.95: the watched row's $382.40 floor (4.1% under) and $431.50
 *   target. The row's earnings and date reviews are left out; they don't bear
 *   on the floor.
 */

import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow, REPLAY_ANALYST_ID, type PrismaDouble } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

let db: PrismaDouble;
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));

import { promoteThesisOnApproval } from "./thesis-flips";

const MU_FLOOR = {
  id: "ba421f37-1a10-4fbd-aba8-cafc161c2c6e",
  action: "EXIT",
  source: "AGENT",
  fireMode: "ASK_NOW",
  predicate: { is: "below", value: 850, watch: "price" },
  rationale: "Under the September swing low at $902.60 and below the 38.2% retracement at $878.08, with $850 as the catastrophe line roughly 1.2 ATR below the original $906 buy level.",
  cooldownDays: 1,
};
const MU_REVIEW = { id: "d9b6bc8d-017f-4355-8e8c-fe315084db87", action: "REVIEW", source: "AGENT", fireMode: "NEXT_MORNING", predicate: { is: "below", value: 878, watch: "price" }, rationale: "A close below the 38.2% Fibonacci retracement at $878 is a prompt to re-examine the thesis.", cooldownDays: 1 };
const TRV_FLOOR = {
  id: "aaf8dc78-a969-495d-ab0a-6bb95b55fe66",
  action: "EXIT",
  source: "AGENT",
  fireMode: "ASK_NOW",
  predicate: { is: "below", value: 382.4, watch: "price" },
  rationale: "Under the near-term support shelf and below the 20-day average at $367.05? No — the real near-term shelf is the report-day close recovery area just above $383.99 and the open at $370 widened too far. I am using $382.40 just under the recent swing-high-turned-support area so a failed breakout ends the plan quickly.",
  cooldownDays: 1,
};

const ROWS: Record<Stock, { horizon: string; setupId: string; triggers: Array<Record<string, unknown>> }> = {
  MU: {
    horizon: "COMPOUNDER",
    setupId: "MA_PULLBACK",
    triggers: [
      { id: "9db623d8-7df0-48bb-b9ce-3968664813ae", action: "ENTER", source: "AGENT", fireMode: "ASK_NOW", predicate: { is: "above", value: 908.72, watch: "price" }, rationale: "Buy if above $908.72.", cooldownDays: 1 },
      { id: "d7fcd231-5a48-42a0-919b-8efc0ac521b0", action: "ENTER", source: "AGENT", fireMode: "ASK_NOW", predicate: { is: "near", value: 2, watch: "move", variable: "sma50" }, rationale: "Buy if within 2% of the 50-day average.", cooldownDays: 7 },
      MU_REVIEW,
      MU_FLOOR,
      { id: "bb928325-0cde-4168-a03c-aca52371fc8f", action: "REVIEW", source: "AGENT", fireMode: "NEXT_MORNING", predicate: { is: "above", value: 1500, watch: "price" }, rationale: "The 1.272 Fibonacci extension of the primary up-leg lands at $1,523, supporting the $1,500 target.", cooldownDays: 1 },
    ],
  },
  IOT: {
    horizon: "TARGET",
    setupId: "NONE",
    triggers: [{ id: "8fc79e5c-3682-48de-a0d9-03acce291d71", action: "REVIEW", source: "DEFAULT", fireMode: "NEXT_MORNING", predicate: { value: 7, watch: "repeat" }, rationale: "Look at this every 7 days, counting from the last real review.", cooldownDays: 7 }],
  },
  TRV: {
    horizon: "COMPOUNDER",
    setupId: "BASE_BREAKOUT",
    triggers: [
      { id: "6e111cb3-34f8-4d89-a2f5-f7ceff7f8f4b", action: "ENTER", source: "AGENT", fireMode: "ASK_NOW", predicate: { is: "above", value: 398.7, watch: "price", settings: { close: true } }, rationale: "I buy when it breaks above $398.70.", cooldownDays: 1 },
      TRV_FLOOR,
      { id: "c5b67206-924c-4260-be2a-82918f32bbbd", action: "REVIEW", source: "AGENT", fireMode: "NEXT_MORNING", predicate: { is: "above", value: 431.5, watch: "price" }, rationale: "The 1.272 Fibonacci extension of the January-July up-leg is $431.53, which is the cited upside objective for a confirmed breakout from this base.", cooldownDays: 1 },
    ],
  },
};

type Stock = "MU" | "IOT" | "TRV";
type Setting = { on: boolean; pct: number };
const ORDER: Record<Stock, { entryPrice: number; targetPrice: number; stopLoss: number }> = {
  MU: { entryPrice: 906.33, targetPrice: 1500, stopLoss: 850 },
  IOT: { entryPrice: 42.21, targetPrice: 47, stopLoss: 39.8 },
  TRV: { entryPrice: 398.95, targetPrice: 431.5, stopLoss: 382.4 },
};

/** The approval of `stock`'s buy with `setting` stored; `stop` replaces the ticket's floor; `rows` edits the row's triggers. */
async function approve(
  stock: Stock,
  setting: { account: Setting; analyst?: Partial<Record<"autoStopOnBuy" | "autoStopPct", boolean | number | null>> },
  opts: { stop?: number | null; rows?: (t: Array<Record<string, unknown>>) => Array<Record<string, unknown>> } = {},
) {
  const order = { ...ORDER[stock], stopLoss: opts.stop === undefined ? ORDER[stock].stopLoss : opts.stop };
  const row = ROWS[stock];
  db = prismaDouble({
    account: [accountRow({ autoStopOnBuy: setting.account.on, autoStopPct: setting.account.pct, setupOverrides: {} })],
    agentConfig: [agentConfigRow({ autoStopOnBuy: null, autoStopPct: null, ...setting.analyst })],
    thesis: [thesisRow({ id: `thesis_${stock}`, ticker: stock, status: "WATCHING", horizon: row.horizon, setupId: row.setupId, triggers: opts.rows ? opts.rows(row.triggers) : row.triggers })],
    position: [positionRow({ id: `position_${stock}`, symbol: stock, status: "PENDING_APPROVAL", avgCost: order.entryPrice, stopLoss: order.stopLoss, targetPrice: order.targetPrice })],
  });
  await promoteThesisOnApproval({ analystId: REPLAY_ANALYST_ID, ticker: stock, positionId: `position_${stock}`, ...order });
}

const thesis = () => (db.store.thesis as Array<Record<string, unknown>>)[0];
const position = () => (db.store.position as Array<Record<string, unknown>>)[0];
const below = (action: string) => () =>
  (thesis().triggers as Trigger[]).filter((t) => t.action === action && (t.predicate as { watch?: string }).watch === "price" && (t.predicate as { is?: string; variable?: string }).is === "below");
const floors = below("EXIT");
const reviewLines = below("REVIEW");
const activity = () =>
  ((db.store.thesisUpdate as Array<{ fieldChanges: { triggerOps?: { to: Array<{ text: string }> } } }>)[0].fieldChanges.triggerOps?.to ?? []).map((o) => o.text);

const OFF = { on: false, pct: 8 };
const ON8 = { on: true, pct: 8 };
const saleAt = (value: number) => expect.objectContaining({ predicate: { watch: "price", is: "below", value }, action: "EXIT", fireMode: "DO_IT", rationale: `Sell if below $${value.toFixed(2)}. You set this.`, source: "PRINCIPAL" });

describe("no floor: the sale floor is added on the line", () => {
  it("IOT, on at 8%, the ticket named no stop: Sell if below $38.83", async () => {
    await approve("IOT", { account: ON8 }, { stop: null });
    expect(floors()).toEqual([saleAt(38.83)]);
    expect(reviewLines()).toEqual([]);
    expect(thesis()).toMatchObject({ status: "HOLDING", stopLoss: 38.83 });
    expect(position()).toMatchObject({ stopLoss: 38.83 });
    expect(activity()).toContain("Added: Sell if below $38.83");
  });
});

describe("a floor below the line: raised to it in place", () => {
  it("MU, on at 5%: the $850 floor, same id, becomes Sell if below $861.01; the $878 review stays", async () => {
    await approve("MU", { account: { on: true, pct: 5 } });
    expect(floors()).toEqual([saleAt(861.01)]);
    expect(floors()[0].id).toBe(MU_FLOOR.id);
    expect(reviewLines()).toEqual([expect.objectContaining({ id: MU_REVIEW.id, predicate: MU_REVIEW.predicate })]);
    expect(position()).toMatchObject({ stopLoss: 861.01 });
    expect(activity()).toContain("Changed: Sell if below $850 → Sell if below $861.01");
  });
});

describe("a tighter floor an analyst or a template set: it becomes the review line, the sale floor moves to the line", () => {
  it("IOT, on at 8%: the ticket's $39.80 stays as Review if below $39.80, asking the analyst; the sale floor is $38.83", async () => {
    await approve("IOT", { account: ON8 });
    const [floor] = floors();
    expect(floors()).toEqual([saleAt(38.83)]);
    expect(reviewLines()).toEqual([expect.objectContaining({ predicate: { watch: "price", is: "below", value: 39.8 }, fireMode: "ASK_NOW" })]);
    // The review carries the floor's own words; the sale floor kept the floor's id.
    expect(reviewLines()[0].rationale).toMatch(/\$39\.80/);
    expect(floor.id).not.toBe(reviewLines()[0].id);
    expect(thesis()).toMatchObject({ stopLoss: 38.83 });
    expect(position()).toMatchObject({ stopLoss: 38.83 });
  });

  it("TRV, on at 8%: one review line at the analyst's $382.40, raised from the template's $367.03; the sale floor is $367.03", async () => {
    await approve("TRV", { account: ON8 });
    expect(floors()).toEqual([saleAt(367.03)]);
    expect(floors()[0].id).toBe(TRV_FLOOR.id);
    expect(reviewLines()).toEqual([
      expect.objectContaining({ predicate: TRV_FLOOR.predicate, action: "REVIEW", fireMode: "ASK_NOW", rationale: TRV_FLOOR.rationale, source: "AGENT" }),
    ]);
    expect(activity()).toEqual(
      expect.arrayContaining([
        "Added: Review if below $367.03",
        "Changed: Sell if below $382.40 → Sell if below $367.03",
        "Changed: Review if below $367.03 → Review if below $382.40",
      ]),
    );
    expect(position()).toMatchObject({ stopLoss: 367.03 });
  });

  it("MU, on at 8%: the sale floor moves from $850 to $833.82; the $878 review above is higher, so it stays and no second review is made", async () => {
    await approve("MU", { account: ON8 });
    expect(floors()).toEqual([saleAt(833.82)]);
    expect(floors()[0].id).toBe(MU_FLOOR.id);
    expect(reviewLines()).toEqual([expect.objectContaining({ id: MU_REVIEW.id, predicate: MU_REVIEW.predicate, rationale: MU_REVIEW.rationale })]);
    expect(position()).toMatchObject({ stopLoss: 833.82 });
  });
});

describe("a tighter floor the owner set: left exactly as it is", () => {
  it("TRV, on at 8%, with its $382.40 floor as the owner's: same price, same mode, no review line made from it", async () => {
    await approve("TRV", { account: ON8 }, { rows: (ts) => ts.map((t) => (t.id === TRV_FLOOR.id ? { ...t, source: "PRINCIPAL" } : t)) });
    expect(floors()).toEqual([expect.objectContaining({ id: TRV_FLOOR.id, predicate: TRV_FLOOR.predicate, fireMode: "ASK_NOW", source: "PRINCIPAL", rationale: TRV_FLOOR.rationale })]);
    // Only the template's own 8% review, not one at $382.40.
    expect(reviewLines().map((t) => (t.predicate as { value: number }).value)).toEqual([367.03]);
    expect(position()).toMatchObject({ stopLoss: 382.4 });
  });
});

describe("which setting is in force, and off", () => {
  it("the analyst's own setting beats the account's", async () => {
    await approve("MU", { account: OFF, analyst: { autoStopOnBuy: true, autoStopPct: 5 } });
    expect(floors().map((t) => t.predicate)).toEqual([{ watch: "price", is: "below", value: 861.01 }]);

    await approve("MU", { account: { on: true, pct: 5 }, analyst: { autoStopOnBuy: false } });
    expect(floors()).toEqual([expect.objectContaining({ predicate: MU_FLOOR.predicate, fireMode: "ASK_NOW", source: "AGENT" })]);
  });

  it("off: IOT's floor is the ticket's $39.80 and nothing else is written onto it", async () => {
    await approve("IOT", { account: OFF });
    expect(floors()).toEqual([expect.objectContaining({ predicate: { watch: "price", is: "below", value: 39.8 }, cooldownDays: 1 })]);
    expect(reviewLines()).toEqual([]);
    expect(activity()).toEqual(["Stop set: $39.80", "Target set: $47", "Target: cooldown 1 days"]);
  });

  it("off, and the ticket named no stop: no floor is written", async () => {
    await approve("IOT", { account: OFF }, { stop: null });
    expect(floors()).toEqual([]);
  });
});
