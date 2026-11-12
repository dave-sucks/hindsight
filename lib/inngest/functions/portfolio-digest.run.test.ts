/**
 * The 8 PM Portfolio Digest is a run Dave can open: its thread is the facts
 * and the digest, and beside it is the request the model was sent, exactly as
 * the OpenAI client got it. Through the job's own handler, with today's
 * writer and stand-in facts; only the database and OpenAI are stood in for.
 */
import { STANDIN_FACTS } from "@/lib/agent/__fixtures__/digest-facts-standin";
import type { RequestRecord, viewOfRecord as ViewOf } from "@/lib/agent/run-requests";

type Handler = (ctx: { step: { run: (name: string, fn: () => unknown) => Promise<unknown> } }) => Promise<unknown>;
type Row = { runId: string; role: string; content: string };

async function runTheJob(reply: () => Promise<unknown>) {
  const sent: unknown[] = [];
  const rows: Row[] = [];
  const runCreate = jest.fn(async () => ({ id: "run_digest" }));
  const runUpdate = jest.fn(async () => ({}));
  const upsert = jest.fn(async () => ({}));
  let handler: Handler | null = null;
  let viewOfRecord: typeof ViewOf | null = null;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, h: Handler) => ((handler = h), {}) } }));
    jest.doMock("openai", () => ({
      __esModule: true,
      default: class {
        chat = { completions: { create: async (body: unknown) => (sent.push(JSON.parse(JSON.stringify(body))), reply()) } };
      },
    }));
    jest.doMock("@/lib/prisma", () => ({
      prisma: {
        researchRun: { findMany: async () => [{ accountId: "account_live", environment: "LIVE" }], create: runCreate, update: runUpdate },
        position: { findMany: async () => [] },
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
    jest.doMock("@/lib/portfolio/digest-facts-builder", () => ({ buildDigestFacts: async () => STANDIN_FACTS }));
    jest.doMock("@/lib/auth/account", () => ({ getOwnerUserId: async () => "user_owner" }));
    await import("./portfolio-digest");
    ({ viewOfRecord } = await import("@/lib/agent/run-requests"));
  });
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  await handler!({ step: { run: async (_name, fn) => fn() } });
  for (const m of ["@/lib/inngest/client", "openai", "@/lib/prisma", "@/lib/portfolio/digest-facts-builder", "@/lib/auth/account"]) jest.dontMock(m);
  const record = JSON.parse(rows.find((r) => r.role === "request")!.content) as RequestRecord;
  const thread = JSON.parse(rows.find((r) => r.role === "thread")!.content) as Array<{ role: string; content: unknown }>;
  return { sent, rows, record, thread, runCreate, runUpdate, upsert, view: viewOfRecord!(record) };
}

afterEach(() => jest.restoreAllMocks());

const DIGEST = "The book is two holdings and mostly cash.";

describe("the 8 PM Portfolio Digest's run", () => {
  it("is opened for the owner as a read-only run", async () => {
    const { runCreate } = await runTheJob(async () => ({ choices: [{ message: { content: DIGEST } }] }));
    expect(runCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "user_owner", accountId: "account_live", mode: "PORTFOLIO_DIGEST", environment: "LIVE", status: "RUNNING" }) }),
    );
  });

  it("keeps the request exactly as the model got it, and the thread is the facts and the digest", async () => {
    const { sent, rows, record, thread, runUpdate, upsert } = await runTheJob(async () => ({ choices: [{ message: { content: DIGEST } }] }));
    expect(sent).toHaveLength(1);
    // The record is kept first; saving the thread after it leaves it.
    expect(rows.map((r) => r.role)).toEqual(["request", "thread"]);
    expect(record).toMatchObject({ v: 1, call: "Main", source: "portfolio-digest", model: "gpt-4o" });
    expect(record.requests).toEqual(sent);
    const facts = (sent[0] as { messages: Array<{ content: string }> }).messages[1].content;
    expect(thread).toEqual([
      { role: "user", content: facts },
      { role: "assistant", content: [{ type: "text", text: DIGEST }] },
    ]);
    expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "run_digest" }, data: expect.objectContaining({ status: "COMPLETE" }) }));
    // What the digest says and where it is saved are as before.
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ narrative: DIGEST, model: "gpt-4o" }) }));
  });

  it("shows in its Context panel part by part, in the order sent, adding up to what was sent", async () => {
    const { sent, view } = await runTheJob(async () => ({ choices: [{ message: { content: DIGEST } }] }));
    const body = sent[0] as { messages: Array<{ content: string }> };
    expect(view.categories.map((c) => [c.name, c.part])).toEqual([
      ["Instructions", "job"],
      ["Portfolio facts", "read"],
    ]);
    expect(view.categories[0].sections.map((p) => p.label)).toEqual(["Opening", "OUTPUT", "INLINE REFERENCE TOKENS", "WHAT TO COVER", "JUDGMENT"]);
    expect(view.categories[1].sections.map((p) => p.label)).toEqual(["FACTS", "PNL", "BOOK", "CADENCE", "RUNS TODAY", "RUN DETAIL", "HELD POSITIONS", "DECISIONS TODAY", "PASSES AGED"]);
    for (const [i, c] of view.categories.entries()) {
      expect(c.sections.map((p) => p.text).join("")).toBe(body.messages[i].content);
      expect(c.chars).toBe(body.messages[i].content.length);
    }
    expect(view.chars).toBe(body.messages[0].content.length + body.messages[1].content.length);
    expect(view.raw).toEqual(body);
    expect(view.rawChars).toBe(JSON.stringify(body).length);
  });

  it("ends FAILED when the model call fails, with the error kept; the digest is the plain facts, as before", async () => {
    const { record, runUpdate, upsert } = await runTheJob(async () => {
      throw new Error("429 rate limited");
    });
    expect(record.error).toBe("429 rate limited");
    expect(record.requests).toHaveLength(1);
    expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ model: "fallback" }) }));
  });
});
