/**
 * The editor's Apply adds seeds and retires nothing, and its change list shows
 * only what Apply adds.
 *
 * Apply used to retire every WATCHING thesis its proposal left out, so an
 * editor that proposed a fresh list would drop researched watches with plans
 * on them. It also seeded a watch beside a stock the analyst holds. The rows
 * are the Secular Compounder's 16 researched watches and 7 holdings
 * (production, 2026-10-30).
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
const HOLDS = ["CEG", "GEV", "MSFT", "MU", "PLTR", "V", "WST"];
const ROWS = [
  ...WATCHES.map((ticker) => ({ id: `w-${ticker}`, ticker, status: "WATCHING" })),
  ...HOLDS.map((ticker) => ({ id: `h-${ticker}`, ticker, status: "HOLDING" })),
];

const thesisUpdate = jest.fn();
const thesisCreate = jest.fn(async ({ data }: { data: { ticker: string } }) => ({ id: `t-${data.ticker}` }));
const auditRow = jest.fn();
jest.mock("@/lib/prisma", () => ({
  prisma: {
    agentConfig: { findFirst: async () => ({ id: COMPOUNDER }), update: async () => ({}) },
    thesis: {
      findMany: async ({ where }: { where: { status: string | { in: string[] } } }) =>
        ROWS.filter((r) => (typeof where.status === "string" ? r.status === where.status : where.status.in.includes(r.status))),
      update: (a: unknown) => thesisUpdate(a),
      create: (a: never) => thesisCreate(a),
    },
    thesisUpdate: { create: (a: unknown) => auditRow(a) },
    researchRun: { create: async () => ({ id: "editor-run" }) },
  },
}));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { updateAnalystFromBuilder } from "@/lib/actions/analyst.actions";
import { ConfigPreviewRenderer } from "@/components/agent/renderers/ConfigPreviewRenderer";
import { ToolUICallbacksProvider } from "@/components/assistant-ui/tool-uis/tool-ui-shared";
import { toApplyInput } from "@/components/analysts/builder-config";
import { configSchema } from "@/lib/agent/tools/suggest-config";
import { buildEditorSystemPrompt, BUILDER_SYSTEM_PROMPT } from "@/lib/agent/modes";
import type { AgentConfigData } from "@/components/domain/agent-config-card";

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

const propose = (watchlist: unknown[]) =>
  configSchema.parse({
    name: "Secular Compounder", analystPrompt: "x", directionBias: "LONG", holdDurations: ["POSITION"],
    sectors: [], minConfidence: 70, maxPositionSize: 10000, maxOpenPositions: 10, minMarketCapTier: "LARGE",
    watchlist,
  }) as AgentConfigData;
const VRT = { symbol: "VRT", reason: "Datacenter power; checked with get_stock_data." };

// The editor's change list, as the edit page hands it the analyst.
function changeList(proposal: AgentConfigData): string {
  const callbacks = { currentConfig: { ...proposal, watchlist: WATCHES }, heldOrWatched: [...WATCHES, ...HOLDS], onConfirmConfig: () => {} };
  return renderToStaticMarkup(
    createElement(ToolUICallbacksProvider, { value: callbacks },
      createElement(ConfigPreviewRenderer, { result: { ok: true, ui: "config-preview", summary: "", data: proposal, sources: [] }, loading: false })),
  );
}

it("an Apply whose watchlist leaves out the Compounder's 16 watches retires none of them", async () => {
  const proposal = propose([VRT]);

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

it("an Apply that names a stock the Compounder holds seeds no watch beside it", async () => {
  await updateAnalystFromBuilder(COMPOUNDER, toApplyInput(propose([VRT, { symbol: "MSFT", reason: "Azure capex." }])));

  expect(thesisCreate.mock.calls.map((c) => c[0].data.ticker)).toEqual(["VRT"]);
});

it("the change list's Watchlist row is only what Apply adds, and never reads as a removal", () => {
  const html = changeList(propose([VRT, { symbol: "MSFT", reason: "Azure capex." }]));
  expect(html).toContain("+ VRT");
  for (const name of ["AAPL", "TRV", "MSFT"]) expect({ name, shown: html.includes(name) }).toMatchObject({ shown: false });

  expect(changeList(propose(WATCHES.map((symbol) => ({ symbol, reason: "kept" }))))).not.toContain("Watchlist");
});
