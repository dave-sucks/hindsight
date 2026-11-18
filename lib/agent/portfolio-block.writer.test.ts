/**
 * The Writer's first message carries the market numbers when it is given
 * them, after the date line and the sender's brief, and none of the rest of
 * the Market and portfolio reads; its instructions never do.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/agent/portfolio-block", () => ({ loadPortfolioPieces: jest.fn() }));

import { writerRequest } from "@/lib/agent/run-thesis-writer";

const base = { analyst: { analystPrompt: null }, ticker: "TEST", mode: "mint", existingThesis: null, reason: "a screen" } as never;
const NOW = new Date("2026-09-25T13:00:00Z");

it("the Writer's first message has the market numbers after the date line, and no snapshot", () => {
  const built = writerRequest(
    { ...(base as object), portfolioPieces: [{ id: "market_numbers", text: "### Market numbers\nN" }, { id: "portfolio_snapshot", text: "### Portfolio snapshot\nSTAND-IN" }] } as never,
    undefined,
    NOW,
  );
  expect(built.message).toBe(
    "Fri, Sep 25, 2026, 9:00 AM ET, the PAPER account.\n\n## Why you were dispatched\na screen\n\nWrite the research note now, then call submit_thesis.\n\n## Market and portfolio\n\n### Market numbers\nN",
  );
  expect(built.message).not.toContain("STAND-IN");
  expect(built.instructions).not.toContain("## Market and portfolio");
  expect(writerRequest(base).message).not.toContain("## Market and portfolio");
});
