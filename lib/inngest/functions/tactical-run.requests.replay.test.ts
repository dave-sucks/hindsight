/**
 * The trigger run's real handler keeps exactly what its model call sent.
 *
 * V's floor set to Send to Agent (production rows, as in
 * tactical-run.on-fire.replay.test.ts), through the SDK's own loop and the
 * real OpenAI provider (the Responses API) with `fetch` stood in for: the
 * model closes out with update_thesis, then stops. The run's record of that
 * call rebuilds both requests byte for byte, its pieces are the trigger
 * run's own instructions, kickoff and tool menu, and saving the thread
 * afterwards leaves it in place. The Market and portfolio block is the sample
 * day's (the Nov 10 close's real numbers, sample-prompts.ts) with one note to
 * the account, so its parts show as chips of their own.
 */
import { tool } from "ai";
import { z } from "zod";
import { prismaDouble, thesisRow, agentConfigRow, accountRow, positionRow } from "@/lib/replay";
import { decodeSteps, withRefsFilled, type RequestRecord } from "@/lib/agent/run-requests-format";
import { viewOfCall } from "@/lib/agent/run-requests-view";
import { HOUSE_RULES } from "@/lib/agent/house-rules";
import type { MarketAndPortfolio } from "@/lib/agent/market-and-portfolio";

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const V_FLOOR = { id: "84f59b07-5ad2-4f6c-882a-83f5ecce81a7", action: "EXIT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 395 }, rationale: "Sell if below $395. You set this.", cooldownDays: 1 };
const NOTE = "Visa dipped under $395 with the market; nothing in its own news. I'd hold.";
/** A note to the account as the block prints it (runNoteLine); a stand-in, no account note exists yet. */
const ACCOUNT_NOTE = '11-10 08:00 PM · Portfolio manager to the account: "The Fed speaks Wednesday; size buys for a swing." [note note_fed]';
const MARKET = ["Market brief", "Market numbers", "Portfolio brief", "Portfolio numbers", "Notes"];

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** The two replies: close out with update_thesis, then the closing words. */
function reply(n: number) {
  return n === 1
    ? { id: "resp_1", object: "response", created_at: 1, model: "gpt-5.4", status: "completed", output: [{ type: "reasoning", id: "rs_1", summary: [] }, { type: "function_call", id: "fc_1", call_id: "call_1", name: "update_thesis", arguments: JSON.stringify({ thesis_id: "v", rationale: NOTE }), status: "completed" }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
    : { id: "resp_2", object: "response", created_at: 1, model: "gpt-5.4", status: "completed", output: [{ type: "message", id: "msg_2", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Held.", annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
}

async function fire() {
  const db = prismaDouble({
    thesis: [thesisRow({ id: "v", ticker: "V", status: "HOLDING", direction: "LONG", analystId: SECULAR, triggers: [V_FLOOR] })],
    position: [positionRow({ id: "pos_v", symbol: "V", analystId: SECULAR, environment: "LIVE", quantity: 10, avgCost: 350 })],
    agentConfig: [agentConfigRow({ id: SECULAR, name: "Secular Compounder", tradingEnvironment: "LIVE", maxOpenPositions: 10 })],
    account: [accountRow({ requireApprovalBuysLive: true, requireApprovalSellsLive: true })],
  });
  const sent: string[] = [];
  const urls: string[] = [];
  await jest.isolateModulesAsync(async () => {
    let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}), send: jest.fn() } }));
    // The real provider; only the network is stood in for.
    jest.doMock("@ai-sdk/openai", () => {
      const actual = jest.requireActual("@ai-sdk/openai");
      const fakeFetch = async (url: string, init: RequestInit) => {
        urls.push(url);
        sent.push(String(init.body));
        return json(reply(sent.length));
      };
      return { ...actual, openai: actual.createOpenAI({ apiKey: "test", fetch: fakeFetch }) };
    });
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
    // The block's loader reads the broker and the market; it gets the sample day's parts instead.
    jest.doMock("@/lib/agent/load-market-and-portfolio", () => ({
      loadMarketAndPortfolio: async (): Promise<MarketAndPortfolio> => ({ ...jest.requireActual("@/lib/agent/__fixtures__/sample-prompts").SAMPLE_BLOCK_PARTS, notes: [{ author: "PORTFOLIO_MANAGER", line: ACCOUNT_NOTE }] }),
    }));
    jest.doMock("@/lib/actions/closeTrade.actions", () => ({ closeOpenPosition: jest.fn() }));
    jest.doMock("@/lib/trading/manual-order", () => ({ accountCash: async () => 50_000 }));
    // The tools are the edges: real definitions, so the SDK sends their schemas; the close-out writes its row.
    jest.doMock("@/lib/agent/tools", () => ({
      createResearchTools: () => ({
        get_theses: tool({ description: "Read the stock.", inputSchema: z.object({ tickers: z.array(z.string()) }), execute: async () => ({ ok: false }) }),
        close_position: tool({ description: "Sell the whole position.", inputSchema: z.object({ thesis_id: z.string(), reason: z.string() }), execute: async () => ({ ok: true }) }),
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
  });
  for (const m of ["@ai-sdk/openai", "@/lib/agent/tools", "@/lib/actions/api-keys.actions", "@/lib/agent/load-market-and-portfolio", "@/lib/actions/closeTrade.actions", "@/lib/trading/manual-order", "@/lib/inngest/client", "@/lib/prisma"]) jest.dontMock(m);
  const rows = (m: string) => (db.store as Record<string, Array<Record<string, unknown>>>)[m] ?? [];
  return { sent, urls, runs: rows("researchRun"), messages: rows("runMessage") as Array<{ runId: string; role: string; content: string }> };
}

/** The route the run page reads, over the rows the run left (and `others`, other runs' rows), as `userId`. */
async function getRoute(rows: Array<Record<string, unknown>>, query: string, userId = "user_v", others: Array<Record<string, unknown>> = []) {
  const db = prismaDouble({
    researchRun: [{ id: "run_v", userId: "user_v", status: "COMPLETE", startedAt: new Date(Date.UTC(2026, 10, 12, 14, 0, 0)) }],
    runMessage: [...rows.map((m, i) => ({ id: `msg_${i}`, ...m, runId: "run_v", createdAt: new Date(Date.UTC(2026, 10, 12, 14, 0, i)) })), ...others],
  });
  let route: typeof import("@/app/api/runs/[id]/requests/route") | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: userId } } }) } }) }));
    route = await import("@/app/api/runs/[id]/requests/route");
  });
  for (const m of ["@/lib/prisma", "@/lib/supabase/server"]) jest.dontMock(m);
  const res = await route!.GET(new Request(`http://localhost/api/runs/run_v/requests${query}`), { params: Promise.resolve({ id: "run_v" }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("the trigger run keeps what its model call sent", () => {
  it("V's floor: both requests rebuilt byte for byte, shown as the run's own pieces, and still there after the thread is saved", async () => {
    const r = await fire();
    expect(r.urls).toEqual(["https://api.openai.com/v1/responses", "https://api.openai.com/v1/responses"]);
    expect(r.runs[0]).toMatchObject({ status: "COMPLETE" });

    // The thread was saved after the call, and the call's record is still there beside it.
    expect(r.messages.map((m) => m.role).sort()).toEqual(["request", "thread"]);
    const row = r.messages.find((m) => m.role === "request")!;
    expect(row.runId).toBe(r.runs[0].id);
    const record = JSON.parse(row.content) as RequestRecord;
    expect(record).toMatchObject({ call: "Main", source: "tactical-run", provider: "openai.responses", model: "gpt-5.4", list: "input" });
    expect(decodeSteps(record).map((b) => JSON.stringify(b))).toEqual(r.sent);

    const first = JSON.parse(r.sent[0]) as { input: Array<{ role?: string; content?: unknown }>; tools: Array<{ name: string }>; prompt_cache_key: string };
    expect(first.prompt_cache_key).toBe(r.runs[0].id);

    const view = viewOfCall(record);
    // The trigger run's instructions in the blocks its builder prints, the Market and portfolio block's parts before the row, then the rest of the request.
    expect(view.pieces.map((p) => p.label)).toEqual(["Instructions", "Analyst: Secular Compounder", ...MARKET, "$V row", "House rules", "First message", "Tool menu (3 tools)", "update_thesis"]);
    const by = (label: string) => view.pieces.find((p) => p.label === label)!;
    const [instructions, brief, stockRow, rules, kickoff, menu, closeOut] = ["Instructions", "Analyst: Secular Compounder", "$V row", "House rules", "First message", "Tool menu (3 tools)", "update_thesis"].map(by);
    const system = first.input[0].content as string;
    expect(instructions.text).toContain("DECISION FRAMEWORK");
    expect(instructions.text).toContain('[See the "House rules" chip]');
    expect(brief.text).toMatch(/^## Analyst: Secular Compounder\n\n/);
    expect(by("Market brief").text).toMatch(/^## Market and portfolio\n\n### Market brief\nWed Nov 11, 7:34 AM ET: Sample text\./);
    expect(by("Portfolio numbers").text).toContain("Sales waiting for approval:");
    expect(by("Notes").text).toBe(`### Notes\n- ${ACCOUNT_NOTE}`);
    expect(stockRow.text).toMatch(/^═+\n\$V, its row \(get_theses\)/);
    expect(rules.text).toBe(HOUSE_RULES);
    // Every character of the instructions is in exactly one block.
    expect(view.pieces.filter((p) => p.kind === "instructions").reduce((n, p) => n + p.chars, 0)).toBe(system.length);
    expect(kickoff.text).toMatch(/^Tactical run on \$V\. Sell if below \$395\./);
    expect(JSON.parse(menu.text).map((t: { name: string }) => t.name).sort()).toEqual(["close_position", "get_theses", "update_thesis"]);
    // The tool result as the model read it, named through the reference to its own call.
    expect(closeOut).toMatchObject({ request: 2, chars: closeOut.text.length });
    expect(closeOut.text).toContain("Reviewed V");
    const { filled } = withRefsFilled(decodeSteps(record)[1], record.refs ?? {});
    expect(filled).toBe(2);
  });

  it("the run page's route serves those requests: the pieces with their sizes, one piece's text, a raw request with its references filled in", async () => {
    const r = await fire();
    const summary = await getRoute(r.messages, "");
    expect(summary.status).toBe(200);
    const calls = summary.body.calls as Array<{ id: string; call: string; requests: number; pieces: Array<Record<string, unknown>> }>;
    expect(calls.map((c) => [c.call, c.requests])).toEqual([["Main", 2]]);
    expect(calls[0].pieces.map((p) => p.label)).toEqual(["Instructions", "Analyst: Secular Compounder", ...MARKET, "$V row", "House rules", "First message", "Tool menu (3 tools)", "update_thesis"]);
    // Sizes only; a piece's text is read when it is opened.
    expect(calls[0].pieces.every((p) => typeof p.chars === "number" && !("text" in p))).toBe(true);

    const rules = calls[0].pieces.find((p) => p.label === "House rules")!;
    const piece = await getRoute(r.messages, `?call=${calls[0].id}&piece=${rules.id}`);
    expect(piece.body.text).toBe(HOUSE_RULES);

    const raw = await getRoute(r.messages, `?call=${calls[0].id}&request=2`);
    expect(raw.body).toMatchObject({ request: 2, of: 2 });
    expect(JSON.stringify(raw.body.body)).toBe(r.sent[1]);
    expect(JSON.stringify(raw.body.filled)).toContain('"filled_in_not_sent":{"request":1,"type":"function_call","name":"update_thesis"');

    // Someone else's run is not found; a run with only its thread has nothing kept.
    expect((await getRoute(r.messages, "", "someone_else")).status).toBe(404);
    // A run with only its thread: kept nothing, if another run's call was kept before it started; from before the records, if none was.
    const threadOnly = r.messages.filter((m) => m.role === "thread");
    const earlier = { id: "req_earlier", runId: "run_earlier", role: "request", content: "{}", createdAt: new Date(Date.UTC(2026, 10, 12, 13, 0, 0)) };
    const later = { ...earlier, id: "req_later", createdAt: new Date(Date.UTC(2026, 10, 12, 15, 0, 0)) };
    expect((await getRoute(threadOnly, "", "user_v", [earlier])).body).toEqual({ status: "COMPLETE", before: false, calls: [] });
    expect((await getRoute(threadOnly, "", "user_v", [later])).body).toEqual({ status: "COMPLETE", before: true, calls: [] });
  });
});
