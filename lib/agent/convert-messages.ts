/**
 * Convert persisted messages (mixed UIMessage + ModelMessage) back to
 * ThreadMessageLike[] for replaying completed agent runs via
 * useExternalStoreRuntime in AgentThread.
 *
 * The agent route's onFinish saves [...clientUIMessages, ...responseModelMessages].
 * UIMessages have `parts` arrays; ModelMessages have `content` arrays with
 * `role: "assistant"` or `role: "tool"`.
 *
 * Output uses @assistant-ui's ThreadMessageLike format where tool parts are:
 *   { type: "tool-call", toolCallId, toolName, args, result }
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReplayToolCall {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export interface ReplayMessage {
  id: string;
  role: "user" | "assistant";
  content: Array<{ type: "text"; text: string } | ReplayToolCall>;
  createdAt: Date;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

let idCounter = 0;
function genId() {
  return `replay-${idCounter++}`;
}

function isUIMessage(msg: Record<string, unknown>): boolean {
  return Array.isArray(msg.parts);
}

// ── Converter ────────────────────────────────────────────────────────────────

export function convertPersistedToReplayMessages(
  raw: unknown[],
): ReplayMessage[] {
  idCounter = 0;
  const result: ReplayMessage[] = [];
  let currentAssistant: ReplayMessage | null = null;

  for (const rawMsg of raw) {
    const msg = rawMsg as Record<string, unknown>;

    // ── Already a UIMessage (from the client input) ────────────────────
    if (isUIMessage(msg)) {
      currentAssistant = null;
      const parts = msg.parts as Record<string, unknown>[];
      const content: ReplayMessage["content"] = [];
      for (const p of parts) {
        if (p.type === "text") {
          content.push({ type: "text", text: p.text as string });
        }
        // UIMessage tool parts (type "tool-{name}") — convert to tool-call
        if (typeof p.type === "string" && (p.type as string).startsWith("tool-")) {
          content.push({
            type: "tool-call",
            toolCallId: (p.toolCallId as string) || genId(),
            toolName: (p.toolName as string) || (p.type as string).slice(5),
            args: (p.input ?? p.args ?? {}) as Record<string, unknown>,
            result: p.output ?? p.result,
          });
        }
      }
      result.push({
        id: (msg.id as string) || genId(),
        role: msg.role as "user" | "assistant",
        content,
        createdAt: msg.createdAt ? new Date(msg.createdAt as string) : new Date(),
      });
      continue;
    }

    const role = msg.role as string;
    const rawContent = msg.content;

    // ── User ModelMessage ──────────────────────────────────────────────
    if (role === "user") {
      currentAssistant = null;
      const content: ReplayMessage["content"] = [];
      if (typeof rawContent === "string") {
        content.push({ type: "text", text: rawContent });
      } else if (Array.isArray(rawContent)) {
        for (const c of rawContent) {
          const p = c as Record<string, unknown>;
          if (p.type === "text") {
            content.push({ type: "text", text: p.text as string });
          }
        }
      }
      result.push({ id: genId(), role: "user", content, createdAt: new Date() });
      continue;
    }

    // ── Assistant ModelMessage ──────────────────────────────────────────
    if (role === "assistant") {
      const replayMsg: ReplayMessage = {
        id: genId(),
        role: "assistant",
        content: [],
        createdAt: new Date(),
      };

      if (Array.isArray(rawContent)) {
        for (const c of rawContent) {
          const p = c as Record<string, unknown>;
          if (p.type === "text" && (p.text as string)?.length > 0) {
            replayMsg.content.push({ type: "text", text: p.text as string });
          } else if (p.type === "tool-call") {
            replayMsg.content.push({
              type: "tool-call",
              toolCallId: p.toolCallId as string,
              toolName: p.toolName as string,
              args: (p.args ?? {}) as Record<string, unknown>,
              // result will be attached when we process the "tool" message
            });
          }
        }
      }

      currentAssistant = replayMsg;
      result.push(replayMsg);
      continue;
    }

    // ── Tool ModelMessage (results) ────────────────────────────────────
    if (role === "tool") {
      if (!currentAssistant || !Array.isArray(rawContent)) continue;

      for (const c of rawContent) {
        const p = c as Record<string, unknown>;
        if (p.type === "tool-result") {
          const toolPart = currentAssistant.content.find(
            (part): part is ReplayToolCall =>
              part.type === "tool-call" &&
              (part as ReplayToolCall).toolCallId === p.toolCallId,
          );
          if (toolPart) {
            toolPart.result = p.result;
          }
        }
      }
      continue;
    }
  }

  return result;
}
