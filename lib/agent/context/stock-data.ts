/**
 * stock_data: the stock's numbers and chart, as the Writer's pull read them
 * (lib/agent/thesis-research/format-data-block.ts) before its call. The save
 * checks the thesis against the same pull, so the run hands it over.
 */
import type { Fact } from "./fact";

/** The stock's data under its banner. */
export const stockDataText = (dataBlock: string) => `## GROUND-TRUTH DATA — use these numbers; do not invent or contradict\n${dataBlock}`;

export const stockData: Fact = {
  thesis: async (run) => (run.given?.stockData != null ? stockDataText(run.given.stockData) : null),
};
