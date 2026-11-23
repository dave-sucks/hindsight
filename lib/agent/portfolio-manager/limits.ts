/**
 * The Portfolio Manager's limits, held in code: a run told a limit in its job
 * text went past it (it asked for the whole account, and searched the web on
 * stocks it was not trading).
 *
 *   - get_theses: any holding, and WATCHES_A_RUN watched stocks a run.
 *   - PROPOSALS_A_RUN trade proposals a run.
 *   - NEW_STOCKS_A_RUN stocks nobody covers sent to research a run.
 *   - A note goes with a trade, a research request or a trigger edit this run
 *     made on that stock; the rest of its view is its write-up.
 *   - Its trades always wait for the owner (`isManagerRun` at each trade
 *     tool's approval check), whatever the account's switches say.
 */
import { z } from "zod";
import type { ToolSet } from "ai";

export const WATCHES_A_RUN = 8;
export const PROPOSALS_A_RUN = 3;
/** Stocks no analyst holds or watches that a run may send to research. */
export const NEW_STOCKS_A_RUN = 1;

export const isManagerRun = (ctx: { runMode?: string }) => ctx.runMode === "PORTFOLIO_MANAGER";

export const managerReadSchema = z.object({
  tickers: z.array(z.string()).describe(`The stocks to get the thesis on. Any stock we own; ${WATCHES_A_RUN} watched stocks a run at most, so name the watches you are weighing a buy on.`),
});

const asked = new WeakMap<object, Set<string>>();

/** The tickers this call gets: every holding asked for, and watches counted against the run. `note` names the ones left out, `refused` says none came back. */
export function managerPick(ctx: object, input: { tickers?: string[] }, held: ReadonlySet<string>): { tickers: string[]; note?: string; refused?: string } {
  const seen = asked.get(ctx) ?? new Set<string>();
  asked.set(ctx, seen);
  const want = [...new Set((input.tickers ?? []).map((t) => t.trim().toUpperCase()).filter(Boolean))];
  if (want.length === 0) return { tickers: [], refused: "Name the stocks by ticker. Every stock we hold and watch is in the stock table above." };
  const tickers = want.filter((t) => held.has(t) || seen.has(t) || (seen.size < WATCHES_A_RUN && seen.add(t)));
  const left = want.filter((t) => !tickers.includes(t));
  if (tickers.length === 0) return { tickers, refused: `Not returned: ${left.join(", ")}. You have asked about your ${WATCHES_A_RUN} watched stocks for this run. Decide from what you have.` };
  return { tickers, ...(left.length ? { note: `Not returned: ${left.join(", ")}. The limit is ${WATCHES_A_RUN} watched stocks a run.` } : {}) };
}

/** Why a run that has sent `sent` can't send one more stock nobody covers to research, or null. dispatch_thesis_research asks, with the new stocks this run's Writers were sent. */
export function newStockRefusal(sent: string[], ticker: string): string | null {
  return sent.length >= NEW_STOCKS_A_RUN && !sent.includes(ticker)
    ? `You have sent your ${NEW_STOCKS_A_RUN} new stock to research for this run (${sent.join(", ")}). Name $${ticker} under "What the account needs" in your write-up.`
    : null;
}

const refusal = (error: string) => ({ ok: false as const, error, retryable: false, sources: [] });
const TRADES: Record<string, string> = { place_trade: "ticker", add: "ticker", sell: "ticker" };

/**
 * The run's tools with its proposal limit and its note rule. `tickerOf` reads
 * a thesis's stock. One call per run: the counts are this run's.
 */
export function withRunLimits(real: ToolSet, tickerOf: (thesisId: string) => Promise<string | null>): ToolSet {
  const proposed: string[] = [];
  const noteAllowed = new Set<string>();
  // The stocks sent to research this run, by ticker: the send names the stock, not a thesis.
  const researched = new Set<string>();
  type Exec = (input: Record<string, unknown>, options: unknown) => Promise<unknown>;
  const wrap = (name: string, before: (input: Record<string, unknown>) => Promise<string | null> | string | null, after?: (input: Record<string, unknown>, out: unknown) => void) => {
    const t = real[name] as unknown as { execute?: Exec } | undefined;
    if (!t?.execute) return t;
    const run = t.execute;
    return {
      ...t,
      execute: async (input: Record<string, unknown>, options: unknown) => {
        const no = await before(input);
        if (no) return refusal(no);
        const out = await run(input, options);
        if ((out as { ok?: boolean } | null)?.ok === true) after?.(input, out);
        return out;
      },
    };
  };
  const out: Record<string, unknown> = { ...real };
  for (const [name, key] of Object.entries(TRADES)) {
    out[name] = wrap(
      name,
      () => (proposed.length >= PROPOSALS_A_RUN ? `You have made your ${PROPOSALS_A_RUN} proposals for this run (${proposed.join(", ")}). Put the rest of your view in your write-up.` : null),
      (input) => proposed.push(String(input[key] ?? "").toUpperCase()),
    );
  }
  out.dispatch_thesis_research = wrap("dispatch_thesis_research", () => null, (input) => {
    if (typeof input.ticker === "string") researched.add(input.ticker.toUpperCase());
  });
  // A trigger edit allows a note on that stock, as a trade or a research request does, once one of its ops landed.
  out.edit_triggers = wrap("edit_triggers", () => null, (input, result) => {
    const ops = (result as { data?: { trigger_ops?: Array<{ ok?: boolean }> } } | null)?.data?.trigger_ops ?? [];
    if (typeof input.thesis_id === "string" && ops.some((o) => o.ok)) noteAllowed.add(input.thesis_id);
  });
  out.write_note = wrap("write_note", async (input) => {
    const id = String(input.thesis_id ?? "");
    if (noteAllowed.has(id)) return null;
    const ticker = (await tickerOf(id))?.toUpperCase();
    return ticker && (proposed.includes(ticker) || researched.has(ticker)) ? null : "A note goes with a trade, a research request or a trigger edit you made on that stock this run. Put this view in your write-up.";
  });
  return out as ToolSet;
}
