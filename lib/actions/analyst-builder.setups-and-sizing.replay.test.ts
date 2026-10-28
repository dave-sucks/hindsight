/**
 * Create and the editor's Apply keep the setups and all four sizing fields.
 *
 * Create sent no setups and no smallest trade, Apply dropped both, and the
 * panel ignored edits to risk per trade and most in one stock, so a new
 * analyst started with the whole playbook, a blank Triggers tab and a $0
 * floor. The input is the live PEAD Specialist (production, 2026-10-27)
 * written as the suggest_config call that would make it, run through the
 * tool's schema, the panel and the two save actions.
 */

const getUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
jest.mock("@/lib/auth/account", () => ({ getAccountId: async () => "acct-1" }));
jest.mock("next/cache", () => ({ revalidatePath: () => {} }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
jest.mock("@/lib/alpaca", () => ({ getLatestPricesWithMeta: async () => ({}) }));

const rows = new Map<string, Record<string, unknown>>();
const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
  const row = { id: "new-analyst", triggers: [], ...data };
  rows.set(row.id, row);
  return row;
});
const update = jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id, ...data }));
jest.mock("@/lib/prisma", () => {
  const agentConfig = {
    create: (a: never) => create(a),
    update: (a: never) => update(a),
    findFirst: async ({ where }: { where: { id: string } }) => ({ id: where.id }),
    findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
  };
  return { prisma: { agentConfig, $transaction: async (fn: (tx: unknown) => unknown) => fn({ agentConfig }) } };
});

import { createAnalystFromBuilder, updateAnalystFromBuilder } from "@/lib/actions/analyst.actions";
import { applyChange, editorPanelStart, toApplyInput, toCreateInput, toFormValues } from "@/components/analysts/builder-config";
import { configSchema } from "@/lib/agent/tools/suggest-config";
import type { AgentConfigData } from "@/components/domain/agent-config-card";

const SETUPS = ["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"];

// The PEAD Specialist row, as the builder's suggest_config call.
const PEAD_CALL = {
  name: "PEAD Specialist",
  description: "Buys clean beat-and-raise earnings prints LONG-only across all sectors.",
  analystPrompt: "Post-earnings drift, long only.",
  directionBias: "LONG",
  holdDurations: ["SWING", "POSITION"],
  setupIds: SETUPS,
  sectors: [],
  industries: [],
  themes: [],
  marketCapMin: 200_000_000,
  minConfidence: 60,
  minPositionSize: 3000,
  maxPositionSize: 14000,
  maxOpenPositions: 6,
  minMarketCapTier: "MID",
  exclusionList: [],
  intelligencePolicy: { allowLiveSearch: true, liveSearchBudget: 10 },
};

// The same row as the edit page hands the editor.
const PEAD_NOW = { ...PEAD_CALL, riskPct: 1, maxPositionTotal: 28000 };

beforeEach(() => {
  jest.clearAllMocks();
  rows.clear();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

it("Create saves the setups and all four sizing fields, and seeds the signature setup's reviews", async () => {
  const proposal = configSchema.parse(PEAD_CALL) as AgentConfigData;
  expect(toFormValues(proposal).setupIds).toEqual(SETUPS); // the panel shows the Setups row

  // The owner sets the two fields suggest_config doesn't carry, on the panel.
  const edited = applyChange(applyChange(proposal, "riskPct", 0.75), "maxPositionTotal", 21000);
  await createAnalystFromBuilder(toCreateInput(edited));

  expect(create.mock.calls[0][0].data).toMatchObject({
    setupIds: SETUPS,
    riskPct: 0.75,
    minPositionSize: 3000,
    maxPositionSize: 14000,
    maxPositionTotal: 21000,
  });
  const seeded = update.mock.calls.map((c) => c[0].data.triggers).find(Boolean) as Array<{ action: string; predicate: unknown }>;
  expect(seeded.map((t) => [t.action, t.predicate])).toEqual([
    ["REVIEW", { watch: "move", is: "above", value: 10, variable: "entry" }],
    ["REVIEW", { watch: "move", is: "below", value: 12, variable: "entry" }],
  ]);
});

it("Apply saves the editor's setups and floor, and the owner's risk edit on the panel", async () => {
  // The owner asked the editor to raise the smallest trade to $4,000.
  const proposal = configSchema.parse({ ...PEAD_CALL, minPositionSize: 4000 }) as AgentConfigData;
  const panel = editorPanelStart(PEAD_NOW, proposal);
  expect(toFormValues(panel)).toMatchObject({ setupIds: SETUPS, riskPct: 1, maxPositionTotal: 28000 });

  await updateAnalystFromBuilder("pead", toApplyInput(applyChange(panel, "riskPct", 0.75)));

  expect(update.mock.calls[0][0].data).toMatchObject({
    setupIds: SETUPS,
    riskPct: 0.75,
    minPositionSize: 4000,
    maxPositionSize: 14000,
    maxPositionTotal: 28000,
  });
});

it("Apply leaves a field the proposal doesn't name alone", async () => {
  await updateAnalystFromBuilder("pead", toApplyInput({ name: "PEAD Specialist", analystPrompt: "x" }));
  const data = update.mock.calls[0][0].data;
  for (const k of ["setupIds", "riskPct", "minPositionSize", "maxPositionTotal"]) expect(data).not.toHaveProperty(k);
});
