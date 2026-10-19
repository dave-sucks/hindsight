/**
 * A chat's earlier turns reach the model through each tool's own view, and
 * the conversation is read from Anthropic's cache. The 2026-10-15 MU chat
 * re-sent every earlier tool result in full (the route's summary trim never
 * matched a v6 tool part): its first get_theses read went out at 63,044
 * characters on every later turn against a 17,545-character model view.
 * The first two turns of that chat, words stripped, one read row kept.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { convertToModelMessages, type ModelMessage, type ToolSet, type UIMessage } from "ai";
import thread from "@/lib/agent/__fixtures__/chat-history-mu-2026-10-15.json";
import { MODES } from "@/lib/agent/modes";
import { createResearchTools } from "@/lib/agent/tools";
import { cachedMessages, historyForModel } from "@/lib/agent/prompt-cache";

const all = createResearchTools({ runId: "r", userId: "u", accountId: "a", analystId: "an", runMode: "PRINCIPAL_CHAT", runEnvironment: "LIVE" } as never) as Record<string, unknown>;
const chatTools = (without: string[] = []) =>
  Object.fromEntries((MODES.principal.toolAllowlist as readonly string[]).filter((n) => all[n] && !without.includes(n)).map((n) => [n, all[n]])) as ToolSet;
const messages = thread as unknown as UIMessage[];
const resultOf = (mm: ModelMessage[], tool: string) =>
  mm.flatMap((m) => (Array.isArray(m.content) ? (m.content as Array<{ type: string; toolName?: string; output?: unknown }>) : [])).find((p) => p.type === "tool-result" && p.toolName === tool);

describe("a chat's history, as the model reads it", () => {
  it("an earlier turn's get_theses goes through its own view: no UI cards, a smaller history", async () => {
    const asSent = await convertToModelMessages(messages); // what the route sent until now
    const asRead = await historyForModel(messages, chatTools());
    expect(JSON.stringify(resultOf(asSent, "get_theses")!.output)).toContain('"cards"');
    expect(JSON.stringify(resultOf(asRead, "get_theses")!.output)).not.toContain('"cards"');
    expect(JSON.stringify(asRead).length).toBeLessThan(JSON.stringify(asSent).length);
  });

  it("a tool missing from this chat's set passes its result through as is", async () => {
    const asSent = await convertToModelMessages(messages);
    const asRead = await historyForModel(messages, chatTools(["get_theses"]));
    expect(resultOf(asRead, "get_theses")).toEqual(resultOf(asSent, "get_theses"));
  });

  it("the cache mark lands on the last message only, and only on Anthropic", async () => {
    const asRead = await historyForModel(messages, chatTools());
    const marked = cachedMessages("anthropic", asRead);
    expect(marked.at(-1)!.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
    expect(marked.slice(0, -1)).toEqual(asRead.slice(0, -1));
    expect(cachedMessages("openai", asRead)).toBe(asRead);
  });
});
