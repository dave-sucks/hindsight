/**
 * The Writer's first message carries the market numbers from the Market and
 * portfolio block when it is given them, after the date; its instructions
 * never do, and it gets nothing else of the block.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/agent/portfolio-block", () => ({ loadPortfolioPieces: jest.fn() }));

import { writerRequest } from "@/lib/agent/run-thesis-writer";

const base = { analyst: { analystPrompt: null }, ticker: "TEST", mode: "mint", existingThesis: null, reason: "a screen", runDate: "2026-09-25" } as never;

it("the Writer's first message has the market numbers after the date, and none of the block without them", () => {
  const block = "## Market and portfolio\n\n### Market numbers\nSTAND-IN";
  const pieces = [
    { id: "market_numbers", text: "### Market numbers\nSTAND-IN" },
    { id: "portfolio_snapshot", text: "### Portfolio snapshot\nNOT SENT" },
    { id: "portfolio_digest", text: "### Portfolio digest\nNOT SENT" },
  ];
  const built = writerRequest({ ...(base as object), portfolioPieces: pieces } as never);
  expect(built.message.startsWith(`## Today\nToday is 2026-09-25.\n\n${block}`)).toBe(true);
  expect(built.message).not.toContain("NOT SENT");
  expect(built.instructions).not.toContain("## Market and portfolio");
  expect(writerRequest(base).message).not.toContain("## Market and portfolio");
});
