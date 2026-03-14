/**
 * Convert persisted messages (mixed UIMessage + ModelMessage) back to
 * UIMessage[] for replaying completed agent runs via useChatRuntime.
 *
 * The agent route's onFinish saves [...clientUIMessages, ...responseModelMessages].
 * UIMessages have `parts` arrays; ModelMessages have `content` arrays with
 * `role: "assistant"` or `role: "tool"`.
 *
 * Output uses AI SDK v6 UIMessage format where tool parts are:
 *   { type: "tool-invocation", toolCallId, toolName, args, state: "result", result }
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
 * can accept as initialMessages with proper tool-invocation parts.
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
      // Re-normalize parts to ensure correct format
      const rawParts = msg.parts as Record<string, unknown>[];
      const parts: UIMessage["parts"] = [];
      for (const p of rawParts) {
        if (p.type === "text") {
          parts.push({ type: "text", text: p.text as string });
        } else if (p.type === "tool-invocation") {
          // Already correct format — pass through
          parts.push({
            type: "tool-invocation",
            toolCallId: p.toolCallId as string,
            toolName: p.toolName as string,
            args: p.args as Record<string, unknown>,
            state: (p.state as "result") ?? "result",
            ...(p.result !== undefined ? { result: p.result } : {}),
          } as UIMessage["parts"][number]);
        }
        // Legacy format from earlier converter — convert
        if (
          typeof p.type === "string" &&
          (p.type as string).startsWith("tool-") &&
          p.type !== "tool-invocation"
        ) {
          parts.push({
            type: "tool-invocation",
            toolCallId: (p.toolCallId as string) || genId(),
            toolName: (p.toolName as string) || (p.type as string).slice(5),
            args: (p.args ?? p.input ?? {}) as Record<string, unknown>,
            state: "result",
            ...(p.result ?? p.output
              ? { result: p.result ?? p.output }
              : {}),
          } as UIMessage["parts"][number]);
        }
      }
      result.push({
        id: (msg.id as string) || genId(),
        role: msg.role as UIMessage["role"],
        parts,
      });
      continue;
    }

    const role = msg.role as string;
    const content = msg.content as unknown;

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
            // AI SDK v6: tool-invocation with state "call" (result attached later)
            uiMsg.parts.push({
              type: "tool-invocation",
              toolCallId: p.toolCallId as string,
              toolName: p.toolName as string,
              args: (p.args ?? {}) as Record<string, unknown>,
              state: "call",
            } as UIMessage["parts"][number]);
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
          // Find the matching tool-invocation part in the current assistant message
          const toolPart = currentAssistant.parts.find(
            (part) =>
              (part as Record<string, unknown>).type === "tool-invocation" &&
              (part as Record<string, unknown>).toolCallId === p.toolCallId,
          ) as Record<string, unknown> | undefined;

          if (toolPart) {
            toolPart.state = "result";
            toolPart.result = p.result;
          }
        }
      }
      continue;
    }
  }

  return result;
}
