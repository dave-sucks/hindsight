/**
 * The Writer's system prompt ends with the Market and portfolio block when it
 * is given one, after every fixed instruction.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/agent/portfolio-block", () => ({ loadPortfolioPieces: jest.fn() }));

import { buildWriterResearchPrompt } from "@/lib/agent/run-thesis-writer";

const base = { analyst: { analystPrompt: null }, ticker: "TEST", mode: "mint", existingThesis: null, reason: "a screen", runDate: "2026-09-25" } as never;

it("the Writer's prompt ends with the block, and has none without it", () => {
  const block = "## Market and portfolio\n\n### Portfolio snapshot\nSTAND-IN";
  expect(buildWriterResearchPrompt({ ...(base as object), portfolioPieces: [{ id: "portfolio_snapshot", text: "### Portfolio snapshot\nSTAND-IN" }] } as never).endsWith(block)).toBe(true);
  expect(buildWriterResearchPrompt(base)).not.toContain("## Market and portfolio");
});
