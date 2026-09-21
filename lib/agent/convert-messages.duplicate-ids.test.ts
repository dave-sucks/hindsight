/**
 * convert-messages.duplicate-ids.test.ts — the thread that wouldn't open.
 *
 * 2026-09-21: a live chat resumed at /chat?resume=cmu49ltcj000104kzaktcqepl
 * rendered "Something went wrong — MessageRepository(performOp/link): A
 * message with the same id already exists in the parent tree" on every load.
 *
 * The stored thread, read from the database, is the shape below: twelve
 * messages, three of them carrying the ids `replay-0`, `replay-1`, `replay-2`
 * — which this file mints — and the last three appended as raw ModelMessages
 * with no ids at all. A minted id had been persisted back (the route saves
 * the client's hydrated messages), so the counter handed the same three ids
 * out again to different messages.
 */

import { convertPersistedToUIMessages } from "./convert-messages";

/** The live thread's shape: hydrated ids stored, later turns id-less. */
const STORED_THREAD: unknown[] = [
  { id: "i2tCedxcwMpAsHgW", role: "user", parts: [{ type: "text", text: "where do we stand" }] },
  { id: "replay-0", role: "assistant", parts: [{ type: "text", text: "Reading the book." }] },
  { id: "replay-1", role: "assistant", parts: [{ type: "text", text: "Pulling the names." }] },
  { id: "replay-2", role: "assistant", parts: [{ type: "text", text: "Here's the read." }] },
  { id: "rp7jjrlrb4TcYVui", role: "user", parts: [{ type: "text", text: "and the proposals?" }] },
  // Appended by a later turn as ModelMessages — no ids at all.
  {
    role: "assistant",
    content: [
      { type: "text", text: "Checking." },
      { type: "tool-call", toolCallId: "call_1", toolName: "list_proposals", input: {} },
    ],
  },
  {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: "call_1", toolName: "list_proposals", output: { type: "json", value: { ok: true } } }],
  },
  { role: "assistant", content: [{ type: "text", text: "One pending." }] },
];

describe("a thread carrying ids this converter previously minted", () => {
  it("opens — every message id is unique", () => {
    const out = convertPersistedToUIMessages(STORED_THREAD);
    const ids = out.map((m) => m.id);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it("leaves the stored ids alone and mints around them", () => {
    const out = convertPersistedToUIMessages(STORED_THREAD);
    const ids = out.map((m) => m.id);
    // The three stored replay ids still belong to the messages that carried them.
    expect(ids[1]).toBe("replay-0");
    expect(ids[2]).toBe("replay-1");
    expect(ids[3]).toBe("replay-2");
    // The three id-less messages got ids of their own — two survive as
    // messages, the tool results fold into the assistant turn above them.
    for (const minted of ids.slice(5)) {
      expect(minted).toMatch(/^replay-\d+$/);
      expect(["replay-0", "replay-1", "replay-2"]).not.toContain(minted);
    }
  });

  it("is stable — hydrating twice gives the same ids", () => {
    const first = convertPersistedToUIMessages(STORED_THREAD).map((m) => m.id);
    const second = convertPersistedToUIMessages(STORED_THREAD).map((m) => m.id);
    expect(second).toEqual(first);
  });

  it("keeps the conversation intact — the tool result still lands on its call", () => {
    const out = convertPersistedToUIMessages(STORED_THREAD);
    const withTool = out.find((m) => m.parts.some((p) => p.type === "tool-list_proposals"));
    const part = withTool?.parts.find((p) => p.type === "tool-list_proposals") as unknown as {
      state: string;
      output: unknown;
    };
    expect(part.state).toBe("output-available");
    expect(part.output).toEqual({ ok: true });
  });
});
