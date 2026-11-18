/**
 * The 8 PM Portfolio Digest is a run Dave can open: its thread is the
 * digest, and beside it is the request the model was sent, exactly as it
 * went over the wire, the snapshot among its parts. Through the job's own
 * handler, on the agent runner, with a stand-in snapshot; only the database,
 * the snapshot's loader and OpenAI's endpoint are stood in for.
 */
import { STANDIN_SNAPSHOT } from "@/lib/agent/__fixtures__/portfolio-snapshot-standin";
import type { RequestRecord, viewOfRecord as ViewOf } from "@/lib/agent/run-requests";

type Handler = (ctx: { step: { run: (name: string, fn: () => unknown) => Promise<unknown> } }) => Promise<unknown>;
type Row = { runId: string; role: string; content: string };

type Digest = { key: string; narrative: string; createdAt: Date };
type Upsert = { where: unknown; create: { narrative: string }; update: Record<string, unknown> };

/** `digests` is the PortfolioDigest table, kept across runs: an upsert updates the row its where matches, or adds one stamped now (the column's default). */
/** A Chat Completions reply that is `text`. */
const says = (text: string) => async () =>
  new Response(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "gpt-5.4", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

async function runTheJob(reply: () => Promise<Response>, digests: Digest[] = []) {
  const sent: unknown[] = [];
  const rows: Row[] = [];
  const runCreate = jest.fn(async (_a: unknown) => ({ id: "run_digest" }));
  const runUpdate = jest.fn(async (_a: unknown) => ({ count: 1 }));
  const upsert = jest.fn(async (a: Upsert) => {
    const key = JSON.stringify(a.where);
    const hit = digests.find((d) => d.key === key);
    if (hit) Object.assign(hit, a.update);
    else digests.push({ key, createdAt: new Date(), ...a.create });
    return {};
  });
  let handler: Handler | null = null;
  let viewOfRecord: typeof ViewOf | null = null;
  const realFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "sk-test";
  globalThis.fetch = (async (_url: string, init?: RequestInit) => (sent.push(JSON.parse(String(init?.body))), reply())) as typeof fetch;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, h: Handler) => ((handler = h), {}) } }));
    jest.doMock("@/lib/prisma", () => ({
      prisma: {
        researchRun: {
          findMany: async () => [{ accountId: "account_live", environment: "LIVE" }],
          create: runCreate,
          updateMany: runUpdate,
          findUnique: async () => ({ parameters: {} }),
          update: runUpdate,
        },
        position: { findMany: async () => [] },
        order: { findMany: async () => [] },
        agentConfig: { findMany: async () => [{ accountId: "account_live", tradingEnvironment: "LIVE" }] },
        portfolioDigest: { upsert },
        runMessage: {
          create: async ({ data }: { data: Row }) => (rows.push(data), data),
          // As the database would: the thread's save replaces the rows its where matches.
          deleteMany: async ({ where }: { where: { runId: string; role?: { not: string } } }) => {
            const gone = rows.filter((r) => r.runId === where.runId && (!where.role || r.role !== where.role.not));
            for (const r of gone) rows.splice(rows.indexOf(r), 1);
            return { count: gone.length };
          },
        },
        $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
      },
    }));
    jest.doMock("@/lib/portfolio/load-snapshot", () => ({ loadPortfolioSnapshot: async () => STANDIN_SNAPSHOT }));
    jest.doMock("@/lib/auth/account", () => ({ getOwnerUserId: async () => "user_owner" }));
    await import("./portfolio-digest");
    ({ viewOfRecord } = await import("@/lib/agent/run-requests"));
  });
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  try {
    await handler!({ step: { run: async (_name, fn) => fn() } });
  } finally {
    globalThis.fetch = realFetch;
  }
  for (const m of ["@/lib/inngest/client", "@/lib/prisma", "@/lib/portfolio/load-snapshot", "@/lib/auth/account"]) jest.dontMock(m);
  const record = JSON.parse(rows.find((r) => r.role === "request")!.content) as RequestRecord;
  const thread = JSON.parse(rows.find((r) => r.role === "thread")?.content ?? "[]") as Array<{ role: string; content: unknown }>;
  return { sent, rows, record, thread, runCreate, runUpdate, upsert, view: viewOfRecord!(record) };
}

afterEach(() => jest.restoreAllMocks());

const DIGEST = "The book is two holdings and mostly cash.";

describe("the 8 PM Portfolio Digest's run", () => {
  it("is opened for the owner as a read-only run", async () => {
    const { runCreate } = await runTheJob(says(DIGEST));
    expect(runCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "user_owner", accountId: "account_live", mode: "PORTFOLIO_DIGEST", environment: "LIVE", status: "RUNNING" }) }),
    );
  });

  it("keeps the request exactly as it went over the wire, and the thread is the digest", async () => {
    const { sent, rows, record, thread, runUpdate, upsert } = await runTheJob(says(DIGEST));
    expect(sent).toHaveLength(1);
    // The record is kept first; saving the thread after it leaves it.
    expect(rows.map((r) => r.role)).toEqual(["request", "thread"]);
    expect(record).toMatchObject({ v: 1, call: "Main", source: "portfolio-digest", model: "gpt-5.4" });
    expect(record.requests).toEqual(sent);
    // Its first message is all context (the snapshot, in the Context panel), so the thread opens with the digest.
    expect(thread).toEqual([expect.objectContaining({ role: "assistant", content: [expect.objectContaining({ type: "text", text: DIGEST })] })]);
    expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "run_digest", status: "RUNNING" }, data: expect.objectContaining({ status: "COMPLETE" }) }));
    // What the digest says and where it is saved are as before.
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ narrative: DIGEST, model: "gpt-5.4", facts: STANDIN_SNAPSHOT }) }));
  });

  it("shows in its Context panel part by part, in the order sent, adding up to what was sent", async () => {
    const { sent, view } = await runTheJob(says(DIGEST));
    const body = sent[0] as { messages: Array<{ content: string }> };
    // One row per part the agent engine built: its own text, then its context: the date line and the portfolio.
    expect(view.categories.map((c) => [c.group, c.name, c.part])).toEqual([
      ["Instructions", "Its own text", "job"],
      ["Context", "The date and account", "read"],
      ["Context", "The portfolio", "portfolio"],
    ]);
    expect(view.categories[0].sections[0].text).toBe(body.messages[0].content);
    expect(`${view.categories[1].sections[0].text}\n\n${view.categories[2].sections[0].text}`).toBe(body.messages[1].content);
    // The blank line between the two reads is sent and isn't a part.
    expect(view.categories.reduce((n, c) => n + c.chars, 0) + 2).toBe(body.messages[0].content.length + body.messages[1].content.length);
    expect(view.chars + 2).toBe(body.messages[0].content.length + body.messages[1].content.length);
    expect(view.raw).toEqual(body);
    expect(view.rawChars).toBe(JSON.stringify(body).length);
  });

  it("a second run on the same day saves its own text and its own written time", async () => {
    const digests: Digest[] = [];
    // Thu Nov 12: by hand at 4:23 PM ET, then on schedule at 8:00 PM ET.
    jest.useFakeTimers({ now: new Date("2026-11-12T21:23:00Z"), doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask"] });
    try {
      await runTheJob(says("Written by hand at 4:23."), digests);
      jest.setSystemTime(new Date("2026-11-13T01:00:00Z"));
      await runTheJob(says("Written on schedule at 8."), digests);
    } finally {
      jest.useRealTimers();
    }
    expect(digests).toEqual([expect.objectContaining({ narrative: "Written on schedule at 8.", createdAt: new Date("2026-11-13T01:00:00Z") })]);
  });

  it("ends FAILED when the model call fails, with why kept on the run; the digest is the plain facts, as before", async () => {
    const { record, runUpdate, upsert } = await runTheJob(async () => new Response(JSON.stringify({ error: { message: "Bad request" } }), { status: 400, headers: { "content-type": "application/json" } }));
    expect(record.requests).toHaveLength(1);
    expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
    expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { parameters: { error: "Bad request" } } }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ model: "fallback" }) }));
  });
});
