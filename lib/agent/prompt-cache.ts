/**
 * prompt-cache.ts — Anthropic's prompt cache, turned on where the app calls
 * Claude.
 *
 * OpenAI caches a repeated prefix by itself. Anthropic caches only up to a
 * point the request marks, and the app never marked one: every chat step and
 * every writer step paid full price for the same system prompt and tool
 * definitions (two chat turns on 2026-10-06: 1,294,838 input tokens, 0 read
 * from the cache). Anthropic reads tools first, then the system prompt, then
 * the messages, so one mark after the last tool and one after the system
 * prompt cache everything that repeats from one step to the next.
 *
 * A request to any other provider is returned unchanged.
 */
import type { SystemModelMessage } from "ai";

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
