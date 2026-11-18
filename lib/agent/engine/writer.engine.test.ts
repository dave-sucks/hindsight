/**
 * The Writer on the agent engine: in every shape its prompt takes, it is sent
 * what its old builder sent, character for character. The old builder's
 * output on the same cases was frozen before the move
 * (./__fixtures__/writer.golden.json, ./__fixtures__/writer-cases.ts).
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import GOLDEN from "./__fixtures__/writer.golden.json";
import { WRITER_CASES, WRITER_MESSAGE, type WriterCaseName } from "./__fixtures__/writer-cases";
import { writerRequest, type WriterResearchPromptOpts } from "@/lib/agent/run-thesis-writer";
import { byParts } from "@/lib/agent/run-requests";

const opts = (name: WriterCaseName) => {
  const { pieces, ...rest } = WRITER_CASES[name] as (typeof WRITER_CASES)[WriterCaseName] & { pieces?: WriterResearchPromptOpts["portfolioPieces"] };
  return { ...(rest as unknown as WriterResearchPromptOpts), portfolioPieces: pieces ?? null };
};

describe("the Writer on the engine", () => {
  for (const name of Object.keys(WRITER_CASES) as WriterCaseName[]) {
    it(`${name}: its instructions are what the old builder sent`, () => {
      expect(writerRequest(opts(name)).instructions).toBe((GOLDEN.instructions as Record<string, string>)[name]);
    });
  }

  it("its first message is what the old run wrote, with and without what the chat found", () => {
    expect(writerRequest(opts("mint_plain"), { dataBlock: WRITER_MESSAGE.dataBlock, chatFound: WRITER_MESSAGE.chatFound }).message).toBe(GOLDEN.message);
    expect(writerRequest(opts("mint_plain"), { dataBlock: WRITER_MESSAGE.dataBlock, chatFound: null }).message).toBe(GOLDEN.messageNoChat);
  });

  it("names every part, and the parts add up to what is sent; a part with nothing this run isn't shown", () => {
    const built = writerRequest(opts("refresh_watch"), { dataBlock: WRITER_MESSAGE.dataBlock, chatFound: WRITER_MESSAGE.chatFound });
    const rows = byParts(built.parts, built.instructions, built.message);
    expect(rows).not.toBeNull();
    expect(rows!.map((r) => r.name)).toEqual([
      "The analyst",
      "House rules",
      "How you write",
      "The task",
      "Its playbooks",
      "Why it was sent",
      "The thesis now",
      "Today's date",
      "Its job",
      "Triggers",
      "Earnings triggers",
      "A recent sale",
      "What the owner reads",
      "Market numbers",
      "Market digest",
      "Portfolio snapshot",
      "Portfolio digest",
      "The data's heading",
      "The stock's data",
      "What the chat found",
      "Go",
    ]);
  });
});
