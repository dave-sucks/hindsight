/**
 * The analyst settings nothing read are gone from the code: no schema the
 * model fills carries them, no save writes them, and a new row's database
 * defaults are a new analyst's (NEW_ANALYST_DEFAULTS). The columns stay in
 * the database until a later migration drops them.
 *
 * The row is the live Catalyst Event PM (production, 2026-10-30).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const getUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
jest.mock("@/lib/auth/account", () => ({ getAccountId: async () => "acct-1" }));
jest.mock("next/cache", () => ({ revalidatePath: () => {} }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
jest.mock("@/lib/alpaca", () => ({ getLatestPricesWithMeta: async () => ({}) }));
jest.mock("@/lib/agent/triggers/seed-analyst", () => ({ seedAnalystTriggers: async () => {} }));
jest.mock("@/lib/intelligence/sonar", () => ({ searchSignals: jest.fn(async () => ({ signals: [] })) }));

const CATALYST = { id: "cmmmh0wxu000004js7yoyzvlf", name: "Catalyst Event PM", analystPrompt: "Buys ahead of dated catalysts.", minPositionSize: 3000, maxPositionSize: 8000, maxPositionTotal: 16000 };
const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "new-analyst", ...data }));
const update = jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id, ...data }));
jest.mock("@/lib/prisma", () => {
  const agentConfig = { create: (a: never) => create(a), update: (a: never) => update(a), findFirst: async () => CATALYST };
  const tx = { agentConfig, thesis: { findMany: async () => [] } };
  return { prisma: { ...tx, $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } };
});

import { zodSchema } from "ai";
import { createAnalystFromBuilder, updateAnalystField, updateAnalystFromBuilder } from "@/lib/actions/analyst.actions";
import { editorPanelStart, toApplyInput, toCreateInput } from "@/components/analysts/builder-config";
import { builderConfigSchema, editorConfigSchema, suggestConfigFor } from "@/lib/agent/tools/suggest-config";
import { webSearch } from "@/lib/agent/tools/web-search";
import { NEW_ANALYST_DEFAULTS } from "@/lib/analyst-settings";
import type { AgentConfigData } from "@/components/domain/agent-config-card";
import type { ToolContext } from "@/lib/agent/tool-context";

const REMOVED = [
  "signalTypes", "minMarketCapTier", "dailyLossLimit", "scheduleTime", "priceCheckFreq", "weekendMode",
  "tradePolicyAutoTrade", "strategyType", "strategyInstructions", "analystVoice", "conceptPromptExtra",
  "thesisPromptExtra", "tickerUniverse", "digestEmail", "weeklyDigestEnabled", "markets", "exchanges",
  "graduationProfitFactor", "intelligencePolicy", "industries", "themes",
];
const leftover = (o: object) => REMOVED.filter((k) => k in o);
const MODEL = (() => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const start = schema.indexOf("model AgentConfig {");
  return schema.slice(start, schema.indexOf("\n}", start));
})();

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

it("the schema declares none of them, and neither suggest_config schema carries one", () => {
  expect(REMOVED.filter((k) => new RegExp(`^\\s+${k}\\s`, "m").test(MODEL))).toEqual([]);
  for (const schema of [builderConfigSchema, editorConfigSchema]) {
    expect(leftover((zodSchema(schema as never).jsonSchema as { properties: object }).properties)).toEqual([]);
  }
});

it("a new row's database defaults are a new analyst's", () => {
  const dflt = (field: string) => MODEL.match(new RegExp(`^\\s+${field}\\s+\\S+\\s+@default\\(([^)]*)\\)`, "m"))?.[1];
  const D = NEW_ANALYST_DEFAULTS;
  expect({
    minPositionSize: dflt("minPositionSize"), maxPositionSize: dflt("maxPositionSize"), minConfidence: dflt("minConfidence"),
    maxOpenPositions: dflt("maxOpenPositions"), directionBias: dflt("directionBias"), holdDurations: dflt("holdDurations"),
    riskPct: dflt("riskPct"), maxPositionTotal: dflt("maxPositionTotal"), tradingEnvironment: dflt("tradingEnvironment"),
    runDaysOfWeek: dflt("runDaysOfWeek"), emailAlerts: dflt("emailAlerts"),
  }).toEqual({
    minPositionSize: String(D.minPositionSize), maxPositionSize: String(D.maxPositionSize), minConfidence: String(D.minConfidence),
    maxOpenPositions: String(D.maxOpenPositions), directionBias: `"${D.directionBias}"`, holdDurations: `[${D.holdDurations.map((h) => `"${h}"`).join(", ")}]`,
    riskPct: String(D.riskPct), maxPositionTotal: String(D.maxPositionTotal), tradingEnvironment: `"${D.tradingEnvironment}"`,
    runDaysOfWeek: `[${D.runDaysOfWeek.join(", ")}]`, emailAlerts: String(D.emailAlerts),
  });
  // This change only sets defaults; the columns are dropped later, once it is live.
  const sql = readFileSync(join(process.cwd(), "prisma/migrations/20261031120000_new_analyst_defaults/migration.sql"), "utf8");
  expect(sql).toContain('ALTER COLUMN "directionBias" SET DEFAULT \'LONG\'');
  expect(sql).not.toMatch(/\bDROP\b/i);
});

it("Create, Apply and Settings write none of them, and each still saves", async () => {
  const call = builderConfigSchema.parse({ playbook: "CATALYST_EVENT", name: CATALYST.name, analystPrompt: CATALYST.analystPrompt });
  const proposal = (await suggestConfigFor("builder").execute!(call as never, { toolCallId: "t", messages: [] })) as AgentConfigData;
  await createAnalystFromBuilder(toCreateInput(proposal));
  const created = create.mock.calls[0][0].data;
  expect(leftover(created)).toEqual([]);
  expect(created).toMatchObject({ name: CATALYST.name, setupIds: ["PRE_CATALYST", "BASE_BREAKOUT", "MA_PULLBACK"], marketCapMin: BigInt(500_000_000) });

  const edit = editorConfigSchema.parse({ name: CATALYST.name, analystPrompt: CATALYST.analystPrompt, holdDurations: ["SWING"], sectors: ["Health Care"], minConfidence: 55, maxOpenPositions: 5 });
  await updateAnalystFromBuilder(CATALYST.id, toApplyInput(editorPanelStart({ ...CATALYST }, edit as AgentConfigData)));
  const applied = update.mock.calls.at(-1)![0].data;
  expect(leftover(applied)).toEqual([]);
  expect(applied).toMatchObject({ sectors: ["Health Care"], minConfidence: 55 });

  await updateAnalystField(CATALYST.id, "sectors", ["Health Care", "Information Technology"]);
  expect(update.mock.calls.at(-1)![0].data).toEqual({ sectors: ["Health Care", "Information Technology"] });
});

it("a budget stored on an analyst no longer changes a run's searches: every run gets the same five", async () => {
  // The old shape, a budget of one, as a stored row would have carried it.
  const ctx = { runId: "run-budget", userId: "u", accountId: "a", intelligencePolicy: { allowLiveSearch: true, liveSearchBudget: 1 } } as unknown as ToolContext;
  const search = (webSearch(ctx) as unknown as { execute: (a: object) => Promise<{ data?: { allowed?: boolean; budgetUsed: number } }> }).execute;
  for (let i = 1; i <= 5; i++) expect((await search({ query: `sector news ${i}` })).data?.budgetUsed).toBe(i);
  expect((await search({ query: "one more" })).data?.allowed).toBe(false);
});
