/**
 * Stop when buying, through the approval path every live buy takes
 * (promoteThesisOnApproval → armHeldLadderOnFill), against two real fills of
 * 2026-10-15. Only the database is doubled.
 *
 *   MU (Secular Compounder, COMPOUNDER): approved at $906.33, floor $850 on
 *   the row and on the order, target $1,500. The two buy triggers are rebuilt
 *   from the fill's own Activity line; the rest are the row's as stored.
 *   IOT (PEAD Specialist, TARGET): approved at $42.21 with no floor on the row;
 *   the ticket named $39.80 and a $47 target. On main the fill also wrote the
 *   template's hard stop, which landed as "Stop: cooldown 0 days".
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
  predicate: { is: "below", value: 850, watch: "price" },
  rationale: "Under the September swing low at $902.60 and below the 38.2% retracement at $878.08, with $850 as the catastrophe line roughly 1.2 ATR below the original $906 buy level.",
  cooldownDays: 1,
};
const MU_ROW = [
  { id: "9db623d8-7df0-48bb-b9ce-3968664813ae", action: "ENTER", source: "AGENT", predicate: { is: "above", value: 908.72, watch: "price" }, rationale: "Buy if above $908.72.", cooldownDays: 1 },
  { id: "d7fcd231-5a48-42a0-919b-8efc0ac521b0", action: "ENTER", source: "AGENT", predicate: { is: "near", value: 2, watch: "move", variable: "sma50" }, rationale: "Buy if within 2% of the 50-day average.", cooldownDays: 7 },
  { id: "d9b6bc8d-017f-4355-8e8c-fe315084db87", action: "REVIEW", source: "AGENT", predicate: { is: "below", value: 878, watch: "price" }, rationale: "A close below the 38.2% Fibonacci retracement at $878 is a prompt to re-examine the thesis.", cooldownDays: 1 },
  MU_FLOOR,
  { id: "bb928325-0cde-4168-a03c-aca52371fc8f", action: "REVIEW", source: "AGENT", predicate: { is: "above", value: 1500, watch: "price" }, rationale: "The 1.272 Fibonacci extension of the primary up-leg lands at $1,523, supporting the $1,500 target.", cooldownDays: 1 },
];
const IOT_ROW = [
  { id: "8fc79e5c-3682-48de-a0d9-03acce291d71", action: "REVIEW", source: "DEFAULT", predicate: { value: 7, watch: "repeat" }, rationale: "Look at this every 7 days, counting from the last real review.", cooldownDays: 7 },
];

type Setting = { on: boolean; pct: number };
const ORDER = { MU: { entryPrice: 906.33, targetPrice: 1500, stopLoss: 850 }, IOT: { entryPrice: 42.21, targetPrice: 47, stopLoss: 39.8 } } as const;

/** The approval of `stock`'s buy, with `setting` stored; `stop` replaces the ticket's floor. */
async function approve(
  stock: "MU" | "IOT",
  setting: { account: Setting; analyst?: Partial<Record<"autoStopOnBuy" | "autoStopPct", boolean | number | null>> },
  stop: number | null = ORDER[stock].stopLoss,
) {
  const order = { ...ORDER[stock], stopLoss: stop };
  db = prismaDouble({
    account: [accountRow({ autoStopOnBuy: setting.account.on, autoStopPct: setting.account.pct, setupOverrides: {} })],
    agentConfig: [agentConfigRow({ autoStopOnBuy: null, autoStopPct: null, ...setting.analyst })],
    thesis: [
      thesisRow({
        id: `thesis_${stock}`,
        ticker: stock,
        status: "WATCHING",
        horizon: stock === "MU" ? "COMPOUNDER" : "TARGET",
        setupId: stock === "MU" ? "MA_PULLBACK" : "NONE",
        triggers: stock === "MU" ? MU_ROW : IOT_ROW,
      }),
    ],
    position: [positionRow({ id: `position_${stock}`, symbol: stock, status: "PENDING_APPROVAL", avgCost: order.entryPrice, stopLoss: stop, targetPrice: order.targetPrice })],
  });
  await promoteThesisOnApproval({ analystId: REPLAY_ANALYST_ID, ticker: stock, positionId: `position_${stock}`, ...order });
}

const thesis = () => (db.store.thesis as Array<Record<string, unknown>>)[0];
const position = () => (db.store.position as Array<Record<string, unknown>>)[0];
const floors = () => (thesis().triggers as Trigger[]).filter((t) => t.action === "EXIT" && t.predicate && (t.predicate as { watch?: string; is?: string }).watch === "price" && (t.predicate as { is?: string }).is === "below");
const activity = () =>
  ((db.store.thesisUpdate as Array<{ fieldChanges: { triggerOps?: { to: Array<{ text: string }> } } }>)[0].fieldChanges.triggerOps?.to ?? []).map((o) => o.text);

const OFF = { on: false, pct: 8 };

describe("stop when buying — MU, approved at $906.33 with an $850 floor", () => {
  it("on at 8%: the line is $833.82, the $850 floor is higher and stays as it was", async () => {
    await approve("MU", { account: { on: true, pct: 8 } });
    expect(thesis()).toMatchObject({ status: "HOLDING", stopLoss: 850 });
    expect(floors()).toEqual([expect.objectContaining({ id: MU_FLOOR.id, predicate: MU_FLOOR.predicate, rationale: MU_FLOOR.rationale, source: "AGENT" })]);
    expect(position()).toMatchObject({ stopLoss: 850 });
  });

  it("on at 5%: the floor is raised to $861.01, the same trigger, proposed straight away, as yours", async () => {
    await approve("MU", { account: { on: true, pct: 5 } });
    expect(floors()).toEqual([
      expect.objectContaining({
        id: MU_FLOOR.id,
        predicate: { watch: "price", is: "below", value: 861.01 },
        fireMode: "DIRECT",
        rationale: "Sell if below $861.01. You set this.",
        source: "PRINCIPAL",
      }),
    ]);
    expect(thesis()).toMatchObject({ stopLoss: 861.01 });
    expect(position()).toMatchObject({ stopLoss: 861.01 });
    expect(activity()).toContain("Changed: Sell if below $850 → Sell if below $861.01");
  });

  it("the analyst's own setting beats the account's", async () => {
    await approve("MU", { account: OFF, analyst: { autoStopOnBuy: true, autoStopPct: 5 } });
    expect(floors().map((t) => t.predicate)).toEqual([{ watch: "price", is: "below", value: 861.01 }]);

    await approve("MU", { account: { on: true, pct: 5 }, analyst: { autoStopOnBuy: false } });
    expect(floors().map((t) => t.predicate)).toEqual([MU_FLOOR.predicate]);
  });
});

describe("stop when buying — IOT, approved at $42.21 with no floor on the row", () => {
  it("off: the floor is the ticket's $39.80 and nothing else is written onto it", async () => {
    await approve("IOT", { account: OFF });
    expect(floors()).toEqual([expect.objectContaining({ predicate: { watch: "price", is: "below", value: 39.8 }, cooldownDays: 1 })]);
    // Production, 10-15, also had "Stop: cooldown 0 days" here: the template's hard stop, now gone.
    expect(activity()).toEqual(["Stop set: $39.80", "Target set: $47", "Target: cooldown 1 days"]);
  });

  it("off, and the ticket named no stop: no floor is written", async () => {
    await approve("IOT", { account: OFF }, null);
    expect(floors()).toEqual([]);
  });

  it("on at 8% with no stop on the ticket: a floor is added at $38.83", async () => {
    await approve("IOT", { account: { on: true, pct: 8 } }, null);
    expect(floors()).toEqual([
      expect.objectContaining({
        predicate: { watch: "price", is: "below", value: 38.83 },
        action: "EXIT",
        fireMode: "DIRECT",
        rationale: "Sell if below $38.83. You set this.",
        source: "PRINCIPAL",
      }),
    ]);
    expect(thesis()).toMatchObject({ status: "HOLDING", stopLoss: 38.83 });
    expect(position()).toMatchObject({ stopLoss: 38.83 });
    expect(activity()).toContain("Added: Sell if below $38.83");
  });

  it("on at 5%: the ticket's $39.80 is under the $40.10 line, so it is raised in place", async () => {
    await approve("IOT", { account: { on: true, pct: 5 } });
    expect(floors()).toEqual([expect.objectContaining({ predicate: { watch: "price", is: "below", value: 40.1 }, fireMode: "DIRECT", source: "PRINCIPAL" })]);
    expect(activity()).toEqual(["Stop set: $39.80", "Target set: $47", "Target: cooldown 1 days", "Changed: Sell if below $39.80 → Sell if below $40.10"]);
  });
});
