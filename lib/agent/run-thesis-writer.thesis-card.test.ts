/**
 * A Writer run's page shows the thesis it wrote. The run's thread is what its
 * page draws (convertPersistedToUIMessages), and the Writer's save is made by
 * code after the model's call, so the thread ended at submit_thesis's
 * `{ accepted: true }` and the page had no card to open the thesis: AS on
 * 2026-11-18 (run cmwmrbyr9000607jyddo6kl8r), and every Writer run since at
 * least 2026-09-21. The call that saved the thesis, and what it returned, now
 * end the thread, and the card renderer draws a card from them.
 *
 * Through writerPersistPhase, on that run's real thread and real decision
 * (lib/agent/__fixtures__/writer-as-2026-11-18.json); the database and the
 * save's tool are stood in for.
 */
const threads: string[] = [];
let saved: unknown = null;

jest.mock("@/lib/prisma", () => ({
  prisma: {
    agentConfig: {
      findUnique: async () => ({
        id: "analyst_pead",
        userId: "user_1",
        accountId: "account_1",
        name: "PEAD Specialist",
        setupIds: ["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"],
        analystPrompt: null,
        sectors: [],
        exclusionList: [],
        tradingEnvironment: "LIVE",
        minPositionSize: 3000,
        maxPositionSize: 8000,
        maxPositionTotal: 16000,
      }),
    },
    thesis: { findFirst: async () => null, findUnique: async () => null },
    thesisUpdate: { findFirst: async () => null, create: async () => ({}) },
    researchRun: { findUnique: async () => ({ parameters: {}, mode: "PRINCIPAL_CHAT" }), updateMany: async () => ({ count: 1 }), update: async () => ({}) },
    runEvent: { create: async () => ({}) },
    runMessage: {
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: { role: string; content: string } }) => (data.role === "thread" && threads.push(data.content), data),
    },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
  },
}));
jest.mock("@/lib/agent/watchlist-symbols", () => ({ getWatchlistSymbols: async () => [] }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
jest.mock("@/lib/agent/thesis-research/pull-data", () => ({ pullThesisData: jest.fn() }));
// The save, stood in: what record_thesis hands back through defineTool when it saves.
jest.mock("@/lib/agent/tools/record-thesis", () => ({
  recordThesis: () => ({ execute: async () => saved }),
}));
jest.mock("@/lib/agent/tools/update-thesis", () => ({ updateThesis: () => ({ execute: async () => ({ ok: false, error: "not this run's save" }) }) }));

import raw from "@/lib/agent/__fixtures__/writer-as-2026-11-18.json";
import { ratedNow } from "@/lib/replay/rated";
import type { ModelMessage } from "ai";
import { convertPersistedToUIMessages } from "@/lib/agent/convert-messages";
import { validateThesisDecision, type ThesisDecisionInput } from "@/lib/agent/thesis-research/decision";
import { writerPersistPhase, type WriterPullPhaseOutput, type WriterResearchPhaseOutput } from "./run-thesis-writer";

const fx = raw as unknown as { runId: string; ticker: string; mode: "mint"; thesisId: string; messages: ModelMessage[] };
const assistant = fx.messages[0] as { content: Array<{ type: string; text?: string; toolName?: string; input?: unknown }> };
const submitted = assistant.content.find((p) => p.type === "tool-call" && p.toolName === "submit_thesis")!.input as ThesisDecisionInput;
const noteText = assistant.content.flatMap((p) => (p.type === "text" && p.text ? [p.text] : [])).join("\n\n");
const PRICE = 34;

const pullOutput = {
  ok: true,
  pull: { rawDataBlock: "", pullErrors: [], currentPrice: PRICE, chart: { atr14: null, pivot: null, brokenOut: null, sma20: null, sma50: null, daysSinceReport: null }, companyName: "Amer Sports", exchange: "NYSE", pulledAt: "2026-11-18T23:33:00.000Z", catalystOnFile: null },
} as unknown as WriterPullPhaseOutput;

function research(): WriterResearchPhaseOutput {
  const v = validateThesisDecision(ratedNow(submitted), { mode: "mint", existingStatus: null, currentPrice: PRICE });
  if (!v.ok || !v.decision) throw new Error(`the recorded decision doesn't validate: ${v.errors.join("; ")}`);
  return { ok: true, noteText, decision: v.decision, threadMessages: fx.messages, userPrompt: "(the brief, left out of the fixture)", stepCount: 1, toolCallCount: 6, submitAttempts: 1, sectionCount: 3 };
}

const args = { childRunId: fx.runId, analystId: "analyst_pead", ticker: fx.ticker, mode: fx.mode, reason: "Sent from the chat." };

/** The run page's parts, from the thread the run saved. */
const pageParts = () => convertPersistedToUIMessages(JSON.parse(threads.at(-1)!)).flatMap((m) => m.parts as Array<Record<string, unknown>>);

beforeEach(() => {
  threads.length = 0;
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it("AS, 2026-11-18: the thread ends with the save, a card for the thesis it wrote", async () => {
  saved = { ok: true, ui: "thesis-card", summary: "Thesis recorded: LONG AS (watching)", data: { thesis_id: fx.thesisId, status: "WATCHING" }, sources: [] };
  const out = await writerPersistPhase(args, pullOutput, research(), Date.now());
  expect(out.thesisId).toBe(fx.thesisId);

  const parts = pageParts();
  // The model's own parts are as they were: its searches and its submit.
  expect(parts.filter((p) => p.type === "tool-web_search").length).toBeGreaterThan(0);
  expect(parts.some((p) => p.type === "tool-submit_thesis")).toBe(true);
  // Then the save: a record_thesis part with its result, which the card renderer draws (ToolCallRow → ThesisCardRenderer).
  const save = parts.at(-1)!;
  expect(save).toEqual(expect.objectContaining({ type: "tool-record_thesis", state: "output-available" }));
  expect(save.output).toEqual(expect.objectContaining({ ok: true, ui: "thesis-card", data: expect.objectContaining({ thesis_id: fx.thesisId }) }));
  // The card reads the stock and the view from the call's input.
  expect(save.input).toEqual(expect.objectContaining({ ticker: "AS", direction: submitted.direction }));
});

it("a save that didn't land puts no card on the page", async () => {
  saved = { ok: true, ui: "thesis-card", summary: "Thesis save failed for AS", data: { thesis_id: null, status: "FAILED", note: "Thesis could not be saved to DB." }, sources: [] };
  const out = await writerPersistPhase(args, pullOutput, research(), Date.now());
  expect(out.thesisId).toBeNull();
  expect(pageParts().some((p) => p.type === "tool-record_thesis")).toBe(false);
});
