/**
 * The builder sees the analysts already there, and its proposal carries only
 * fields something reads.
 *
 * Rows are the three live analysts (production, 2026-10-30). Their stored cap
 * tier contradicts their real fence on two of three (PEAD "MID" over a $200M
 * floor, Catalyst "MID" over $0.5B) and nothing reads it; the signal and
 * article limits capped tools deleted with the router; the nested `universe`
 * object copied the top-level fence and Create never read the model's copy.
 */

const getUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
jest.mock("@/lib/auth/account", () => ({ getAccountId: async () => "acct-1" }));
jest.mock("next/cache", () => ({ revalidatePath: () => {} }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
jest.mock("@/lib/alpaca", () => ({ getLatestPricesWithMeta: async () => ({}) }));

const LIVE = [
  { id: "catalyst", name: "Catalyst Event PM", setupIds: ["PRE_CATALYST", "BASE_BREAKOUT", "MA_PULLBACK"] },
  { id: "pead", name: "PEAD Specialist", setupIds: ["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"] },
  { id: "compounder", name: "Secular Compounder", setupIds: ["COMPOUNDER_ACCUMULATION", "BASE_BREAKOUT", "MA_PULLBACK"] },
].map((a) => ({ ...a, description: "", enabled: true, directionBias: "LONG", holdDurations: ["SWING"], sectors: [], maxOpenPositions: 6, createdAt: new Date() }));

const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "new", triggers: [], ...data }));
const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => data);
jest.mock("@/lib/prisma", () => {
  const agentConfig = {
    create: (a: never) => create(a),
    update: (a: never) => update(a),
    findFirst: async () => ({ id: "catalyst" }),
    findUnique: async () => null,
    findMany: async () => LIVE,
  };
  const none = async () => [];
  return {
    prisma: {
      agentConfig,
      $transaction: async (fn: (tx: unknown) => unknown) => fn({ agentConfig }),
      position: { groupBy: none },
      researchRun: { groupBy: none, findMany: none },
      thesis: { findMany: none, groupBy: none },
    },
  };
});

import { zodSchema } from "ai";
import { createAnalystFromBuilder, updateAnalystFromBuilder } from "@/lib/actions/analyst.actions";
import { toApplyInput, toCreateInput } from "@/components/analysts/builder-config";
import { builderConfigSchema as configSchema, suggestConfigFor } from "@/lib/agent/tools/suggest-config";
const suggestConfigTool = suggestConfigFor("builder");
import { listAnalysts } from "@/lib/agent/tools/list-analysts";
import { BUILDER_SYSTEM_PROMPT, MODES } from "@/lib/agent/modes";
import type { AgentConfigData } from "@/components/domain/agent-config-card";

// The Catalyst Event PM, as a builder proposal: a playbook and words.
const CALL = { playbook: "CATALYST_EVENT", name: "Catalyst Event PM", analystPrompt: "x" };

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

it("the builder lists the analysts already there, with their setups", async () => {
  expect(MODES.builder.toolAllowlist).toContain("list_analysts");
  expect(BUILDER_SYSTEM_PROMPT).toContain("how the new analyst differs from each one the user already has");
  const tool = (listAnalysts as unknown as (c: unknown) => { execute: (a: unknown) => Promise<{ data: { analysts: Array<{ name: string; setupIds: string[] }> } }> })({ accountId: "acct-1", groupId: (p: string) => p });
  const { data } = await tool.execute({});
  expect(data.analysts.map((a) => [a.name, a.setupIds[0]])).toEqual([
    ["Catalyst Event PM", "PRE_CATALYST"],
    ["PEAD Specialist", "PEAD"],
    ["Secular Compounder", "COMPOUNDER_ACCUMULATION"],
  ]);
});

it("suggest_config offers no nested universe", () => {
  const props = (zodSchema(configSchema as never).jsonSchema as { properties: Record<string, unknown> }).properties;
  expect("universe" in props).toBe(false);
  expect(() => configSchema.parse(CALL)).not.toThrow();
});

it("suggest_config refuses nothing off a hard-coded table of market caps", async () => {
  const proposal = { ...configSchema.parse(CALL), watchlist: [{ symbol: "NVDA", reason: "x" }] };
  await expect(suggestConfigTool.execute!(proposal as never, { toolCallId: "t", messages: [] })).resolves.toMatchObject({ name: "Catalyst Event PM" });
});

it("Create and Apply save the market-cap band from the top-level fields", async () => {
  // The builder names the playbook; the tool fills in its band.
  const proposal = (await suggestConfigTool.execute!(configSchema.parse(CALL) as never, { toolCallId: "t", messages: [] })) as AgentConfigData;
  await createAnalystFromBuilder(toCreateInput(proposal));
  expect(create.mock.calls[0][0].data).toMatchObject({ marketCapMin: BigInt(500_000_000), marketCapMax: BigInt(20_000_000_000) });

  await updateAnalystFromBuilder("catalyst", toApplyInput({ ...proposal, marketCapMin: 1_000_000_000 }));
  expect(update.mock.calls.at(-1)![0].data).toMatchObject({ marketCapMin: BigInt(1_000_000_000) });
});
