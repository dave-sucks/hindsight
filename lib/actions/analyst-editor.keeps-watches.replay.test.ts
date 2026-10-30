/**
 * The editor's Apply adds seeds and retires nothing.
 *
 * Apply used to retire every WATCHING thesis its proposal left out, so an
 * editor that proposed a fresh list would drop researched watches with plans
 * on them. The rows are the Secular Compounder's 16 researched watches
 * (production, 2026-10-30), all LONG, four with a buy price set.
 */

const getUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
jest.mock("@/lib/auth/account", () => ({ getAccountId: async () => "acct-1" }));
jest.mock("next/cache", () => ({ revalidatePath: () => {} }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
jest.mock("@/lib/alpaca", () => ({ getLatestPricesWithMeta: async () => ({}) }));

const COMPOUNDER = "cmmqxola3000004lbj7c11bfn";
const WATCHES = ["AAPL", "ABBV", "ASML", "AVGO", "BWXT", "CRWD", "EME", "ETN", "FTNT", "GD", "ISRG", "MA", "NDAQ", "NOW", "SYK", "TRV"];

const thesisUpdate = jest.fn();
const thesisCreate = jest.fn(async ({ data }: { data: { ticker: string } }) => ({ id: `t-${data.ticker}` }));
const auditRow = jest.fn();
jest.mock("@/lib/prisma", () => ({
  prisma: {
    agentConfig: { findFirst: async () => ({ id: COMPOUNDER }), update: async () => ({}) },
    thesis: {
      findMany: async () => WATCHES.map((ticker) => ({ id: `w-${ticker}`, ticker, status: "WATCHING" })),
      update: (a: unknown) => thesisUpdate(a),
      create: (a: never) => thesisCreate(a),
    },
    thesisUpdate: { create: (a: unknown) => auditRow(a) },
    researchRun: { create: async () => ({ id: "editor-run" }) },
  },
}));

import { updateAnalystFromBuilder } from "@/lib/actions/analyst.actions";
import { toApplyInput } from "@/components/analysts/builder-config";
import { configSchema } from "@/lib/agent/tools/suggest-config";
import { buildEditorSystemPrompt, BUILDER_SYSTEM_PROMPT } from "@/lib/agent/modes";
import type { AgentConfigData } from "@/components/domain/agent-config-card";

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

it("an Apply whose watchlist leaves out the Compounder's 16 watches retires none of them", async () => {
  const proposal = configSchema.parse({
    name: "Secular Compounder", analystPrompt: "x", directionBias: "LONG", holdDurations: ["POSITION"],
    sectors: [], minConfidence: 70, maxPositionSize: 10000, maxOpenPositions: 10, minMarketCapTier: "LARGE",
    watchlist: [{ symbol: "VRT", reason: "Datacenter power; checked with get_stock_data." }],
  }) as AgentConfigData;

  await updateAnalystFromBuilder(COMPOUNDER, toApplyInput(proposal));

  expect(thesisUpdate).not.toHaveBeenCalled();
  expect(thesisCreate.mock.calls.map((c) => c[0].data.ticker)).toEqual(["VRT"]);
  expect(auditRow.mock.calls.map((c) => (c[0] as { data: { type: string } }).data.type)).toEqual(["CREATED"]);
});

it("neither prompt tells the model to narrow a fence", () => {
  const editor = buildEditorSystemPrompt({});
  for (const said of ["Narrow to the 2–4 industries", "narrow on purpose"]) expect({ said, found: editor.includes(said) }).toMatchObject({ found: false });
  expect(BUILDER_SYSTEM_PROMPT).not.toContain("leave a field empty only if");
});
