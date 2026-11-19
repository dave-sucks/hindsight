/**
 * the_book: the stocks held and watched.
 * - The account and the chat: a line a stock with its belief, a watch with
 *   its buy triggers (lib/agent/book.ts); the chat's only when pinned.
 * - An analyst: its own book as its get_theses read hands it to the model:
 *   a quiet stock one line, a stock in a situation its full row, and once
 *   what each situation asks. It is the read the morning run made first.
 */
import { once, type ContextRun, type Fact } from "./fact";

type ModelRead = { summary?: string; data?: unknown };

/** The analyst's book as the model reads get_theses: the read's summary, then its rows. */
export function bookReadText(read: ModelRead | null): string {
  return read ? `## Your book (get_theses)\n${read.summary ?? ""}\n\n${JSON.stringify(read.data ?? {})}` : "## Your book\nYour book couldn't be read for this run: read it with get_theses.";
}

type Tool = { execute?: (input: unknown, options: unknown) => Promise<unknown>; toModelOutput?: (o: { output: unknown; input: unknown; toolCallId: string }) => { value?: unknown } };

/** The analyst's get_theses read, through the run's own tool, as the model would be handed it. Null when it fails. */
export function readBook(run: ContextRun): Promise<ModelRead | null> {
  return once(run, "the-book", async () => {
    const getTheses = run.toolset?.get_theses as Tool | undefined;
    try {
      if (!getTheses?.execute) throw new Error("the run has no get_theses to read it with");
      const output = (await getTheses.execute({}, { toolCallId: "read-the-book", messages: [] })) as { ok?: boolean };
      if (!output?.ok) return null;
      const forModel = getTheses.toModelOutput ? getTheses.toModelOutput({ output, input: {}, toolCallId: "read-the-book" }).value : output;
      return forModel as ModelRead;
    } catch (err) {
      console.warn("[context] the book's read failed:", err);
      return null;
    }
  });
}

export const theBook: Fact = {
  account: async (run) => {
    const { loadBook } = await import("@/lib/agent/book");
    return (await loadBook(run.subject)) ?? "## The book\nThe book couldn't be read this run.";
  },
  analyst: async (run) => bookReadText(await readBook(run)),
  chat: async (run) => {
    if (!run.subject.analystId) return null;
    const { loadBook } = await import("@/lib/agent/book");
    const { environment, accountId, analystId } = run.subject;
    return (await loadBook({ accountId, environment, analystId })) ?? "## The book\nThe book couldn't be read for this message.";
  },
};
