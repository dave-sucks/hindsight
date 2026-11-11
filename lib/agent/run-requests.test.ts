/**
 * run-requests.test.ts — a model call keeps exactly what it sent.
 *
 * Through the SDK's own loop and the real providers, with `fetch` stood in
 * for so nothing reaches the network: the three request shapes the agents
 * use (Chat Completions for the morning run, Responses for the trigger run,
 * Anthropic for the writer and the chat). Every request rebuilt from the
 * record is the string the provider was handed, byte for byte.
 */
import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { prismaDouble, type PrismaDouble } from "@/lib/replay";
import { cachedMessages, cachedSystem, cachedTools } from "@/lib/agent/prompt-cache";
import { decodeSteps, withRefsFilled, type RequestRecord } from "@/lib/agent/run-requests-format";
import { viewOfCall } from "@/lib/agent/run-requests-view";

type Format = "chat" | "responses" | "anthropic";

/** The modules under test, over a database double. */
async function load(seed: Record<string, unknown[]> = {}) {
  const db = prismaDouble(seed as never);
  let requests: typeof import("@/lib/agent/run-requests") | undefined;
  let thread: typeof import("@/lib/agent/run-thread") | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    requests = await import("@/lib/agent/run-requests");
    thread = await import("@/lib/agent/run-thread");
  });
  jest.dontMock("@/lib/prisma");
  return { db, ...requests!, ...thread! };
}

const rows = (db: PrismaDouble) => (db.store as unknown as Record<string, Array<{ runId: string; role: string; content: string }>>).runMessage ?? [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A reply in each provider's shape: a tool call for a ticker, or the closing words. */
function reply(format: Format, n: number, ticker: string | null) {
  if (format === "chat") {
    return ticker
      ? { id: `c${n}`, object: "chat.completion", created: 1, model: "gpt-5.4", choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: `call_${n}`, type: "function", function: { name: "get_quote", arguments: JSON.stringify({ ticker }) } }] } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
      : { id: `c${n}`, object: "chat.completion", created: 1, model: "gpt-5.4", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Done." } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  }
  if (format === "responses") {
    return ticker
      ? { id: `resp_${n}`, object: "response", created_at: 1, model: "gpt-5.4", status: "completed", output: [{ type: "reasoning", id: `rs_${n}`, summary: [] }, { type: "function_call", id: `fc_${n}`, call_id: `call_${n}`, name: "get_quote", arguments: JSON.stringify({ ticker }), status: "completed" }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
      : { id: `resp_${n}`, object: "response", created_at: 1, model: "gpt-5.4", status: "completed", output: [{ type: "message", id: `msg_${n}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: "Done.", annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  }
  return ticker
    ? { id: `msg_${n}`, type: "message", role: "assistant", model: "claude-sonnet-4-6", stop_reason: "tool_use", content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: `toolu_${n}`, name: "get_quote", input: { ticker } }], usage: { input_tokens: 1, output_tokens: 1 } }
    : { id: `msg_${n}`, type: "message", role: "assistant", model: "claude-sonnet-4-6", stop_reason: "end_turn", content: [{ type: "text", text: "Done." }], usage: { input_tokens: 1, output_tokens: 1 } };
}

const SYSTEM = `You are the analyst. ${"Read every rule. ".repeat(1200)}`;
const RESULT_PAD = "x".repeat(5000);
const NUDGE = "You sent the same refused call twice. Change it or stop.";

const tools = {
  get_quote: tool({
    description: "Get a quote",
    inputSchema: z.object({ ticker: z.string() }),
    execute: async ({ ticker }) => ({ ok: true, ticker, price: 101.5, pad: RESULT_PAD }),
  }),
};

/**
 * One call through the SDK: two tool calls, then the closing words. The
 * second request carries a nudge for that request only, the way the
 * repeat-refusal guard adds one. `failAt` makes that request fail.
 */
async function talk(format: Format, recorder: { step(s: unknown): void; around<T>(p: Promise<T>): Promise<T> }, failAt?: number) {
  const sent: string[] = [];
  const script = ["IOT", "SMMT", null];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    sent.push(String(init.body));
    const n = sent.length;
    if (n === failAt) return json({ error: { message: "bad request", type: "invalid_request_error" } }, 400);
    return json(reply(format, n, script[n - 1] ?? null));
  }) as typeof fetch;
  const anthropic = format === "anthropic";
  const openai = createOpenAI({ apiKey: "test", fetch: fakeFetch });
  const model = format === "chat" ? openai.chat("gpt-5.4") : format === "responses" ? openai("gpt-5.4") : createAnthropic({ apiKey: "test", fetch: fakeFetch })("claude-sonnet-4-6");
  const out = await recorder.around(
    generateText({
      model,
      // Anthropic goes the way the chat route sends it: cache markers that move each request.
      system: anthropic ? cachedSystem("anthropic", SYSTEM) : SYSTEM,
      prompt: "Review IOT and SMMT.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: anthropic ? (cachedTools("anthropic", tools) as any) : tools,
      maxRetries: 0,
      stopWhen: stepCountIs(5),
      ...(format === "responses" ? { providerOptions: { openai: { strictJsonSchema: true, promptCacheKey: "run_1" } } } : {}),
      prepareStep: ({ stepNumber, messages }) => {
        const withNudge: ModelMessage[] = stepNumber === 1 ? [...messages, { role: "user", content: NUDGE }] : messages;
        return { messages: anthropic ? cachedMessages("anthropic", withNudge) : withNudge };
      },
      onStepFinish: recorder.step,
    }),
  );
  return { out, sent };
}

describe.each<[Format, string]>([
  ["chat", "openai.chat"],
  ["responses", "openai.responses"],
  ["anthropic", "anthropic.messages"],
])("a %s call", (format, provider) => {
  it("keeps every request as sent, rebuilt byte for byte", async () => {
    const m = await load();
    const rec = m.recordRequests("run_1", "Main", "test");
    const { sent } = await talk(format, rec);
    expect(sent).toHaveLength(3);

    const saved = rows(m.db).filter((r) => r.role === m.REQUEST_ROLE);
    expect(saved).toHaveLength(1);
    const record = JSON.parse(saved[0].content) as RequestRecord;
    expect(record).toMatchObject({ v: 1, call: "Main", source: "test", provider, list: format === "responses" ? "input" : "messages" });
    expect(decodeSteps(record).map((b) => JSON.stringify(b))).toEqual(sent);
    // About one full request in size, not three. (Anthropic's cache marker moves to
    // the newest message each request, so that message is kept again once unmarked.)
    const total = sent.reduce((s, b) => s + b.length, 0);
    expect(saved[0].content.length).toBeLessThan(sent[2].length * 1.25);
    expect(saved[0].content.length).toBeLessThan(total / 2);
  });

  it("shows one piece per thing passed in, with its size, and the nudge as one request's", async () => {
    const m = await load();
    const rec = m.recordRequests("run_1", "Main", "test");
    await talk(format, rec);
    const record = JSON.parse(rows(m.db)[0].content) as RequestRecord;
    const view = viewOfCall(record);
    expect(view).toMatchObject({ call: "Main", requests: 3, error: null });
    expect(view.pieces.map((p) => [p.label, p.hint ?? null, p.request, p.lastRequest])).toEqual([
      ["Instructions", null, 1, 3],
      ["First message", null, 1, 3],
      ["Tool menu (1 tool)", null, 1, 3],
      ["get_quote", "IOT", 2, 3],
      ["Nudge, request 2 only", null, 2, 2],
      ["get_quote", "SMMT", 3, 3],
    ]);
    const [instructions, first, menu, iot, nudge] = view.pieces;
    expect(instructions.text).toBe(SYSTEM);
    expect(instructions.chars).toBe(SYSTEM.length);
    expect(first.text).toBe("Review IOT and SMMT.");
    expect(JSON.parse(menu.text)).toHaveLength(1);
    expect(JSON.parse(iot.text)).toEqual({ ok: true, ticker: "IOT", price: 101.5, pad: RESULT_PAD });
    expect(iot.chars).toBe(iot.text.length);
    expect(nudge.text).toBe(NUDGE);
  });

  it("keeps what was sent when the call fails, and says why", async () => {
    const m = await load();
    const rec = m.recordRequests("run_1", "Main", "test");
    await expect(talk(format, rec, 2)).rejects.toThrow();
    const record = JSON.parse(rows(m.db)[0].content) as RequestRecord;
    // The answered request is kept; the one that failed got no reply, so it is not.
    expect(record.steps).toHaveLength(1);
    expect(record.error).toBeTruthy();
  });
});

describe("the Responses API's references", () => {
  it("are filled from the call's own replies when shown, and marked as not sent", async () => {
    const m = await load();
    const rec = m.recordRequests("run_1", "Main", "test");
    const { sent } = await talk("responses", rec);
    const record = JSON.parse(rows(m.db)[0].content) as RequestRecord;
    const second = JSON.parse(sent[1]) as { input: Array<{ type?: string; id?: string }> };
    expect(second.input.filter((i) => i.type === "item_reference").map((i) => i.id)).toEqual(["rs_1", "fc_1"]);
    const { body, filled } = withRefsFilled(decodeSteps(record)[1], record.refs ?? {});
    expect(filled).toBe(2);
    expect((body as { input: unknown[] }).input).toContainEqual({ type: "item_reference", id: "fc_1", filled_in_not_sent: { request: 1, type: "function_call", name: "get_quote", callId: "call_1", input: { ticker: "IOT" } } });
  });
});

describe("keeping it", () => {
  it("keeps nothing without a run", async () => {
    const m = await load();
    await talk("chat", m.recordRequests(undefined, "Main", "test"));
    expect(rows(m.db)).toHaveLength(0);
  });

  it("saving the thread replaces the thread and leaves the call records", async () => {
    const m = await load({
      runMessage: [
        { id: "req_1", runId: "run_1", role: "request", content: "{}" },
        { id: "thr_1", runId: "run_1", role: "thread", content: "[]" },
      ],
    });
    await m.saveRunThread("run_1", { opening: [{ role: "user", content: "Start." }], messages: [], steps: [] }, "test");
    expect(rows(m.db).map((r) => [r.role, r.content])).toEqual([
      ["request", "{}"],
      ["thread", '[{"role":"user","content":"Start."}]'],
    ]);
  });
});
