/**
 * A new analyst is built from its playbook the way the three live analysts
 * were: the style comes from the playbook's data, never from the model.
 *
 * The answer key is the live rows (production, 2026-10-30). For each, the
 * builder names the playbook it would be built from and writes only words;
 * the real suggest_config fills the style in and the real Create saves it.
 * The Compounder's eleven sectors filter what no sectors filter: every one.
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
  const tx = { agentConfig: { create: (a: never) => create(a) } };
  return { prisma: { ...tx, $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } };
});

import { createAnalystFromBuilder } from "@/lib/actions/analyst.actions";
import { toCreateInput } from "@/components/analysts/builder-config";
import { builderConfigSchema, suggestConfigFor } from "@/lib/agent/tools/suggest-config";
import { STRATEGY_ARCHETYPES } from "@/lib/agent/knowledge/strategy-archetypes";
import { BUILDER_SYSTEM_PROMPT, buildEditorSystemPrompt } from "@/lib/agent/modes";
import { SECTORS } from "@/lib/universe/canonical";
import type { AgentConfigData } from "@/components/domain/agent-config-card";

const ALL_SECTORS = ["Information Technology", "Health Care", "Industrials", "Utilities", "Communication Services", "Energy", "Materials", "Consumer Discretionary", "Consumer Staples", "Financials", "Real Estate"];
const LIVE = [
  { name: "PEAD Specialist", playbook: "EARNINGS_DRIFT", setupIds: ["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"], holdDurations: ["SWING", "POSITION"], minConfidence: 60, maxOpenPositions: 6, sectors: [], marketCapMin: 200_000_000, marketCapMax: null },
  { name: "Catalyst Event PM", playbook: "CATALYST_EVENT", setupIds: ["PRE_CATALYST", "BASE_BREAKOUT", "MA_PULLBACK"], holdDurations: ["SWING", "POSITION"], minConfidence: 50, maxOpenPositions: 5, sectors: ["Health Care", "Information Technology"], marketCapMin: 500_000_000, marketCapMax: 20_000_000_000 },
  { name: "Secular Compounder", playbook: "THEMATIC_SECULAR", setupIds: ["COMPOUNDER_ACCUMULATION", "BASE_BREAKOUT", "MA_PULLBACK"], holdDurations: ["POSITION"], minConfidence: 70, maxOpenPositions: 10, sectors: ALL_SECTORS, marketCapMin: null, marketCapMax: null },
];

const fence = (sectors: string[]) => (sectors.length === 0 || sectors.length === SECTORS.length ? "every sector" : [...sectors].sort());
const big = (n: number | null) => (n == null ? null : BigInt(n));

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

describe.each(LIVE)("$name, built from $playbook", (live) => {
  it("gets its live setups, hold, confidence, slots and fence, and the default money, from the playbook alone", async () => {
    const playbook = STRATEGY_ARCHETYPES.find((a) => a.id === live.playbook)!;
    // The model writes words and a watchlist; it types no style.
    const call = builderConfigSchema.parse({ playbook: live.playbook, name: live.name, description: playbook.tagline, analystPrompt: playbook.promptSkeleton, watchlist: [] });
    const proposal = (await suggestConfigFor("builder").execute!(call as never, { toolCallId: "t", messages: [] })) as AgentConfigData;
    await createAnalystFromBuilder(toCreateInput(proposal));
    const row = create.mock.calls[0][0].data as Record<string, unknown>;

    expect({ ...row, sectors: fence(row.sectors as string[]) }).toMatchObject({
      setupIds: live.setupIds,
      holdDurations: live.holdDurations,
      minConfidence: live.minConfidence,
      maxOpenPositions: live.maxOpenPositions,
      sectors: fence(live.sectors),
      marketCapMin: big(live.marketCapMin),
      marketCapMax: big(live.marketCapMax),
      directionBias: "LONG",
      minPositionSize: 3000,
      maxPositionSize: 8000,
    });
  });
});

describe("the strategy text is seven parts, with no number a setting, setup or account rule owns", () => {
  const PARTS = ["The edge.", "What counts.", "What it skips.", "When it buys.", "When it's done.", "How it sizes, in words.", "What it never does."];
  // A percent, a dollar amount, a multiple, a count of days or of stocks, or a setup's catalog code.
  const OWNED = /\d+(\.\d+)?\s*%|\$\s?\d|\b\d+(\.\d+)?\s*[x×]\b|\b\d+\s*(days?|weeks?|months?|sessions?|names|stocks|positions)\b|\bD\d\b/i;

  it.each(STRATEGY_ARCHETYPES.map((a) => [a.id, a.promptSkeleton] as const))("%s", (_id, text) => {
    expect(PARTS.filter((p) => !text.includes(`**${p}**`))).toEqual([]);
    expect(text.match(OWNED)?.[0] ?? null).toBeNull();
  });

  it("the builder and the editor ask for the same seven parts", () => {
    for (const prompt of [BUILDER_SYSTEM_PROMPT, buildEditorSystemPrompt({})]) {
      expect(prompt).toContain("**When it's done** — what ends a position");
      expect(prompt).not.toContain("entry/exit, risk");
    }
  });
});
