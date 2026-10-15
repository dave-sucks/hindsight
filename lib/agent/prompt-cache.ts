/**
 * prompt-cache.ts — Anthropic's prompt cache, turned on where the app calls
 * Claude.
 *
 * OpenAI caches a repeated prefix by itself. Anthropic caches only up to a
 * point the request marks, and the app never marked one: every chat step and
 * every writer step paid full price for the same system prompt and tool
 * definitions (two chat turns on 2026-10-06: 1,294,838 input tokens, 0 read
 * from the cache). Anthropic reads tools first, then the system prompt, then
 * the messages, so one mark after the last tool, one after the system prompt
 * and one on each step's last message cache everything that repeats.
 *
 * A request to any other provider is returned unchanged.
 */
import { convertToModelMessages, type ModelMessage, type SystemModelMessage, type ToolSet, type UIMessage } from "ai";

const EPHEMERAL = { anthropic: { cacheControl: { type: "ephemeral" as const } } };

/** The system prompt, marked as the end of a cached prefix on Anthropic. */
export function cachedSystem(provider: string, text: string): string | SystemModelMessage {
  return provider === "anthropic" ? { role: "system", content: text, providerOptions: EPHEMERAL } : text;
}

/** The tool set with its last tool marked, so every definition before it is cached on Anthropic. */
export function cachedTools<T extends Record<string, unknown>>(provider: string, tools: T): T {
  const names = Object.keys(tools);
  const last = names[names.length - 1];
  if (provider !== "anthropic" || last === undefined) return tools;
  return { ...tools, [last]: { ...(tools[last] as object), providerOptions: EPHEMERAL } };
}

/** The step's messages with the last one marked, so the next step reads the conversation so far from the cache. */
export function cachedMessages(provider: string, messages: ModelMessage[]): ModelMessage[] {
  const last = messages[messages.length - 1];
  if (provider !== "anthropic" || !last) return messages;
  return [...messages.slice(0, -1), { ...last, providerOptions: { ...last.providerOptions, ...EPHEMERAL } } as ModelMessage];
}

/** Earlier turns as the model reads them: each tool result through its tool's own view (forModel), not the UI copy. */
export function historyForModel(messages: Array<Omit<UIMessage, "id">>, tools: ToolSet): Promise<ModelMessage[]> {
  return convertToModelMessages(messages, { tools });
}
