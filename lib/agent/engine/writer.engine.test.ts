/**
 * A stock is written by one of two agents (lib/agent/engine/agents): the
 * Writer, for a new stock or a watch, and the Holding refresh, for a stock we
 * own. Each one's instructions are the same on every run, with the rules both
 * follow as shared blocks; every fact about the stock (the date, why it was
 * sent, the thesis now, a recent sale, its data) is a block of the first
 * message. The cases are the shapes the old builder took
 * (./__fixtures__/writer-cases.ts).
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { WRITER_CASES, WRITER_MESSAGE, type WriterCaseName } from "./__fixtures__/writer-cases";
import { writerRecordFor, writerRequest, type WriterResearchPromptOpts } from "@/lib/agent/run-thesis-writer";
import { WRITER } from "./agents/writer";
import { HOLDING_REFRESH } from "./agents/holding-refresh";
import { isOwn } from "./types";
import { rowsOf } from "./__fixtures__/rows-of";

const opts = (name: WriterCaseName) => {
  const { pieces, ...rest } = WRITER_CASES[name] as (typeof WRITER_CASES)[WriterCaseName] & { pieces?: WriterResearchPromptOpts["portfolioPieces"] };
  return { ...(rest as unknown as WriterResearchPromptOpts), portfolioPieces: pieces ?? null };
};
const names = Object.keys(WRITER_CASES) as WriterCaseName[];
const held = (name: WriterCaseName) => writerRecordFor(opts(name)).id === "holding_refresh";
/** The instructions without the analyst and its playbooks: the text every run of the agent is sent. */
const fixedOf = (name: WriterCaseName) => {
  const built = writerRequest(opts(name));
  let at = 0;
  let out = "";
  for (const p of built.parts.filter((x) => x.where === "instructions")) {
    at += (p.sep ?? "").length;
    if (p.id !== "analyst_brief" && p.id !== "playbooks") out += built.instructions.slice(at, at + p.chars);
    at += p.chars;
  }
  return out;
};

describe("a stock's two Writer agents", () => {
  it("each record's own words are fixed text, with no part that changes by run and no separator of its own", () => {
    for (const record of [WRITER, HOLDING_REFRESH]) {
      for (const part of [...record.instructions, ...record.message]) {
        expect([record.id, part.sep]).toEqual([record.id, undefined]);
        if (isOwn(part)) expect([record.id, part.own, typeof part.text]).toEqual([record.id, part.own, "string"]);
      }
    }
  });

  it("a stock we own is the Holding refresh's; a new stock, a watch and a promoted stock are the Writer's", () => {
    expect(names.filter(held)).toEqual(["refresh_held"]);
  });

  it("the fixed text is the same in every shape of each agent, and says nothing about the stock", () => {
    const writer = names.filter((n) => !held(n)).map(fixedOf);
    expect(new Set(writer).size).toBe(1);
    expect(writer[0]).toContain("## Triggers on a watch");
    expect(writer[0]).not.toContain("## Triggers on a stock we hold");
    const holding = fixedOf("refresh_held");
    expect(holding).toContain("## Triggers on a stock we hold");
    for (const text of ["THE PLAYBOOK WRITES THE TRIGGERS", "## Triggers on a watch", "YOUR PLAYBOOKS", "The promotion ("]) expect([text, holding.includes(text)]).toEqual([text, false]);
    for (const text of [writer[0], holding]) for (const fact of ["$CASE", "2026-11-17", "A screen found it"]) expect([fact, text.includes(fact)]).toEqual([fact, false]);
  });

  it("both share the research note, the claim, the date rule, the earnings triggers and what the owner reads, word for word", () => {
    const shared = ["date_awareness", "research_note", "thesis_claim", "earnings_triggers", "what_the_owner_reads"];
    for (const id of shared) {
      const a = writerRequest(opts("mint_plain")).parts.find((p) => p.id === id);
      const b = writerRequest(opts("refresh_held")).parts.find((p) => p.id === id);
      expect([id, a?.chars]).toEqual([id, b?.chars]);
      expect(a?.where).toBe("instructions");
    }
  });

  it("the first message carries the stock's facts, then the ask", () => {
    const refresh = writerRequest(opts("refresh_promoted"), { dataBlock: WRITER_MESSAGE.dataBlock, chatFound: WRITER_MESSAGE.chatFound });
    expect(refresh.message.startsWith("## Today\nToday is ")).toBe(true);
    expect(refresh.message).toContain("## Why you were dispatched\nA screen found it near its base.");
    expect(refresh.message).toContain("## Existing thesis (you are refreshing it)\n  • status: PROMOTED");
    expect(refresh.message).toContain("## The promotion\nThis refresh is part of a PAPER→LIVE promotion. Paper history on $CASE: held 41 days");
    expect(refresh.message).toContain("## GROUND-TRUTH DATA — use these numbers; do not invent or contradict\n");
    expect(refresh.message).toContain("## What the chat already found\n");
    expect(refresh.message.endsWith("Write the research note now, then call submit_thesis.")).toBe(true);
    for (const fact of ["## Existing thesis", "## The promotion", "## Why you were dispatched"]) expect([fact, refresh.instructions.includes(fact)]).toEqual([fact, false]);
  });

  it("names every part, and the parts add up to what is sent; a part with nothing this run isn't shown", () => {
    const built = writerRequest(opts("refresh_watch"), { dataBlock: WRITER_MESSAGE.dataBlock, chatFound: WRITER_MESSAGE.chatFound });
    expect(rowsOf(built)?.map((r) => r.name)).toEqual([
      "The analyst",
      "House rules",
      "Weighing the Market and portfolio block",
      "How you write",
      "Its playbooks",
      "Its job",
      "Date awareness",
      "The research note",
      "Its decision and triggers",
      "The Street, the claim and conviction",
      "Earnings triggers",
      "What the owner reads",
      "Today's date",
      "Market numbers",
      "Market digest",
      "Portfolio snapshot",
      "Portfolio digest",
      "Why it was sent",
      "The thesis now",
      "A recent sale",
      "The stock's data",
      "What the chat found",
      "Go",
    ]);
    const holding = writerRequest(opts("refresh_held"), { dataBlock: WRITER_MESSAGE.dataBlock });
    expect(rowsOf(holding)?.map((r) => r.name)).not.toContain("Its playbooks");
  });
});
