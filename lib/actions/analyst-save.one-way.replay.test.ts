/**
 * An analyst is saved one way: Create, the editor's Apply and Settings all go
 * through normalizeAnalystPatch, and a new analyst starts from
 * NEW_ANALYST_DEFAULTS. Each case is a value one door used to store that
 * another would refuse.
 *
 * Rows are production, 2026-10-30: the Catalyst Event PM ($3,000 → $8,000,
 * $16,000 in one stock, $500M–$20B), the EV Catalyst Event Trader (a stored $0
 * market-cap floor) and the Secular Compounder (16 watches, 7 holdings).
 */

const getUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
jest.mock("@/lib/auth/account", () => ({ getAccountId: async () => "acct-1" }));
jest.mock("next/cache", () => ({ revalidatePath: () => {} }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
jest.mock("@/lib/alpaca", () => ({ getLatestPricesWithMeta: async () => ({}) }));
jest.mock("@/lib/agent/triggers/seed-analyst", () => ({ seedAnalystTriggers: async () => {} }));

const CATALYST = { id: "cmmmh0wxu000004js7yoyzvlf", name: "Catalyst Event PM", analystPrompt: "Buys ahead of dated catalysts.", minPositionSize: 3000, maxPositionSize: 8000, maxPositionTotal: 16000 };
const EV = { id: "cmnc0ezha0000ygy7m5y0pkco", name: "EV Catalyst Event Trader", analystPrompt: "EV catalysts.", minPositionSize: 0, maxPositionSize: 2000, maxPositionTotal: 4000 };
const COMPOUNDER = { id: "cmmqxola3000004lbj7c11bfn", name: "Secular Compounder", analystPrompt: "Multi-year compounders.", minPositionSize: 4000, maxPositionSize: 10000, maxPositionTotal: 20000 };
const ROWS: Record<string, object> = { [CATALYST.id]: CATALYST, [EV.id]: EV, [COMPOUNDER.id]: COMPOUNDER };
const WATCHES = ["AAPL", "ABBV", "ASML", "AVGO", "BWXT", "CRWD", "EME", "ETN", "FTNT", "GD", "ISRG", "MA", "NDAQ", "NOW", "SYK", "TRV"];
const HOLDS = ["CEG", "GEV", "MSFT", "MU", "PLTR", "V", "WST"];

const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "new-analyst", ...data }));
const update = jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id, ...data }));
const thesisCreate = jest.fn(async ({ data }: { data: { ticker: string } }) => ({ id: `t-${data.ticker}`, ticker: data.ticker }));
const activityLine = jest.fn(async (a: { data: Record<string, unknown> }) => a.data);
jest.mock("@/lib/prisma", () => {
  const agentConfig = {
    create: (a: never) => create(a),
    update: (a: never) => update(a),
    findFirst: async ({ where }: { where: { id: string } }) => ROWS[where.id] ?? null,
  };
  const thesis = {
    findMany: async ({ where }: { where: { researchRun?: { agentConfigId?: string } } }) =>
      where.researchRun?.agentConfigId === COMPOUNDER.id ? [...WATCHES, ...HOLDS].map((ticker) => ({ ticker })) : [],
    create: (a: never) => thesisCreate(a),
  };
  const tx = { agentConfig, thesis, researchRun: { create: async () => ({ id: "seed-run" }) }, thesisUpdate: { create: (a: never) => activityLine(a), createMany: async () => ({}) } };
  return { prisma: { ...tx, $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } };
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createAnalystFromBuilder, updateAnalystField, updateAnalystFromBuilder } from "@/lib/actions/analyst.actions";
import { editorPanelStart, toApplyInput, toCreateInput, toFormValues } from "@/components/analysts/builder-config";
import { ConfigPreviewRenderer } from "@/components/agent/renderers/ConfigPreviewRenderer";
import { ToolUICallbacksProvider } from "@/components/assistant-ui/tool-uis/tool-ui-shared";
import type { AgentConfigData } from "@/components/domain/agent-config-card";

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

const written = () => update.mock.calls.at(-1)?.[0].data ?? {};
const settings = async (row: { id: string }, field: string, value: unknown) => {
  await updateAnalystField(row.id, field as never, value);
  return written();
};

describe("a new analyst starts from one set of defaults", () => {
  it("the panel and Create agree: long, swing, $3,000 → $8,000, confidence 60, 5 slots, most in one stock live", async () => {
    const proposal = { name: "Drift Hunter", analystPrompt: "Post-earnings drift." } as AgentConfigData;
    expect(toFormValues(proposal)).toMatchObject({ directionBias: "LONG", holdDurations: ["SWING"], minPositionSize: 3000, maxPositionSize: 8000, minConfidence: 60, maxOpenPositions: 5 });

    await createAnalystFromBuilder(toCreateInput(proposal));
    expect(create.mock.calls[0][0].data).toMatchObject({
      directionBias: "LONG", holdDurations: ["SWING"], minPositionSize: 3000, maxPositionSize: 8000, minConfidence: 60, maxOpenPositions: 5,
      // 0 = twice the largest trade, read live: raising the largest later raises it too.
      maxPositionTotal: 0, riskPct: 1, tradingEnvironment: "PAPER", runDaysOfWeek: [1, 2, 3, 4, 5], emailAlerts: true,
    });
  });
});

describe("the money settings stay in order, at every door", () => {
  it("a largest trade under $100 (a fat-fingered 0) or a negative smallest is dropped: $3,000 → $8,000 → $16,000 stay", async () => {
    for (const [field, value] of [["maxPositionSize", 0], ["maxPositionSize", 50], ["minPositionSize", -500], ["maxPositionTotal", -1]] as const) {
      await updateAnalystField(CATALYST.id, field, value);
      expect({ field, value, wrote: update.mock.calls.length }).toEqual({ field, value, wrote: 0 });
    }
  });

  it("a smallest trade set above the largest raises the largest to it", async () => {
    expect(await settings(CATALYST, "minPositionSize", 9000)).toEqual({ minPositionSize: 9000, maxPositionSize: 9000 });
  });

  it("raising the largest above most in one stock raises most in one stock with it", async () => {
    expect(await settings(CATALYST, "maxPositionSize", 20000)).toEqual({ maxPositionSize: 20000, maxPositionTotal: 20000 });
  });

  it("lowering most in one stock below the largest lowers the largest to it", async () => {
    expect(await settings(CATALYST, "maxPositionTotal", 5000)).toEqual({ maxPositionTotal: 5000, maxPositionSize: 5000 });
  });
});

describe("a $0 market cap means no bound, at every door", () => {
  it("Settings", async () => {
    expect(await settings(EV, "marketCapMax", 0)).toEqual({ marketCapMax: null });
  });
  it("Apply", async () => {
    await updateAnalystFromBuilder(EV.id, toApplyInput({ marketCapMax: 0 } as AgentConfigData));
    expect(written()).toMatchObject({ marketCapMax: null });
  });
  it("Create, from the panel", async () => {
    await createAnalystFromBuilder(toCreateInput({ name: "x", analystPrompt: "x", marketCapMax: 0 } as AgentConfigData));
    expect(create.mock.calls[0][0].data).toMatchObject({ marketCapMax: null });
  });
  it("the editor can remove the Catalyst's $20B ceiling", async () => {
    const panel = editorPanelStart({ ...CATALYST, marketCapMin: 500_000_000, marketCapMax: 20_000_000_000 }, { marketCapMax: null } as AgentConfigData);
    await updateAnalystFromBuilder(CATALYST.id, toApplyInput(panel));
    expect(written()).toMatchObject({ marketCapMin: BigInt(500_000_000), marketCapMax: null });
  });
});

describe("tickers are cleaned and each saved once", () => {
  it("Apply seeds $vrt and ' VRT ' once, and nothing beside a held MSFT", async () => {
    const watchlist = [{ symbol: "$vrt", reason: "Datacenter power." }, { symbol: " VRT ", reason: "again" }, { symbol: "anet", reason: "Networking." }, { symbol: "MSFT", reason: "held" }];
    await updateAnalystFromBuilder(COMPOUNDER.id, toApplyInput({ watchlist } as AgentConfigData));
    expect(thesisCreate.mock.calls.map((c) => c[0].data.ticker)).toEqual(["VRT", "ANET"]);
  });
  it("the editor's seed line in Activity is a title, never a paragraph", async () => {
    await updateAnalystFromBuilder(COMPOUNDER.id, toApplyInput({ watchlist: [{ symbol: "VRT", reason: "Datacenter power." }] } as AgentConfigData));
    const line = activityLine.mock.calls[0][0].data;
    expect(line).toMatchObject({ type: "CREATED", summary: "Editor added VRT to watchlist (awaiting first research)" });
    expect(line).not.toHaveProperty("rationale");
    // The reason stays on the seed itself.
    expect(thesisCreate.mock.calls[0][0].data).toMatchObject({ sourceRationale: "Datacenter power.", snapshot: { text: "Datacenter power." } });
  });
  it("Settings stores exclusions upper case, each once", async () => {
    expect(await settings(CATALYST, "exclusionList", ["tsla", "$nvda", "TSLA"])).toEqual({ exclusionList: ["TSLA", "NVDA"] });
  });
});

describe("a save never wipes or overflows a setting", () => {
  it("an empty strategy keeps the stored one, in Settings and Apply", async () => {
    await updateAnalystField(CATALYST.id, "analystPrompt", "  ");
    expect(update).not.toHaveBeenCalled();
    await updateAnalystFromBuilder(CATALYST.id, toApplyInput({ analystPrompt: "" } as AgentConfigData));
    expect(written()).not.toHaveProperty("analystPrompt");
  });
  it("confidence is 0–100 and slots 1–20, whole numbers", async () => {
    expect(await settings(CATALYST, "minConfidence", 150)).toEqual({ minConfidence: 100 });
    expect(await settings(CATALYST, "minConfidence", 72.6)).toEqual({ minConfidence: 73 });
    expect(await settings(CATALYST, "maxOpenPositions", 0)).toEqual({ maxOpenPositions: 1 });
    expect(await settings(CATALYST, "maxOpenPositions", 25)).toEqual({ maxOpenPositions: 20 });
  });
});

it("the editor's change list shows no row for money or a direction the proposal leaves out", () => {
  const current = { ...CATALYST, directionBias: "LONG", holdDurations: ["SWING", "POSITION"], minConfidence: 50, maxOpenPositions: 5, watchlist: [] };
  const proposal = { name: CATALYST.name, analystPrompt: CATALYST.analystPrompt, holdDurations: ["SWING", "POSITION"], minConfidence: 55, maxOpenPositions: 5 } as AgentConfigData;
  const html = renderToStaticMarkup(
    createElement(ToolUICallbacksProvider, { value: { currentConfig: current, onConfirmConfig: () => {} } },
      createElement(ConfigPreviewRenderer, { result: { ok: true, ui: "config-preview", summary: "", data: proposal, sources: [] }, loading: false })),
  );
  expect(html).toContain("Min Confidence");
  for (const label of ["Direction", "Min Position Size", "Max Position Size"]) expect({ label, shown: html.includes(label) }).toMatchObject({ shown: false });
});
