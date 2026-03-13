/**
 * Convert persisted messages (mixed UIMessage + ModelMessage) back to UIMessage[]
 * for replaying completed agent runs in AgentThread.
 *
 * The agent route's onFinish saves [...clientUIMessages, ...responseModelMessages].
 * UIMessages have `parts` arrays; ModelMessages have `content` arrays with
 * `role: "assistant"` or `role: "tool"`.
 */

import type { UIMessage } from "ai";

// We use a simple incrementing counter for IDs since these are replay-only
let idCounter = 0;
function genId() {
  return `replay-${idCounter++}`;
}

/**
 * Detect whether a raw message object is a UIMessage (has `parts`) or a
 * ModelMessage (has `content` as array with typed parts).
 */
function isUIMessage(msg: Record<string, unknown>): boolean {
  return Array.isArray(msg.parts);
}

/**
 * Convert the raw persisted JSON array into UIMessage[] that useChatRuntime
 * can accept as initialMessages.
 */
export function convertPersistedToUIMessages(raw: unknown[]): UIMessage[] {
  idCounter = 0;
  const result: UIMessage[] = [];
  // Track the current assistant UIMessage being built so we can attach
  // tool results from subsequent "tool" ModelMessages.
  let currentAssistant: UIMessage | null = null;

  for (const rawMsg of raw) {
    const msg = rawMsg as Record<string, unknown>;

    // ── Already a UIMessage (from the client input) ──────────────────
    if (isUIMessage(msg)) {
      currentAssistant = null;
      result.push({
        id: (msg.id as string) || genId(),
        role: msg.role as UIMessage["role"],
        parts: msg.parts as UIMessage["parts"],
      });
      continue;
    }

    const role = msg.role as string;
    const content = msg.content as unknown[];

    // ── User ModelMessage ────────────────────────────────────────────
    if (role === "user") {
      currentAssistant = null;
      const parts: UIMessage["parts"] = [];
      if (typeof content === "string") {
        parts.push({ type: "text", text: content });
      } else if (Array.isArray(content)) {
        for (const c of content) {
          const p = c as Record<string, unknown>;
          if (p.type === "text") {
            parts.push({ type: "text", text: p.text as string });
          }
        }
      }
      result.push({ id: genId(), role: "user", parts });
      continue;
    }

    // ── Assistant ModelMessage ────────────────────────────────────────
    if (role === "assistant") {
      const uiMsg: UIMessage = {
        id: genId(),
        role: "assistant",
        parts: [],
      };

      if (Array.isArray(content)) {
        for (const c of content) {
          const p = c as Record<string, unknown>;
          if (p.type === "text" && (p.text as string)?.length > 0) {
            uiMsg.parts.push({ type: "text", text: p.text as string });
          } else if (p.type === "tool-call") {
            // In AI SDK v6 UIMessage, tool parts have type "tool-{toolName}"
            // with state/input/output fields
            uiMsg.parts.push({
              type: `tool-${p.toolName as string}` as "text", // type assertion — runtime dynamic type
              toolCallId: p.toolCallId as string,
              toolName: p.toolName as string,
              state: "input-available",
              input: p.args as Record<string, unknown>,
            } as unknown as UIMessage["parts"][number]);
          }
        }
      }

      currentAssistant = uiMsg;
      result.push(uiMsg);
      continue;
    }

    // ── Tool ModelMessage (results) ──────────────────────────────────
    if (role === "tool") {
      if (!currentAssistant || !Array.isArray(content)) continue;

      for (const c of content) {
        const p = c as Record<string, unknown>;
        if (p.type === "tool-result") {
          // Find the matching tool-call part in the current assistant message
          const toolPart = currentAssistant.parts.find(
            (part) =>
              (part as Record<string, unknown>).toolCallId === p.toolCallId,
          ) as Record<string, unknown> | undefined;

          if (toolPart) {
            toolPart.state = "output-available";
            toolPart.output = p.result;
          }
        }
      }
      continue;
    }
  }

  return result;
}
