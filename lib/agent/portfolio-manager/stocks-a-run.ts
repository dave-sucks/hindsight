/**
 * The Portfolio Manager asks get_theses for stocks by ticker, like any agent,
 * and may ask about STOCKS_A_RUN of them in one run. The limit is here, in
 * the tool, because a run told a limit in its job text asked for the whole
 * account anyway.
 */
import { z } from "zod";

export const STOCKS_A_RUN = 8;

export const isManagerRun = (ctx: { runMode?: string }) => ctx.runMode === "PORTFOLIO_MANAGER";

export const managerReadSchema = z.object({
  tickers: z.array(z.string()).describe(`The stocks to get the thesis on. ${STOCKS_A_RUN} stocks a run at most, so name the ones you are weighing a trade on.`),
});

const asked = new WeakMap<object, Set<string>>();

/** The tickers this call gets, counted against the run; `note` names the ones left out, `refused` says none were given. */
export function managerPick(ctx: object, input: { tickers?: string[] }): { tickers: string[]; note?: string; refused?: string } {
  const seen = asked.get(ctx) ?? new Set<string>();
  asked.set(ctx, seen);
  const want = [...new Set((input.tickers ?? []).map((t) => t.trim().toUpperCase()).filter(Boolean))];
  if (want.length === 0) return { tickers: [], refused: "Name the stocks by ticker. Every holding and every watched stock is in the Portfolio snapshot and the Watching block above." };
  const tickers = want.filter((t) => seen.has(t) || (seen.size < STOCKS_A_RUN && seen.add(t)));
  const left = want.filter((t) => !tickers.includes(t));
  if (tickers.length === 0) return { tickers, refused: `Not returned: ${left.join(", ")}. You have asked about your ${STOCKS_A_RUN} stocks for this run. Decide from what you have.` };
  return { tickers, ...(left.length ? { note: `Not returned: ${left.join(", ")}. The limit is ${STOCKS_A_RUN} stocks a run.` } : {}) };
}
