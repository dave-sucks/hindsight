/**
 * The run page's "Reading N theses" card for the book a run was given in its
 * first message (lib/agent/context/the-book.ts): the get_theses call and its
 * result as the screen gets it, at the top of the run. Display only: the
 * model reads the book as text, and never this card.
 */
import type { UIMessage, UIMessageChunk } from "ai";

/** The card's tool-call id: the one read's own (readBook). */
export const BOOK_CALL_ID = "read-the-book";

/** The card as a saved thread holds it: the call, then its result. None when the book wasn't read. */
export function bookCardInThread(onScreen: unknown): unknown[] {
  if (onScreen == null) return [];
  return [
    { role: "assistant", content: [{ type: "tool-call", toolCallId: BOOK_CALL_ID, toolName: "get_theses", input: {} }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: BOOK_CALL_ID, toolName: "get_theses", output: { type: "json", value: onScreen } }] },
  ];
}

/** A live run's stream with the card first; no step of its own, so a follow-up converts as before. */
export function withBookCardFirst(stream: ReadableStream<UIMessageChunk>, onScreen: unknown): ReadableStream<UIMessageChunk> {
  if (onScreen == null) return stream;
  return stream.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      start(c) {
        c.enqueue({ type: "tool-input-available", toolCallId: BOOK_CALL_ID, toolName: "get_theses", input: {} });
        c.enqueue({ type: "tool-output-available", toolCallId: BOOK_CALL_ID, output: onScreen });
      },
    }),
  );
}

/** The earlier turns without the card: a follow-up's first message carries the book. */
export function withoutBookCard<M extends Pick<UIMessage, "parts">>(messages: M[]): M[] {
  return messages.flatMap((m) => {
    const parts = m.parts.filter((p) => (p as { toolCallId?: unknown }).toolCallId !== BOOK_CALL_ID);
    if (parts.length === m.parts.length) return [m];
    return parts.length ? [{ ...m, parts }] : [];
  });
}
