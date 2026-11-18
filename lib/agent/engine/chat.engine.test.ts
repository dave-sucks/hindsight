/**
 * The chat (lib/agent/engine/agents/chat.ts): its own text is one fixed text,
 * the same on every run, and says what both scopes mean. Pinned to an
 * analyst, the analyst's blocks end the instructions, after the fixed text;
 * at the portfolio level, each analyst's room does. The cases are the shapes
 * the old builder took (./__fixtures__/chat-cases.ts). What rides on your
 * newest message is the same as the route made it before the move
 * (./__fixtures__/chat-newest.golden.json).
 */
import type { ModelMessage } from "ai";
import { withNewestParts } from "@/lib/agent/old-lookups";
import { chatNewest, chatRequest } from "@/lib/agent/system-prompts/chat";
import { CHAT } from "./agents/chat";
import { isOwn } from "./types";
import { rowsOf } from "./__fixtures__/rows-of";
import { CHAT_CASES, type ChatCaseName } from "./__fixtures__/chat-cases";
import { CHAT_NEWEST_CASES, CHAT_NEWEST_THREAD, type ChatNewestCaseName } from "./__fixtures__/chat-newest-cases";
import newestGolden from "./__fixtures__/chat-newest.golden.json";

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

const cases = Object.keys(CHAT_CASES) as ChatCaseName[];
const built = (name: ChatCaseName) => chatRequest(CHAT_CASES[name] as never);
/** The text of one part of the instructions, by its id. */
const partText = (name: ChatCaseName, id: string) => {
  const b = built(name);
  let at = 0;
  for (const p of b.parts) {
    at += (p.sep ?? "").length;
    if (p.id === id) return b.instructions.slice(at, at + p.chars);
    at += p.chars;
  }
  return null;
};

describe("the chat on the agent engine", () => {
  it("its own words are one fixed text, with no part that changes by run and no separator of its own", () => {
    const own = [...CHAT.instructions, ...CHAT.message].filter(isOwn);
    expect(own.map((p) => [p.own, typeof p.text])).toEqual([["instructions", "string"]]);
    for (const part of [...CHAT.instructions, ...CHAT.message]) expect(part.sep).toBeUndefined();
    expect(CHAT.message).toEqual([]);
  });

  it("the fixed text is the same in every shape, says what both scopes mean, and names no analyst", () => {
    const texts = cases.map((name) => partText(name, "instructions"));
    expect(new Set(texts).size).toBe(1);
    const text = texts[0]!;
    expect(text).toContain("## Pinned to an analyst\n\nWhen these instructions end with an analyst's blocks");
    expect(text).toContain("## At the portfolio level\n\nWithout them, this chat is at the portfolio level");
    expect(text).not.toContain("══");
    for (const fact of ["Case Analyst", "analyst_case", "Information Technology", "AAA"]) expect([fact, text.includes(fact)]).toEqual([fact, false]);
  });

  it("pinned, the analyst's scope, brief, money and book end the instructions, after the house rules and how you write", () => {
    const ids = (name: ChatCaseName) => built(name).parts.map((p) => p.id);
    expect(ids("pinned")).toEqual(["instructions", "house_rules", "market_block_rule", "how_you_write", "analyst_scope", "analyst_brief", "money_context", "book_context"]);
    expect(ids("pinned_bare")).toEqual(["instructions", "house_rules", "market_block_rule", "how_you_write", "analyst_scope", "analyst_brief"]);
    expect(partText("pinned", "analyst_scope")).toBe(
      "## Current scope — pinned to Case Analyst\n\n  • Analyst ID: `analyst_case`\n  • Sectors: Information Technology\n  • Market cap: $2B – no ceiling\n  • Exclusions: XXX\n  • Watchlist: AAA, BBB",
    );
    expect(built("pinned").instructions.endsWith("THIS SEAT'S BOOK (live)\n  • $AAA 10 sh @ $100.00 ≈ $1,100")).toBe(true);
  });

  it("at the portfolio level, each analyst's room ends the instructions when there are any, and no analyst's blocks are given", () => {
    const ids = (name: ChatCaseName) => built(name).parts.map((p) => p.id);
    expect(ids("unscoped")).toEqual(["instructions", "house_rules", "market_block_rule", "how_you_write"]);
    expect(ids("unscoped_rooms")).toEqual(["instructions", "house_rules", "market_block_rule", "how_you_write", "analyst_rooms"]);
    expect(built("unscoped_rooms").instructions.endsWith("## Each analyst's room (a buy for a FULL analyst is refused)\n  • Case Analyst: 4 of 6 held, 2 free\n  • Other Analyst: FULL, 5 of 5")).toBe(true);
  });

  it.each(cases)("%s: names every part, and the parts add up to the instructions", (name) => {
    const b = built(name);
    expect(b.message).toBe("");
    expect(b.parts.every((p) => p.where === "instructions")).toBe(true);
    expect(rowsOf(b)?.map((r) => r.name)[0]).toBe("Its instructions");
  });

  const newestCases = Object.keys(CHAT_NEWEST_CASES) as ChatNewestCaseName[];

  it.each(newestCases)("newest message, %s: the same as the route made it before the move", (name) => {
    const c = CHAT_NEWEST_CASES[name];
    const b = chatNewest(new Date(c.now), c.pieces ? [...c.pieces] : null);
    expect(withNewestParts(CHAT_NEWEST_THREAD as ModelMessage[], b.texts)).toEqual((newestGolden.messages as Record<string, unknown>)[name]);
  });

  it.each(newestCases)("newest message, %s: its parts add up to the texts joined as the Context panel joins them", (name) => {
    const c = CHAT_NEWEST_CASES[name];
    const b = chatNewest(new Date(c.now), c.pieces ? [...c.pieces] : null);
    expect(b.parts.every((p) => p.where === "newest")).toBe(true);
    expect(b.parts.reduce((n, p) => n + (p.sep ?? "").length + p.chars, 0)).toBe(b.texts.join("\n\n").length);
  });
});
