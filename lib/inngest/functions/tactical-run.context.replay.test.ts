/**
 * A trigger run keeps what its model call started with, for its Context panel.
 *
 * V's floor set to Send to Agent (as in tactical-run.on-fire.replay.test.ts,
 * stand-in position), through the real handler, the SDK's own loop and the
 * real OpenAI provider (the Responses API) with only `fetch` stood in for:
 * the model closes out with update_thesis, then stops. The record holds the
 * first request byte for byte and how many the call made, it outlives the
 * thread's save, and the panel shows the instructions in the parts the
 * builders print.
 */
import { tool } from "ai";
import { z } from "zod";
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow } from "@/lib/replay";
import type { RequestRecord } from "@/lib/agent/run-requests";
import { HOUSE_RULES } from "@/lib/agent/house-rules";

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const V_FLOOR = { id: "84f59b07-5ad2-4f6c-882a-83f5ecce81a7", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 395 }, rationale: "Sell if below $395. You set this.", cooldownDays: 1 };

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** The two replies: close out with update_thesis, then the closing words. */
const reply = (n: number) =>
  n === 1
    ? { id: "resp_1", object: "response", created_at: 1, model: "gpt-5.4", status: "completed", output: [{ type: "function_call", id: "fc_1", call_id: "call_1", name: "update_thesis", arguments: JSON.stringify({ thesis_id: "v", rationale: "Held: the dip came with the market." }), status: "completed" }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
    : { id: "resp_2", object: "response", created_at: 1, model: "gpt-5.4", status: "completed", output: [{ type: "message", id: "msg_2", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Held.", annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };

async function fire() {
  const db = prismaDouble({
    thesis: [thesisRow({ id: "v", ticker: "V", status: "HOLDING", direction: "LONG", analystId: SECULAR, triggers: [V_FLOOR] })],
    position: [positionRow({ id: "pos_v", symbol: "V", analystId: SECULAR, environment: "LIVE", quantity: 10, avgCost: 350 })],
    agentConfig: [agentConfigRow({ id: SECULAR, name: "Secular Compounder", tradingEnvironment: "LIVE", maxOpenPositions: 10 })],
    account: [accountRow({ requireApprovalBuysLive: true, requireApprovalSellsLive: true })],
  });
  const sent: string[] = [];
  let mod: typeof import("@/lib/agent/run-requests") | undefined;
  let loaded: Awaited<ReturnType<typeof import("@/lib/agent/run-requests").loadRunRequests>> = [];
  await jest.isolateModulesAsync(async () => {
    let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
    // The real provider; only the network is stood in for.
    jest.doMock("@ai-sdk/openai", () => {
      const actual = jest.requireActual("@ai-sdk/openai");
      return { ...actual, openai: actual.createOpenAI({ apiKey: "test", fetch: async (_u: string, init: RequestInit) => (sent.push(String(init.body)), json(reply(sent.length))) }) };
    });
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
    jest.doMock("@/lib/actions/closeTrade.actions", () => ({ closeOpenPosition: jest.fn() }));
    jest.doMock("@/lib/trading/manual-order", () => ({ accountCash: async () => 50_000 }));
    // Real tool definitions, so the SDK sends their schemas; the close-out writes its row.
    jest.doMock("@/lib/agent/tools", () => ({
      createResearchTools: () => ({
        get_theses: tool({ description: "Read the stock.", inputSchema: z.object({ tickers: z.array(z.string()) }), execute: async () => ({ ok: false }) }),
        update_thesis: tool({
          description: "Write the review.",
          inputSchema: z.object({ thesis_id: z.string(), rationale: z.string() }),
          execute: async (a: { thesis_id: string; rationale: string }) => {
            const run = (db.store.researchRun as Array<{ id: string }>)[0];
            await (db as unknown as { thesisUpdate: { create: (x: unknown) => Promise<unknown> } }).thesisUpdate.create({ data: { thesisId: a.thesis_id, type: "REVIEWED", summary: "Reviewed", rationale: a.rationale, runId: run.id, timestamp: new Date() } });
            return { ok: true, summary: "Reviewed V" };
          },
        }),
      }),
    }));
    await import("@/lib/inngest/functions/tactical-run");
    await handler!({
      event: { data: { thesisId: "v", triggerId: V_FLOOR.id, analystId: SECULAR, ticker: "V", action: "EXIT", firedPrice: 394.5 } },
      step: { run: async (_n: string, fn: () => Promise<unknown>) => JSON.parse(JSON.stringify((await fn()) ?? null)), sendEvent: jest.fn() },
    });
    // What the run page reads.
    const run = (db.store.researchRun as Array<{ id: string }>)[0];
    mod = await import("@/lib/agent/run-requests");
    loaded = await mod.loadRunRequests(run.id, { latest: true });
  });
  for (const m of ["@ai-sdk/openai", "@/lib/agent/tools", "@/lib/actions/api-keys.actions", "@/lib/actions/closeTrade.actions", "@/lib/trading/manual-order", "@/lib/inngest/client", "@/lib/prisma"]) jest.dontMock(m);
  const rows = (m: string) => (db.store as Record<string, Array<Record<string, unknown>>>)[m] ?? [];
  return { sent, loaded, viewOfRecord: mod!.viewOfRecord, runs: rows("researchRun"), messages: rows("runMessage") as Array<{ runId: string; role: string; content: string }> };
}

describe("a trigger run's Context", () => {
  it("V's floor: the first request kept byte for byte with how many the call made, beside the thread, in the parts the builders print", async () => {
    const r = await fire();
    expect(r.sent).toHaveLength(2);
    expect(r.messages.map((m) => m.role).sort()).toEqual(["request", "thread"]);
    const row = r.messages.find((m) => m.role === "request")!;
    expect(row.runId).toBe(r.runs[0].id);
    const record = JSON.parse(row.content) as RequestRecord;
    expect(record).toMatchObject({ call: "Main", source: "tactical-run", model: "gpt-5.4", of: 2 });
    expect(record.requests.map((b) => JSON.stringify(b))).toEqual([r.sent[0]]);

    const view = r.viewOfRecord(record);
    expect(view.categories.map((c) => [c.name, c.part])).toEqual([
      ["Instructions", "job"],
      ["Analyst: Secular Compounder", "analyst"],
      ["$V row", "read"],
      ["House rules", "house"],
      ["First message", "read"],
      ["Tool menu", "tools"],
    ]);
    // The instructions' parts are every character of the system message, once.
    const system = (JSON.parse(r.sent[0]) as { input: Array<{ role: string; content: string }> }).input[0];
    expect(system.role).toBe("developer");
    expect(view.categories.slice(0, 4).reduce((n, c) => n + c.chars, 0)).toBe(system.content.length);
    expect(view.categories[3].sections.map((s) => s.text).join("")).toBe(HOUSE_RULES);
    expect(view.categories[4].sections.map((s) => s.text).join("")).toMatch(/^Tactical run on \$V\. Sell if below \$395\./);
    expect(view.categories[5].sections.map((s) => s.label)).toEqual(["get_theses", "update_thesis"]);
    expect(view.of).toBe(2);

    // The run page reads the same record.
    expect(r.loaded).toEqual([view]);
  });
});
