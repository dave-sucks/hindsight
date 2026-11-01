/**
 * The builder fills in no sectors: the owner sets them on the panel. Given a
 * sectors field, GPT-4o turned themes into a fence: "AI infrastructure and
 * GLP-1" came back as Information Technology alone in 6 of 9 drafts and as
 * IT + Health Care in the rest, which keeps a compounder off the power and
 * datacenter builders. A sectors value the model sends anyway is dropped.
 *
 * The playbook is the live Secular Compounder's (production, 2026-10-30).
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

// The call one of the drafts made, cut to the fields that matter here.
const DRAFT = {
  playbook: "THEMATIC_SECULAR",
  name: "Long-Term Trend Seeker",
  analystPrompt: "Owns the operators compounding AI infrastructure and GLP-1 drugs.",
  sectors: ["Information Technology"],
};

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

it("a sectors value the builder sends is dropped, and the analyst covers every sector", async () => {
  const args = builderConfigSchema.parse(DRAFT);
  expect(args).not.toHaveProperty("sectors");
  const proposal = (await suggestConfigFor("builder").execute!(args as never, { toolCallId: "t", messages: [] })) as AgentConfigData;
  expect(proposal).not.toHaveProperty("sectors");
  await createAnalystFromBuilder(toCreateInput(proposal));
  const created = create.mock.calls.at(-1)![0].data;
  expect(created.sectors).toEqual([]);
  expect(created).toMatchObject({ setupIds: ["COMPOUNDER_ACCUMULATION", "BASE_BREAKOUT", "MA_PULLBACK"] });
});
