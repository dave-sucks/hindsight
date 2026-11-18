/**
 * The Writer's first message carries the Market and portfolio block when it
 * is given one, after the date; its instructions never do.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/agent/portfolio-block", () => ({ loadPortfolioPieces: jest.fn() }));

import { writerRequest } from "@/lib/agent/run-thesis-writer";

const base = { analyst: { analystPrompt: null }, ticker: "TEST", mode: "mint", existingThesis: null, reason: "a screen", runDate: "2026-09-25" } as never;

it("the Writer's first message has the block after the date, and has none without it", () => {
  const block = "## Market and portfolio\n\n### Portfolio snapshot\nSTAND-IN";
  const built = writerRequest({ ...(base as object), portfolioPieces: [{ id: "portfolio_snapshot", text: "### Portfolio snapshot\nSTAND-IN" }] } as never);
  expect(built.message.startsWith(`## Today\nToday is 2026-09-25.\n\n${block}`)).toBe(true);
  expect(built.instructions).not.toContain("## Market and portfolio");
  expect(writerRequest(base).message).not.toContain("## Market and portfolio");
});
