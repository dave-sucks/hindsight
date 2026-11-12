/**
 * The morning run keeps what its model call started with, for its Context panel.
 *
 * The 8 AM job's own handler, run for one analyst (as a run for one analyst
 * is sent), through the SDK's own loop and the real OpenAI provider (Chat
 * Completions) with only the network stood in for. Its first request is kept
 * byte for byte, as the provider's fetch sent it; a first request the
 * provider refuses is kept too, with the error.
 */
import { tool } from "ai";
import { z } from "zod";
import { prismaDouble, agentConfigRow } from "@/lib/replay";
import type { RequestRecord } from "@/lib/agent/run-requests";

const SECULAR = "cmmqxola3000004lbj7c11bfn";

/** What buildRunInput hands the prompt: an empty book. */
const runInput = {
  portfolio: { cash: 0, buyingPower: 0, portfolioValue: 0, positions: [], exposure: { long: 0, short: 0, net: 0, utilizationPct: 0 } },
  watchlist: [],
  activeTheses: [],
  triggersFiredSinceLastRun: [],
  triggersMatchingNow: [],
  earnings: { reportingSoon: [], justReported: [] },
  filings: { recent: [] },
  openRefusals: [],
};

const done = () =>
  new Response(JSON.stringify({ id: "c1", object: "chat.completion", created: 1, model: "gpt-5.4", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Done." } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const refused = () =>
  new Response(JSON.stringify({ error: { message: "Invalid schema for function 'get_theses'.", type: "invalid_request_error" } }), { status: 400, headers: { "content-type": "application/json" } });

async function morning(reply: () => Response) {
  const db = prismaDouble({
    agentConfig: [agentConfigRow({ id: SECULAR, name: "Secular Compounder", enabled: true, tradingEnvironment: "PAPER", runDaysOfWeek: [1, 2, 3, 4, 5] })],
    researchRun: [],
    runMessage: [],
    runEvent: [],
  });
  const sent: string[] = [];
  // The network: the provider's fetch passes through to it.
  process.env.OPENAI_API_KEY ??= "test";
  const network = jest.spyOn(globalThis, "fetch").mockImplementation((async (u: unknown, init?: RequestInit) => {
    if (!String(u).includes("openai.com")) return new Response("{}", { status: 404 });
    sent.push(String(init?.body));
    return reply();
  }) as typeof fetch);
  let mod: typeof import("@/lib/agent/run-requests") | undefined;
  await jest.isolateModulesAsync(async () => {
    let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: async () => {} } }));
    jest.doMock("@/lib/agent/watchlist-symbols", () => ({ getWatchlistSymbols: async () => [] }));
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
    jest.doMock("@/lib/agent/triggers/seed-account", () => ({ ensureAccountStandingRules: async () => 0 }));
    jest.doMock("@/lib/agent/run-input", () => ({ buildRunInput: async () => runInput }));
    jest.doMock("@/lib/agent/knowledge/load-setup-overrides", () => ({ loadSetupOverrides: async () => ({}) }));
    // A real tool definition, so the SDK sends its schema.
    jest.doMock("@/lib/agent/tools", () => ({
      createResearchTools: () => ({ get_theses: tool({ description: "Read the book.", inputSchema: z.object({ tickers: z.array(z.string()).optional() }), execute: async () => ({ ok: true, summary: "Read" }) }) }),
    }));
    await import("@/lib/inngest/functions/morning-research");
    await handler!({
      event: { name: "app/research.run", data: { agentConfigId: SECULAR } },
      step: { run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)), sendEvent: jest.fn() },
    }).catch(() => undefined);
    mod = await import("@/lib/agent/run-requests");
  });
  network.mockRestore();
  for (const m of ["@/lib/prisma", "@/lib/inngest/client", "@/lib/agent/watchlist-symbols", "@/lib/actions/api-keys.actions", "@/lib/agent/triggers/seed-account", "@/lib/agent/run-input", "@/lib/agent/knowledge/load-setup-overrides", "@/lib/agent/tools"]) jest.dontMock(m);
  const kept = (db.store.runMessage as Array<{ runId: string; role: string; content: string }>).filter((m) => m.role === "request");
  return { sent, kept, runs: db.store.researchRun as Array<{ id: string; status: string }>, requests: mod! };
}

describe("the morning run's Context", () => {
  it("the 8 AM job's own call: its first request kept byte for byte, in the parts the builders print", async () => {
    const r = await morning(done);
    expect(r.kept).toHaveLength(1);
    const record = JSON.parse(r.kept[0].content) as RequestRecord;
    expect(r.kept[0].runId).toBe(r.runs[0].id);
    expect(record).toMatchObject({ call: "Main", source: "morning-research", model: "gpt-5.4", of: 1 });
    expect(record.requests.map((b) => JSON.stringify(b))).toEqual([r.sent[0]]);
    const view = r.requests.viewOfRecord(record);
    expect(view.categories.map((c) => [c.name, c.part])).toEqual([
      ["Instructions", "job"],
      ["Analyst: Secular Compounder", "analyst"],
      ["House rules", "house"],
      ["First message", "read"],
      ["Tool menu", "tools"],
    ]);
    expect(view.categories[3].sections.map((s) => s.text).join("")).toMatch(/^It's the start of the trading day\./);
  });

  it("a first request the provider refuses is kept exactly as sent, with the error", async () => {
    const r = await morning(refused);
    const record = JSON.parse(r.kept[0].content) as RequestRecord;
    expect(record).toMatchObject({ call: "Main", of: 0 });
    expect(record.error).toMatch(/Invalid schema for function 'get_theses'/);
    expect(record.requests.map((b) => JSON.stringify(b))).toEqual([r.sent[0]]);
  });
});
