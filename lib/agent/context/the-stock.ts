/**
 * the_stock: a thesis's row as every run reads it (get_theses on its ticker,
 * lib/agent/row-for-model.ts), through the run's own tools. A stock the
 * Writer writes for the first time has none.
 */
import { stockFromRead, stockRowText } from "@/lib/agent/system-prompts/intraday-tactical";
import { once, type ContextRun, type Fact } from "./fact";
import type { SubjectOf } from "./bundles";

type Read = ReturnType<typeof stockFromRead>;

/** The stock's get_theses read, once per run: its row and its situations. Null when the read fails. */
export function readStock(run: ContextRun<SubjectOf<"thesis">>): Promise<Read> {
  const { ticker, thesisId } = run.subject;
  if (!thesisId) return Promise.resolve(null);
  return once(run, "the-stock", async () => {
    const getTheses = run.toolset?.get_theses as { execute?: (input: unknown, options: unknown) => Promise<unknown> } | undefined;
    try {
      if (!getTheses?.execute) throw new Error("the run has no get_theses to read it with");
      const out = (await getTheses.execute({ tickers: [ticker] }, { toolCallId: "read-the-stock", messages: [] })) as { ok?: boolean; data?: unknown };
      return stockFromRead(out, thesisId);
    } catch (err) {
      console.warn(`[context] the read of ${ticker} failed:`, err);
      return null;
    }
  });
}

export const theStock: Fact = {
  thesis: async (run) => (run.subject.thesisId ? stockRowText({ ticker: run.subject.ticker, row: (await readStock(run))?.row ?? null }) : null),
};
