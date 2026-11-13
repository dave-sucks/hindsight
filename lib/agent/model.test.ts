/**
 * model.test.ts — every agent's model keeps the request its call started
 * with, exactly as it went over the wire (model.ts).
 *
 * Through each door's real entry point, the SDK's own loop and the real
 * provider, with only the network stood in for: the 8 AM morning run (Chat
 * Completions), a trigger run (Responses), one chat message (Anthropic, the
 * chat's model) and the Writer's research call (Anthropic). Each kept record
 * is the first body the provider sent, byte for byte, and the run page reads
 * it in its parts.
 */
import { generateText, tool } from "ai";
import { z } from "zod";
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow } from "@/lib/replay";
import type { RequestRecord } from "@/lib/agent/run-requests";
import raw from "@/lib/agent/__fixtures__/writer-and-trade-refusals-2026-09-25.json";

process.env.OPENAI_API_KEY ??= "test";
process.env.ANTHROPIC_API_KEY ??= "test";
const ANALYST = "cmmqxola3000004lbj7c11bfn";
type Db = ReturnType<typeof prismaDouble>;
type Kept = { runId: string; role: string; content: string };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** The network: every provider request's body, in order; the nth gets reply(n). */
function network(reply: (n: number) => Response) {
  const sent: string[] = [];
  const spy = jest.spyOn(globalThis, "fetch").mockImplementation((async (_u: unknown, init?: RequestInit) => (sent.push(String(init?.body)), reply(sent.length))) as typeof fetch);
  return { sent, restore: () => spy.mockRestore() };
}
const kept = (db: Db) => ((db.store.runMessage ?? []) as Kept[]).filter((m) => m.role === "request").map((m) => ({ runId: m.runId, record: JSON.parse(m.content) as RequestRecord }));
const asSent = (r: RequestRecord) => r.requests.map((b) => JSON.stringify(b));
const step = { run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)), sendEvent: jest.fn() };
const inngest = (set: (h: (ctx: unknown) => Promise<unknown>) => void) => ({ inngest: { createFunction: (_c: unknown, _t: unknown, h: (ctx: unknown) => Promise<unknown>) => (set(h), {}), send: async () => {} } });
const undo = (mods: string[]) => mods.forEach((m) => jest.dontMock(m));
afterEach(() => jest.restoreAllMocks());

describe("modelFor", () => {
  it("keeps the first request of a call and none after; with no run it keeps nothing; a failed save never breaks the call", async () => {
    const reply = () => json({ id: "c", object: "chat.completion", created: 1, model: "gpt-5.4", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Hi." } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    const net = network(reply);
    const rows: Kept[] = [];
    let failing = false;
    const saving = { runMessage: { create: async ({ data }: { data: Kept }) => (failing ? Promise.reject(new Error("db down")) : (rows.push(data), data)) } };
    jest.spyOn(console, "error").mockImplementation(() => {});
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: saving }));
      const { modelFor } = await import("@/lib/agent/model");
      const model = modelFor("gpt-5.4", { api: "chat", runId: "run_1", call: "Main", source: "test" });
      await generateText({ model, prompt: "One." });
      await generateText({ model, prompt: "Two." });
      await generateText({ model: modelFor("gpt-5.4", { api: "chat", call: "Main", source: "test" }), prompt: "No run." });
      failing = true;
      expect((await generateText({ model: modelFor("gpt-5.4", { api: "chat", runId: "run_2", call: "Main", source: "test" }), prompt: "Save fails." })).text).toBe("Hi.");
    });
    undo(["@/lib/prisma"]);
    net.restore();
    expect(net.sent).toHaveLength(4);
    expect(rows.map((k) => [k.runId, asSent(JSON.parse(k.content))])).toEqual([["run_1", [net.sent[0]]]]);
  });
});

describe("the morning run", () => {
  it("the 8 AM job's call keeps its first request, as sent over Chat Completions", async () => {
    const db = prismaDouble({ agentConfig: [agentConfigRow({ id: ANALYST, name: "Secular Compounder", enabled: true, tradingEnvironment: "PAPER", runDaysOfWeek: [1, 2, 3, 4, 5] })], researchRun: [], runMessage: [], runEvent: [] });
    const done = () => json({ id: "c1", object: "chat.completion", created: 1, model: "gpt-5.4", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Done." } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    const net = network(done);
    const runInput = { portfolio: { cash: 0, buyingPower: 0, portfolioValue: 0, positions: [], exposure: { long: 0, short: 0, net: 0, utilizationPct: 0 } }, watchlist: [], activeTheses: [], triggersFiredSinceLastRun: [], triggersMatchingNow: [], earnings: { reportingSoon: [], justReported: [] }, filings: { recent: [] }, openRefusals: [] };
    const mods = ["@/lib/prisma", "@/lib/inngest/client", "@/lib/agent/watchlist-symbols", "@/lib/actions/api-keys.actions", "@/lib/agent/triggers/seed-account", "@/lib/agent/run-input", "@/lib/agent/knowledge/load-setup-overrides", "@/lib/agent/tools"];
    let view: typeof import("@/lib/agent/run-requests").viewOfRecord | undefined;
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => inngest((h) => (handler = h)));
      jest.doMock("@/lib/agent/watchlist-symbols", () => ({ getWatchlistSymbols: async () => [] }));
      jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
      jest.doMock("@/lib/agent/triggers/seed-account", () => ({ ensureAccountStandingRules: async () => 0 }));
      jest.doMock("@/lib/agent/run-input", () => ({ buildRunInput: async () => runInput }));
      jest.doMock("@/lib/agent/knowledge/load-setup-overrides", () => ({ loadSetupOverrides: async () => ({}) }));
      jest.doMock("@/lib/agent/tools", () => ({ createResearchTools: () => ({ get_theses: tool({ description: "Read the book.", inputSchema: z.object({ tickers: z.array(z.string()).optional() }), execute: async () => ({ ok: true }) }) }) }));
      await import("@/lib/inngest/functions/morning-research");
      await handler!({ event: { name: "app/research.run", data: { agentConfigId: ANALYST } }, step }).catch(() => undefined);
      view = (await import("@/lib/agent/run-requests")).viewOfRecord;
    });
    undo(mods);
    net.restore();
    const [main, ...more] = kept(db);
    expect(main.runId).toBe((db.store.researchRun as Array<{ id: string }>)[0].id);
    expect(main.record).toMatchObject({ call: "Main", source: "morning-research", model: "gpt-5.4" });
    expect(asSent(main.record)).toEqual([net.sent[0]]);
    // The run's retry, when it made one, keeps its own first request.
    for (const k of more) expect(net.sent).toContain(asSent(k.record)[0]);
    expect(view!(main.record).categories.map((c) => c.name)).toEqual(["Instructions", "First message", "Tool menu"]);
  });
});

describe("a trigger run", () => {
  it("V's floor, Send to Agent: the run's call keeps its first request over the Responses API, not the second", async () => {
    const FLOOR = { id: "84f59b07-5ad2-4f6c-882a-83f5ecce81a7", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 395 }, rationale: "Sell if below $395.", cooldownDays: 1 };
    const db = prismaDouble({
      thesis: [thesisRow({ id: "v", ticker: "V", status: "HOLDING", direction: "LONG", analystId: ANALYST, triggers: [FLOOR] })],
      position: [positionRow({ id: "pos_v", symbol: "V", analystId: ANALYST, environment: "LIVE", quantity: 10, avgCost: 350 })],
      agentConfig: [agentConfigRow({ id: ANALYST, name: "Secular Compounder", tradingEnvironment: "LIVE", maxOpenPositions: 10 })],
      account: [accountRow({ requireApprovalBuysLive: true, requireApprovalSellsLive: true })],
    });
    const out = (n: number) => (n === 1 ? { type: "function_call", id: "fc_1", call_id: "call_1", name: "update_thesis", arguments: JSON.stringify({ thesis_id: "v", rationale: "Held." }), status: "completed" } : { type: "message", id: "msg_2", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Held.", annotations: [] }] });
    const net = network((n) => json({ id: `resp_${n}`, object: "response", created_at: 1, model: "gpt-5.4", status: "completed", output: [out(n)], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
    const mods = ["@/lib/prisma", "@/lib/inngest/client", "@/lib/actions/api-keys.actions", "@/lib/actions/closeTrade.actions", "@/lib/trading/manual-order", "@/lib/agent/tools"];
    let view: typeof import("@/lib/agent/run-requests").viewOfRecord | undefined;
    await jest.isolateModulesAsync(async () => {
      let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => inngest((h) => (handler = h)));
      jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
      jest.doMock("@/lib/actions/closeTrade.actions", () => ({ closeOpenPosition: jest.fn() }));
      jest.doMock("@/lib/trading/manual-order", () => ({ accountCash: async () => 50_000 }));
      // The close-out writes its row, as update_thesis would.
      const review = async (a: { thesis_id: string; rationale: string }) => {
        const run = (db.store.researchRun as Array<{ id: string }>)[0];
        await (db as unknown as { thesisUpdate: { create: (x: unknown) => Promise<unknown> } }).thesisUpdate.create({ data: { thesisId: a.thesis_id, type: "REVIEWED", summary: "Reviewed", rationale: a.rationale, runId: run.id, timestamp: new Date() } });
        return { ok: true };
      };
      const read = tool({ description: "Read the stock.", inputSchema: z.object({ tickers: z.array(z.string()) }), execute: async () => ({ ok: false }) });
      jest.doMock("@/lib/agent/tools", () => ({ createResearchTools: () => ({ get_theses: read, update_thesis: tool({ description: "Write the review.", inputSchema: z.object({ thesis_id: z.string(), rationale: z.string() }), execute: review }) }) }));
      await import("@/lib/inngest/functions/tactical-run");
      await handler!({ event: { data: { thesisId: "v", triggerId: FLOOR.id, analystId: ANALYST, ticker: "V", action: "EXIT", firedPrice: 394.5 } }, step });
      view = (await import("@/lib/agent/run-requests")).viewOfRecord;
    });
    undo(mods);
    net.restore();
    expect(net.sent).toHaveLength(2);
    const [main, ...more] = kept(db);
    expect(more).toEqual([]);
    expect(main.runId).toBe((db.store.researchRun as Array<{ id: string }>)[0].id);
    expect(main.record).toMatchObject({ call: "Main", source: "tactical-run", model: "gpt-5.4" });
    expect(asSent(main.record)).toEqual([net.sent[0]]);
    const categories = view!(main.record).categories;
    expect(categories.map((c) => c.name)).toEqual(["Instructions", "First message", "Tool menu"]);
    expect(categories[1].sections.map((s) => s.text).join("")).toMatch(/^Tactical run on \$V\./);
  });
});

describe("the chat", () => {
  it("each message keeps its first request over Anthropic, the newest replacing the one before", async () => {
    const db = prismaDouble({ researchRun: [], runMessage: [], runEvent: [], agentConfig: [] });
    const events = [
      { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Held." } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ];
    const net = network(() => new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } }));
    const mods = ["@/lib/prisma", "@/lib/supabase/server", "@/lib/auth/account", "@/lib/actions/api-keys.actions", "@vercel/functions", "@/lib/agent/tools", "@/lib/actions/environment.actions", "@/lib/portfolio/load-snapshot"];
    const user = (id: string, text: string) => ({ id, role: "user", parts: [{ type: "text", text }] });
    let view: typeof import("@/lib/agent/run-requests").viewOfRecord | undefined;
    const post = async (messages: unknown[]) =>
      jest.isolateModulesAsync(async () => {
        const pending: Promise<unknown>[] = [];
        jest.doMock("@/lib/prisma", () => ({ prisma: db }));
        jest.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user_1" } } }) } }) }));
        jest.doMock("@/lib/auth/account", () => ({ getAccountId: async () => "acct_1", getUserRole: async () => "OWNER" }));
        jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
        jest.doMock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p) }));
        jest.doMock("@/lib/agent/tools", () => ({ createResearchTools: () => ({}) }));
        jest.doMock("@/lib/actions/environment.actions", () => ({ getCurrentEnvironment: async () => "LIVE" }));
        jest.doMock("@/lib/portfolio/load-snapshot", () => ({ loadPortfolioSnapshot: async () => null }));
        const { POST } = await import("@/app/api/agent/[mode]/route");
        const res = await POST(new Request("http://localhost/api/agent/principal", { method: "POST", body: JSON.stringify({ chatSessionId: "chat_1", messages }) }), { params: Promise.resolve({ mode: "principal" }) });
        await res.text();
        await Promise.allSettled(pending);
        view = (await import("@/lib/agent/run-requests")).viewOfRecord;
      });
    await post([user("m1", "How is V doing?")]);
    // The database defaults agentConfigId to null; the double leaves it unset.
    (db.store.researchRun as Array<{ agentConfigId?: string | null }>).forEach((r) => (r.agentConfigId ??= null));
    await post([user("m1", "How is V doing?"), { id: "a1", role: "assistant", parts: [{ type: "text", text: "Held." }] }, user("m2", "Why hold it?")]);
    undo(mods);
    net.restore();
    expect(net.sent).toHaveLength(2);
    const runs = db.store.researchRun as Array<{ id: string; mode: string }>;
    expect(runs.map((r) => r.mode)).toEqual(["PRINCIPAL_CHAT"]);
    const [only, ...more] = kept(db);
    expect(more).toEqual([]);
    expect(only.runId).toBe(runs[0].id);
    expect(only.record).toMatchObject({ call: "Message", source: "agent/principal", model: "claude-sonnet-4-6" });
    expect(asSent(only.record)).toEqual([net.sent[1]]);
    const categories = view!(only.record).categories;
    expect(categories.map((c) => c.name)).toEqual(["Instructions", "First message", "The conversation so far", "Newest message", "Tool menu"]);
    // The newest message: the time, the Market and portfolio block cut at its headings, then the question.
    expect(categories[3].sections.map((s) => s.label)).toEqual(["Opening", "Market and portfolio", "Market digest", "Portfolio snapshot", "Portfolio digest"]);
    expect(categories[3].sections.map((s) => s.text).join("")).toMatch(/Why hold it\?$/);
  });
});

describe("the Writer", () => {
  it("DYN: the research call keeps its first request over Anthropic", async () => {
    const DYN = (raw as unknown as { DYN: { last: { input: unknown } } }).DYN;
    const runMessage: Kept[] = [];
    const prisma = {
      agentConfig: { findUnique: async () => ({ id: ANALYST, userId: "user_1", accountId: "account_1", name: "Catalyst Event PM", setupIds: ["PRE_CATALYST"], analystPrompt: null, sectors: [], exclusionList: [], tradingEnvironment: "LIVE", minPositionSize: 3000, maxPositionSize: 8000, maxPositionTotal: 16000 }) },
      thesis: { findFirst: async () => null, findUnique: async () => null },
      thesisUpdate: { findFirst: async () => null },
      position: { findFirst: async () => null },
      runEvent: { create: async () => ({}) },
      researchRun: { update: async () => ({}), updateMany: async () => ({}), findUnique: async () => ({ parameters: {} }) },
      runMessage: { deleteMany: async () => ({}), create: async ({ data }: { data: Kept }) => (runMessage.push(data), data) },
      gateRejection: { create: async () => ({}) },
    };
    const reply = { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-6", stop_reason: "tool_use", content: [{ type: "text", text: "## Company\nDyne makes a drug." }, { type: "tool_use", id: "toolu_1", name: "submit_thesis", input: DYN.last.input }], usage: { input_tokens: 1, output_tokens: 1 } };
    const net = network(() => json(reply));
    const mods = ["@/lib/prisma", "@/lib/actions/finnhub.actions", "@/lib/agent/watchlist-symbols", "@/lib/actions/api-keys.actions", "@/lib/agent/knowledge/load-setup-overrides", "@/lib/performance/load-setup-scorecard"];
    let view: typeof import("@/lib/agent/run-requests").viewOfRecord | undefined;
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma }));
      jest.doMock("@/lib/actions/finnhub.actions", () => ({ getStockQuote: async () => null }));
      jest.doMock("@/lib/agent/watchlist-symbols", () => ({ getWatchlistSymbols: async () => [] }));
      jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
      jest.doMock("@/lib/agent/knowledge/load-setup-overrides", () => ({ loadSetupOverrides: async () => ({}) }));
      jest.doMock("@/lib/performance/load-setup-scorecard", () => ({ loadScorecardLines: async () => [] }));
      const { writerResearchPhase } = await import("@/lib/agent/run-thesis-writer");
      const pull = { rawDataBlock: "STRUCTURED DATA: $DYN", pullErrors: [], currentPrice: 16.51, chart: { atr14: null, pivot: null, brokenOut: null, sma20: null, sma50: null, daysSinceReport: null }, companyName: "Dyne Therapeutics", exchange: "NASDAQ", pulledAt: "2026-09-25T04:06:00.000Z", catalystOnFile: null };
      await writerResearchPhase({ childRunId: "writer_child_dyn", analystId: ANALYST, ticker: "DYN", mode: "mint", reason: "PRE_CATALYST dispatch." } as never, { ok: true, pull } as never);
      view = (await import("@/lib/agent/run-requests")).viewOfRecord;
    });
    undo(mods);
    net.restore();
    const records = runMessage.filter((m) => m.role === "request").map((m) => ({ runId: m.runId, record: JSON.parse(m.content) as RequestRecord }));
    expect(records[0].runId).toBe("writer_child_dyn");
    expect(records[0].record).toMatchObject({ call: "Research", source: "thesis-writer", model: "claude-sonnet-4-6" });
    expect(asSent(records[0].record)).toEqual([net.sent[0]]);
    const categories = view!(records[0].record).categories;
    expect(categories.map((c) => c.name)).toEqual(["Instructions", "First message", "Tool menu"]);
    expect(categories[1].sections.map((s) => s.text).join("")).toContain("STRUCTURED DATA: $DYN");
    expect(categories[2].sections.map((s) => s.label)).toEqual(["web_search", "submit_thesis"]);
  });
});
