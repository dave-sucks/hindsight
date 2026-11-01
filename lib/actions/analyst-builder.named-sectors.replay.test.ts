/**
 * The builder carries the sectors the user named, and only those. Asked for a
 * biotech catalyst analyst, it had nowhere to put "biotech": the builder's
 * suggest_config had no sectors field, so the analyst was created covering
 * every sector. The playbook still brings no sectors.
 *
 * The playbook is the live Catalyst Event PM's (production, 2026-10-30).
 */
const getUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
jest.mock("@/lib/auth/account", () => ({ getAccountId: async () => "acct-1" }));
jest.mock("next/cache", () => ({ revalidatePath: () => {} }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
jest.mock("@/lib/alpaca", () => ({ getLatestPricesWithMeta: async () => ({}) }));
jest.mock("@/lib/agent/triggers/seed-analyst", () => ({ seedAnalystTriggers: async () => {} }));

const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "new-analyst", ...data }));
jest.mock("@/lib/prisma", () => {
  const tx = { agentConfig: { create: (a: never) => create(a) }, thesis: { findMany: async () => [] } };
  return { prisma: { ...tx, $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } };
});

import { createAnalystFromBuilder } from "@/lib/actions/analyst.actions";
import { toCreateInput } from "@/components/analysts/builder-config";
import { builderConfigSchema, suggestConfigFor } from "@/lib/agent/tools/suggest-config";
import type { AgentConfigData } from "@/components/domain/agent-config-card";

const BUILT = { playbook: "CATALYST_EVENT", name: "FDA Run-up Trader", analystPrompt: "Buys biotech run-ups ahead of dated FDA decisions." };

async function build(call: Record<string, unknown>) {
  const args = builderConfigSchema.parse(call);
  const proposal = (await suggestConfigFor("builder").execute!(args as never, { toolCallId: "t", messages: [] })) as AgentConfigData;
  await createAnalystFromBuilder(toCreateInput(proposal));
  return { proposal, created: create.mock.calls.at(-1)![0].data };
}

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

it("the sectors the user named come out of suggest_config and are saved", async () => {
  const { proposal, created } = await build({ ...BUILT, sectors: ["Health Care"] });
  expect(proposal.sectors).toEqual(["Health Care"]);
  expect(created.sectors).toEqual(["Health Care"]);
  expect(created).toMatchObject({ setupIds: ["PRE_CATALYST", "BASE_BREAKOUT", "MA_PULLBACK"], marketCapMin: BigInt(500_000_000) });
});

it("with none named, the proposal carries no sectors and the analyst covers every sector", async () => {
  const { proposal, created } = await build(BUILT);
  expect(proposal).not.toHaveProperty("sectors");
  expect(created.sectors).toEqual([]);
});
