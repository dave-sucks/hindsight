/**
 * The cache marks reach Anthropic's request as `cache_control`, and nothing
 * changes for OpenAI. Read off the request body the SDK actually sends.
 */
import { generateText, tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { cachedSystem, cachedTools } from "@/lib/agent/prompt-cache";

const TOOLS = {
  first: tool({ description: "First.", inputSchema: z.object({ a: z.string() }) }),
  last: tool({ description: "Last.", inputSchema: z.object({ b: z.string() }) }),
};

async function anthropicBody(): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  const provider = createAnthropic({
    apiKey: "test",
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  await generateText({
    model: provider("claude-sonnet-4-6"),
    system: cachedSystem("anthropic", "The system prompt."),
    prompt: "Hello.",
    tools: cachedTools("anthropic", TOOLS),
  });
  return body;
}

describe("Anthropic prompt cache", () => {
  it("marks the system prompt and the last tool, and only those", async () => {
    const body = await anthropicBody();
    const system = body.system as Array<{ text: string; cache_control?: unknown }>;
    const tools = body.tools as Array<{ name: string; cache_control?: unknown }>;
    expect(system).toEqual([{ type: "text", text: "The system prompt.", cache_control: { type: "ephemeral" } }]);
    expect(tools.map((t) => [t.name, t.cache_control])).toEqual([
      ["first", undefined],
      ["last", { type: "ephemeral" }],
    ]);
  });

  it("leaves an OpenAI request as it was", () => {
    expect(cachedSystem("openai", "The system prompt.")).toBe("The system prompt.");
    expect(cachedTools("openai", TOOLS)).toBe(TOOLS);
  });

  it("does not change the tool it marks", () => {
    const marked = cachedTools("anthropic", TOOLS);
    expect(marked.last.description).toBe("Last.");
    expect(marked.last.inputSchema).toBe(TOOLS.last.inputSchema);
    expect((TOOLS.last as { providerOptions?: unknown }).providerOptions).toBeUndefined();
  });
});
