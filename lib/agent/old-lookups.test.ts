/**
 * 2026-11-04: the chat read its Oct 27 get_portfolio_context back on Nov 4 and
 * told the owner MU was $932.24, up on its cost; MU was at $808, down 11%.
 * The fixture is that lookup (MU and PLTR rows only) and the ASML sale the same
 * chat proposed, with the owner's words replaced.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import type { ModelMessage, ToolSet, UIMessage } from "ai";
import thread from "@/lib/agent/__fixtures__/chat-old-lookups-2026-11-04.json";
import { MODES } from "@/lib/agent/modes";
import { createResearchTools } from "@/lib/agent/tools";
import { historyForModel } from "@/lib/agent/prompt-cache";
import { hideOldLookups, withTheTime } from "@/lib/agent/old-lookups";

const all = createResearchTools({ runId: "r", userId: "u", accountId: "a", runMode: "PRINCIPAL_CHAT", runEnvironment: "LIVE" } as never) as Record<string, unknown>;
const tools = Object.fromEntries((MODES.principal.toolAllowlist as readonly string[]).filter((n) => all[n]).map((n) => [n, all[n]])) as ToolSet;
const messages = thread as unknown as UIMessage[];
const NOV_4 = new Date("2026-11-04T18:30:00Z"); // 1:30 PM ET, the market open

const results = (mm: ModelMessage[]) =>
  mm.flatMap((m) => (Array.isArray(m.content) ? (m.content as Array<{ type: string; toolName?: string; output?: { type: string; value: unknown } }>) : []))
    .filter((p) => p.type === "tool-result");
const resultOf = (mm: ModelMessage[], tool: string) => results(mm).find((p) => p.toolName === tool)!;
const read = (mm: ModelMessage[]) => withTheTime(mm, NOV_4);

describe("the chat never reads an old lookup as today's numbers", () => {
  it("the Oct 27 portfolio lookup reaches the model on Nov 4 as 'look again', with no price in it", async () => {
    const mm = read(await historyForModel(hideOldLookups(messages, NOV_4), tools));
    const portfolio = resultOf(mm, "get_portfolio_context");
    expect(portfolio.output!.type).toBe("error-text");
    expect(portfolio.output!.value).toBe(
      "This get_portfolio_context lookup ran in an earlier session. Its numbers are out of date and hidden. Call get_portfolio_context again for current ones.",
    );
    expect(JSON.stringify(results(mm))).not.toContain("932.24");
  });

  it("before this fix the same history handed the model MU at $932.24", async () => {
    const mm = await historyForModel(messages, tools);
    expect(JSON.stringify(resultOf(mm, "get_portfolio_context").output)).toContain("$932.24 (+2.28%)");
  });

  it("a dated lookup says when it ran", async () => {
    const dated = structuredClone(messages);
    (dated[1].parts[0] as unknown as { output: { at: string } }).output.at = "2026-10-27T21:18:40Z";
    const portfolio = resultOf(await historyForModel(hideOldLookups(dated, NOV_4), tools), "get_portfolio_context");
    expect(portfolio.output!.value).toMatch(/^This get_portfolio_context lookup ran Oct 27, 5:18 PM ET, 8 days ago\./);
  });

  it("a lookup from five minutes ago reaches the model whole", async () => {
    const fresh = structuredClone(messages);
    (fresh[1].parts[0] as unknown as { output: { at: string } }).output.at = new Date(NOV_4.getTime() - 5 * 60_000).toISOString();
    const portfolio = resultOf(await historyForModel(hideOldLookups(fresh, NOV_4), tools), "get_portfolio_context");
    expect(JSON.stringify(portfolio.output)).toContain("$932.24 (+2.28%)");
  });

  it("the sale the chat proposed keeps its result, so it is never proposed twice", async () => {
    const mm = await historyForModel(hideOldLookups(messages, NOV_4), tools);
    expect(JSON.stringify(resultOf(mm, "close_position").output)).toContain("Close proposed: $ASML");
  });

  it("the owner's newest message carries the day, the time and whether the market is open", async () => {
    const mm = read(await historyForModel(hideOldLookups(messages, NOV_4), tools));
    const last = mm.at(-1)! as { role: string; content: Array<{ type: string; text: string }> };
    expect(last.role).toBe("user");
    expect(last.content[0].text).toBe(
      "[Wed Nov 4, 1:30 PM ET, the market is open. A price in an earlier message is from when that message was written.]",
    );
    expect(last.content[1].text).toBe("(eight days later: what do I do with MU and PLTR?)");
  });
});

describe("the chat's Market and portfolio block", () => {
  it("rides on the newest owner message after the time line, and nowhere else", () => {
    const mm: ModelMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "second" },
    ];
    const out = withTheTime(mm, NOV_4, "## Market and portfolio\n\nSTAND-IN");
    expect(out[0]).toEqual(mm[0]);
    const parts = (out[2] as { content: Array<{ type: string; text: string }> }).content.map((p) => p.text);
    expect(parts[1]).toBe("## Market and portfolio\n\nSTAND-IN");
    expect(parts[2]).toBe("second");
    expect(parts[0]).toMatch(/^\[/);
  });
});
