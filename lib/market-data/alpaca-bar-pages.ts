/**
 * Every page of an Alpaca bars request.
 *
 * Alpaca caps each answer and returns `next_page_token` for the rest. The
 * charts read only the first page, so the sheet's 1M view of MU ended on
 * Nov 3 when read on Nov 20 (2026), and a batch of daily bars for several
 * stocks stopped at 1,000 bars, leaving the later stocks short. This follows
 * the token until Alpaca says there is no more.
 *
 * The single-stock endpoint answers with a list of bars; the multi-stock one
 * with bars keyed by symbol. Both are merged here, in page order. Null when
 * Alpaca refuses a page, so a caller never shows half a range as the whole.
 */

export type AlpacaBar = { c: number; o: number; h: number; l: number; v: number; t: string };

export type BarPages = { list: AlpacaBar[]; bySymbol: Record<string, AlpacaBar[]> };

/** Enough for a year of hourly bars on a list of stocks; a stop, not a target. */
export const MAX_BAR_PAGES = 50;

export async function fetchAllBarPages(url: string, init: RequestInit, label: string): Promise<BarPages | null> {
  const out: BarPages = { list: [], bySymbol: {} };
  let token: string | undefined;
  for (let page = 0; page < MAX_BAR_PAGES; page++) {
    const res = await fetch(token ? `${url}&page_token=${encodeURIComponent(token)}` : url, init);
    if (!res.ok) {
      console.warn(`[${label}] Alpaca error`, res.status, await res.text().catch(() => ''));
      return null;
    }
    const body = (await res.json()) as {
      bars?: AlpacaBar[] | Record<string, AlpacaBar[]> | null;
      next_page_token?: string | null;
    };
    if (Array.isArray(body.bars)) out.list.push(...body.bars);
    else if (body.bars) for (const [symbol, bars] of Object.entries(body.bars)) (out.bySymbol[symbol] ??= []).push(...bars);
    token = body.next_page_token ?? undefined;
    if (!token) return out;
  }
  console.warn(`[${label}] stopped after ${MAX_BAR_PAGES} pages; the range may be short`);
  return out;
}
