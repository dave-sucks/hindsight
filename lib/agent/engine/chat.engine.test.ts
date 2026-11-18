/**
 * The chat's instructions built by the agent engine from its record are the
 * old builder's, character for character, in every shape they take
 * (./__fixtures__/chat-cases.ts; the golden file was written from the old
 * builder before the move).
 */
import { chatRequest } from "@/lib/agent/system-prompts/chat";
import { CHAT_CASES, type ChatCaseName } from "./__fixtures__/chat-cases";
import golden from "./__fixtures__/chat.golden.json";

const cases = Object.keys(CHAT_CASES) as ChatCaseName[];

describe("the chat on the agent engine", () => {
  it.each(cases)("%s: the same instructions as before the move", (name) => {
    const built = chatRequest(CHAT_CASES[name] as never);
    expect(built.instructions).toBe((golden.instructions as Record<string, string>)[name]);
    expect(built.message).toBe("");
  });

  it.each(cases)("%s: the parts add up to the instructions", (name) => {
    const built = chatRequest(CHAT_CASES[name] as never);
    expect(built.parts.every((p) => p.where === "instructions")).toBe(true);
    expect(built.parts.reduce((n, p) => n + (p.sep ?? "").length + p.chars, 0)).toBe(built.instructions.length);
  });

  it("names the analyst's room only at the portfolio level, and its money and book only when pinned", () => {
    const ids = (name: ChatCaseName) => chatRequest(CHAT_CASES[name] as never).parts.map((p) => p.id);
    expect(ids("unscoped_rooms")).toContain("analyst_rooms");
    expect(ids("unscoped")).not.toContain("analyst_rooms");
    expect(ids("pinned")).toEqual(expect.arrayContaining(["scope_pinned", "analyst_brief", "money_context", "book_context"]));
    expect(ids("pinned_bare")).not.toContain("money_context");
    expect(ids("pinned")).not.toContain("scope_portfolio");
  });
});
