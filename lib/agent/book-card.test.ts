/**
 * The morning run's book is text in its first message (lib/agent/context/
 * the-book.ts); the run page shows the same read as get_theses's "Reading N
 * theses" card. One read: the model gets its rows, the screen its cards.
 *
 * Through the real get_theses result and model-output hook, the real save,
 * the real replay converter and the SDK's own UI-stream reader.
 */
import { readUIMessageStream, type ToolSet, type UIMessage, type UIMessageChunk } from "ai";
import { replayTool, thesisRow } from "@/lib/replay";
import { normalizeToolResult } from "@/lib/agent/tool-result";
import { convertPersistedToUIMessages } from "@/lib/agent/convert-messages";
import { historyForModel } from "@/lib/agent/prompt-cache";
import { BOOK_CALL_ID, bookCardInThread, withBookCardFirst, withoutBookCard } from "./book-card";
import type { ContextRun } from "./context/fact";

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

const NOW = new Date("2026-11-18T13:00:00Z");
const ceg = () =>
  thesisRow({
    id: "t_ceg",
    ticker: "CEG",
    status: "WATCHING",
    direction: "LONG",
    horizon: "COMPOUNDER",
    snapshot: { text: "Nuclear baseload under long contracts; the research text the card repeats.", citations: [] },
    triggers: [{ id: "t_buy", action: "ENTER", predicate: { watch: "price", is: "above", value: 250 }, rationale: "Buy the reclaim." }],
  });

/** The real get_theses (its description, schema and model-output hook), its execute the recorded read, counted. */
async function getThesesOver(result: unknown) {
  let mod: typeof import("@/lib/agent/tools/get-theses") | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    mod = await import("@/lib/agent/tools/get-theses");
  });
  const real = mod!.getTheses({ runId: "r", userId: "u", analystId: "a", runMode: "MORNING_PLAN" } as never) as object;
  const asked: unknown[] = [];
  return { asked, tool: { ...real, execute: async (input: unknown) => (asked.push(input), result) } };
}

const runWith = (get_theses: unknown): ContextRun => ({
  subject: { kind: "analyst", userId: "u", accountId: "acct", environment: "PAPER", analystId: "a" },
  now: NOW,
  agent: "morning_run",
  toolset: { get_theses } as unknown as ToolSet,
});

/** The real save, with the database stood in for. */
async function saved(opening: unknown[]): Promise<unknown[]> {
  const created: Array<{ content: string }> = [];
  let mod: typeof import("@/lib/agent/run-thread") | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({
      prisma: {
        runMessage: { deleteMany: async () => ({ count: 0 }), create: async ({ data }: { data: { content: string } }) => (created.push(data), data) },
        $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
      },
    }));
    mod = await import("@/lib/agent/run-thread");
  });
  await mod!.saveRunThread("run_morning", { opening, messages: [{ role: "assistant", content: [{ type: "text", text: "Two stocks on the list." }] }], steps: [] }, "test");
  return JSON.parse(created[0].content) as unknown[];
}

const kickoff = { role: "user", content: [{ type: "text", text: "It's the start of the trading day." }] };

describe("one read, two versions", () => {
  it("the first message gets the rows; the saved thread opens with the get_theses card of the same read", async () => {
    const { result } = await replayTool("get-theses", "getTheses", { seed: { thesis: [ceg()] }, args: {}, quotes: { CEG: 260 } });
    const { asked, tool } = await getThesesOver(result);
    const run = runWith(tool);
    const { theBook, bookOnScreen } = await import("./context/the-book");

    const text = (await theBook.analyst!(run as never))!;
    expect(text).toContain("## Your book (get_theses)");
    expect(text).toContain("CEG");
    expect(text).not.toContain('"cards"');

    const onScreen = await bookOnScreen(run);
    expect(onScreen).toBe(result);
    expect(asked).toEqual([{}]);

    const thread = (await saved([kickoff, ...bookCardInThread(onScreen)])) as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    expect(thread.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(thread[1].content).toEqual([{ type: "tool-call", toolCallId: BOOK_CALL_ID, toolName: "get_theses", input: {} }]);
    expect(thread[2].content[0]).toMatchObject({ type: "tool-result", toolCallId: BOOK_CALL_ID, toolName: "get_theses", output: { type: "json", value: JSON.parse(JSON.stringify(result)) } });
  });

  it("the replay hands ToolCallRow a get_theses part it draws as the Reading N theses card", async () => {
    const { result } = await replayTool("get-theses", "getTheses", { seed: { thesis: [ceg()] }, args: {}, quotes: { CEG: 260 } });
    const ui = convertPersistedToUIMessages(await saved([kickoff, ...bookCardInThread(result)]));
    expect(ui.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);
    const part = ui[1].parts[0] as unknown as { type: string; toolCallId: string; state: string; output: unknown };
    expect(part).toMatchObject({ type: "tool-get_theses", toolCallId: BOOK_CALL_ID, state: "output-available" });
    // ToolCallRow dispatches on this; ThesisCardRenderer's read table lists data.cards.
    const shown = normalizeToolResult("get_theses", part.output) as { ok: true; ui: string; data: { cards: Array<{ ticker: string }> } };
    expect(shown.ui).toBe("thesis-card");
    expect(shown.data.cards.map((c) => c.ticker)).toEqual(["CEG"]);
  });

  it("no card when the run's context never read the book, and asking doesn't read it", async () => {
    const { asked, tool } = await getThesesOver({ ok: true });
    const { bookOnScreen } = await import("./context/the-book");
    expect(await bookOnScreen(runWith(tool))).toBeNull();
    expect(asked).toEqual([]);
    expect(bookCardInThread(null)).toEqual([]);
  });

  it("no card when the read failed", async () => {
    const { tool } = await getThesesOver({ ok: false, error: "down" });
    const run = runWith(tool);
    const { theBook, bookOnScreen } = await import("./context/the-book");
    expect(await theBook.analyst!(run as never)).toContain("Your book couldn't be read");
    expect(await bookOnScreen(run)).toBeNull();
  });
});

describe("a follow-up hands the model its book once, as before", () => {
  const user: Omit<UIMessage, "id"> = { role: "user", parts: [{ type: "text", text: "Run" }] };
  const step: Omit<UIMessage, "id"> = { role: "assistant", parts: [{ type: "step-start" }, { type: "text", text: "Two stocks on the list." }] };
  const card = (output: unknown) => ({ type: "tool-get_theses", toolCallId: BOOK_CALL_ID, state: "output-available", input: {}, output }) as unknown as UIMessage["parts"][number];

  it("a saved run's card, its own message, is left out", async () => {
    const { result } = await replayTool("get-theses", "getTheses", { seed: { thesis: [ceg()] }, args: {}, quotes: { CEG: 260 } });
    const { tool } = await getThesesOver(result);
    const tools = { get_theses: tool } as unknown as ToolSet;
    const replayed = convertPersistedToUIMessages([kickoff, ...bookCardInThread(result), { role: "assistant", content: [{ type: "text", text: "Two stocks on the list." }] }]);
    const before = convertPersistedToUIMessages([kickoff, { role: "assistant", content: [{ type: "text", text: "Two stocks on the list." }] }]);
    expect(await historyForModel(replayed, tools)).toEqual(await historyForModel(before, tools));
  });

  it("a live run's card, first in its message, is left out", async () => {
    const { result } = await replayTool("get-theses", "getTheses", { seed: { thesis: [ceg()] }, args: {}, quotes: { CEG: 260 } });
    const { tool } = await getThesesOver(result);
    const tools = { get_theses: tool } as unknown as ToolSet;
    const live = { ...step, parts: [card(result), ...step.parts] };
    expect(await historyForModel([user, live], tools)).toEqual(await historyForModel([user, step], tools));
    expect(withoutBookCard([user, step])).toEqual([user, step]);
  });
});

describe("a live run's stream", () => {
  const modelChunks = (): UIMessageChunk[] => [
    { type: "start" },
    { type: "start-step" },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: "Two stocks on the list." },
    { type: "text-end", id: "t" },
    { type: "finish-step" },
    { type: "finish" },
  ];
  const streamOf = (chunks: UIMessageChunk[]) => new ReadableStream<UIMessageChunk>({ start: (c) => (chunks.forEach((x) => c.enqueue(x)), c.close()) });
  async function lastMessage(stream: ReadableStream<UIMessageChunk>): Promise<UIMessage> {
    let last: UIMessage | undefined;
    for await (const m of readUIMessageStream({ stream })) last = m;
    return last!;
  }

  it("opens with the card, then the model's own parts unchanged", async () => {
    const onScreen = { ok: true, ui: "thesis-card", summary: "1 thesis", data: { cards: [{ ticker: "CEG" }] }, sources: [] };
    const withCard = await lastMessage(withBookCardFirst(streamOf(modelChunks()), onScreen));
    const without = await lastMessage(streamOf(modelChunks()));
    expect(withCard.parts[0]).toMatchObject({ type: "tool-get_theses", toolCallId: BOOK_CALL_ID, state: "output-available", input: {}, output: onScreen });
    expect(withCard.parts.slice(1)).toEqual(without.parts);
  });

  it("without a read, the stream is the model's", () => {
    const stream = streamOf(modelChunks());
    expect(withBookCardFirst(stream, null)).toBe(stream);
  });
});
