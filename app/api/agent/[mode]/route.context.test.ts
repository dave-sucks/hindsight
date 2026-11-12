/**
 * Each call of the agent route keeps what it started with: a research run's
 * first turn, its follow-ups, each chat message. Through the real route and
 * the SDK's own streaming loop: with the SDK's stand-in model handing back
 * the request it was given, or with the real provider and only the network
 * stood in for (the chat on Claude, a refused first request).
 */
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import { prismaDouble } from "@/lib/replay";
import type { RequestRecord } from "@/lib/agent/run-requests";

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

/** The stand-in model: one short reply, and the request as the messages it was handed. */
const model = new MockLanguageModelV3({
  doStream: async (opts: { prompt: Array<{ role: string; content: unknown }> }) => ({
    stream: convertArrayToReadableStream([
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Noted." },
      { type: "text-end", id: "t" },
      { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
    ]),
    request: { body: { model: "gpt-5.4", messages: opts.prompt.map((m) => ({ role: m.role, content: m.content })) } },
  }),
} as never);

type Net = (url: string, init: RequestInit) => Response;

/** One POST to the route. With `net`, the real providers send their requests to it; without, the stand-in model answers. */
async function post(mode: string, body: Record<string, unknown>, db: ReturnType<typeof prismaDouble>, net?: Net) {
  const pending: Promise<unknown>[] = [];
  let res: Response | undefined;
  let mod: typeof import("@/lib/agent/run-requests") | undefined;
  const network = net ? jest.spyOn(globalThis, "fetch").mockImplementation((async (u: unknown, init?: RequestInit) => net(String(u), init ?? {})) as typeof fetch) : null;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user_1" } } }) } }) }));
    jest.doMock("@/lib/auth/account", () => ({ getAccountId: async () => "acct_1", getUserRole: async () => "OWNER" }));
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
    jest.doMock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p) }));
    if (!net) jest.doMock("@ai-sdk/openai", () => ({ createOpenAI: () => () => model }));
    jest.doMock("@/lib/agent/tools", () => ({ createResearchTools: () => ({}) }));
    // The chat's book and its snapshot: the selected environment, and no snapshot (the block says so).
    jest.doMock("@/lib/actions/environment.actions", () => ({ getCurrentEnvironment: async () => "LIVE" }));
    jest.doMock("@/lib/portfolio/load-snapshot", () => ({ loadPortfolioSnapshot: async () => null }));
    const { POST } = await import("@/app/api/agent/[mode]/route");
    mod = await import("@/lib/agent/run-requests");
    res = await POST(new Request(`http://localhost/api/agent/${mode}`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ mode }) });
    await res.text();
    // The route's background work (waitUntil): a refused call rejects some of it, as it would in production.
    for (let i = 0; i < pending.length; i++) await Promise.allSettled([pending[i]]);
  });
  network?.mockRestore();
  for (const m of ["@/lib/prisma", "@/lib/supabase/server", "@/lib/auth/account", "@/lib/actions/api-keys.actions", "@vercel/functions", "@ai-sdk/openai", "@/lib/agent/tools", "@/lib/actions/environment.actions", "@/lib/portfolio/load-snapshot"]) jest.dontMock(m);
  return { status: res!.status, requests: mod! };
}

const user = (id: string, text: string) => ({ id, role: "user", parts: [{ type: "text", text }] });

describe("the agent route's calls, each kept for the run's Context", () => {
  it("a research run: its first turn keeps its first request, and its newest follow-up replaces the one before; the page shows the newest, the conversation before the new message as one part", async () => {
    const db = prismaDouble({
      researchRun: [{ id: "run_1", userId: "user_1", accountId: "acct_1", environment: "PAPER", agentConfigId: null, status: "RUNNING", mode: "MANUAL" }],
      runMessage: [],
      runEvent: [],
    });
    const said = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Noted." }] };
    await post("research-run", { runId: "run_1", messages: [user("m1", "Run the review.")] }, db);
    await post("research-run", { runId: "run_1", messages: [user("m1", "Run the review."), said, user("m2", "Why hold V?")] }, db);
    const second = await post(
      "research-run",
      { runId: "run_1", messages: [user("m1", "Run the review."), said, user("m2", "Why hold V?"), { ...said, id: "a2" }, user("m3", "And AVGO?")] },
      db,
    );
    const kept = (db.store.runMessage as Array<{ runId: string; role: string; content: string }>).filter((m) => m.role === "request");
    expect(kept.map((m) => [m.runId, (JSON.parse(m.content) as RequestRecord).call])).toEqual([
      ["run_1", "Run"],
      ["run_1", "Follow-up"],
    ]);
    const first = JSON.parse(kept[0].content) as RequestRecord;
    expect(first).toMatchObject({ source: "agent/research-run", of: 1 });
    expect(second.requests.viewOfRecord(first).categories.map((c) => c.name)).toEqual(["Instructions", "Analyst: Research Analyst", "House rules", "First message"]);

    // The panel: the run's own call, and its newest follow-up beside it. (The database stamps each row's createdAt; the double doesn't.)
    (db.store.runMessage as Array<{ createdAt?: Date }>).forEach((m, i) => (m.createdAt = new Date(Date.UTC(2026, 10, 12, 14, 0, i))));
    let shown: Awaited<ReturnType<typeof second.requests.loadRunRequests>> = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      shown = await (await import("@/lib/agent/run-requests")).loadRunRequests("run_1");
    });
    jest.dontMock("@/lib/prisma");
    expect(shown.map((c) => c.call)).toEqual(["Run", "Follow-up"]);
    const latest = [shown[1]];
    expect(latest[0].categories.map((c) => [c.name, c.part])).toEqual([
      ["Instructions", "job"],
      ["Analyst: Research Analyst", "analyst"],
      ["House rules", "house"],
      ["The conversation so far", null],
      ["This message", "read"],
    ]);
    expect(latest[0].categories[4].sections.map((s) => s.text).join("")).toContain("And AVGO?");
    expect(latest[0].categories[3].sections.map((s) => s.text).join("")).toContain("Why hold V?");
  });

  it("a builder chat has no run, and keeps nothing", async () => {
    const db = prismaDouble({ researchRun: [], runMessage: [], runEvent: [] });
    await post("builder", { messages: [user("m1", "Build me a momentum analyst.")] }, db);
    expect(db.store.runMessage).toEqual([]);
  });

  it("the chat on Claude: each message keeps its first request exactly as sent, the newest replacing the one before; the Market and portfolio block on the newest message is its own part", async () => {
    process.env.ANTHROPIC_API_KEY ??= "test";
    const db = prismaDouble({ researchRun: [], runMessage: [], runEvent: [], agentConfig: [] });
    const sent: string[] = [];
    const events = [
      { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Held." } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ];
    const net: Net = (url, init) => {
      if (!url.includes("anthropic.com")) return new Response("{}", { status: 404 });
      sent.push(String(init.body));
      return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    await post("principal", { chatSessionId: "chat_1", messages: [user("m1", "How is V doing?")] }, db, net);
    // The database defaults agentConfigId to null; the double leaves it unset.
    (db.store.researchRun as Array<{ agentConfigId?: string | null }>).forEach((r) => (r.agentConfigId ??= null));
    const second = await post("principal", { chatSessionId: "chat_1", messages: [user("m1", "How is V doing?"), { id: "a1", role: "assistant", parts: [{ type: "text", text: "Held." }] }, user("m2", "Why hold it?")] }, db, net);

    const runs = db.store.researchRun as Array<{ id: string; mode: string }>;
    expect(runs.map((r) => r.mode)).toEqual(["PRINCIPAL_CHAT"]);
    const kept = (db.store.runMessage as Array<{ runId: string; role: string; content: string }>).filter((m) => m.role === "request");
    expect(kept).toHaveLength(1);
    const record = JSON.parse(kept[0].content) as RequestRecord;
    expect(record).toMatchObject({ call: "Chat message", source: "agent/principal" });
    // The second message's first request, byte for byte, the stream flag included.
    expect(record.requests.map((b) => JSON.stringify(b))).toEqual([sent[1]]);
    expect(sent[1]).toContain('"stream":true');

    const view = second.requests.viewOfRecord(record);
    expect(view.categories.map((c) => c.name).slice(-4)).toEqual(["The conversation so far", "Market and portfolio", "This message", "Tool menu"].filter((n) => view.categories.some((c) => c.name === n)));
    const block = view.categories.find((c) => c.name === "Market and portfolio")!;
    expect(block.part).toBe("portfolio");
    expect(block.sections.map((s) => s.label)).toEqual(["Portfolio snapshot", "Portfolio digest"]);
    const message = view.categories.find((c) => c.name === "This message")!;
    expect(message.sections.map((s) => s.text).join("")).toMatch(/Why hold it\?$/);
    expect(message.sections.map((s) => s.text).join("")).not.toContain("## Market and portfolio");
  });

  it("a first request the provider refuses keeps that request exactly as sent, with the error", async () => {
    process.env.OPENAI_API_KEY ??= "test";
    const db = prismaDouble({
      researchRun: [{ id: "run_2", userId: "user_1", accountId: "acct_1", environment: "PAPER", agentConfigId: null, status: "RUNNING", mode: "MANUAL" }],
      runMessage: [],
      runEvent: [],
    });
    const sent: string[] = [];
    const net: Net = (url, init) => {
      if (!url.includes("openai.com")) return new Response("{}", { status: 404 });
      sent.push(String(init.body));
      return new Response(JSON.stringify({ error: { message: "Invalid value for 'input'.", type: "invalid_request_error" } }), { status: 400, headers: { "content-type": "application/json" } });
    };
    await post("research-run", { runId: "run_2", messages: [user("m1", "Run the review.")] }, db, net);
    const kept = (db.store.runMessage as Array<{ role: string; content: string }>).filter((m) => m.role === "request");
    expect(kept).toHaveLength(1);
    const record = JSON.parse(kept[0].content) as RequestRecord;
    expect(record).toMatchObject({ call: "Run", of: 0 });
    expect(record.error).toMatch(/Invalid value for 'input'/);
    expect(record.requests.map((b) => JSON.stringify(b))).toEqual([sent[0]]);
  });
});
