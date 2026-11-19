/**
 * fill-chart.ts — the stock's chart now, as get_stock_data reads it
 * (lib/market-data/price-structure.ts on a year of daily bars), for pricing a
 * playbook trigger or a chart key (edit_triggers). Null when the bars can't
 * be read: a trigger that needs a number from it is then refused, with why.
 */
import { getDailyBars } from "@/lib/alpaca";
import { CHART_SESSIONS } from "@/lib/market-data/benchmark-bars";
import { computePriceStructure, type PriceStructure } from "@/lib/market-data/price-structure";

export async function loadFillChart(ticker: string): Promise<PriceStructure | null> {
  try {
    const { bars } = await getDailyBars(ticker, CHART_SESSIONS);
    return computePriceStructure({ bars });
  } catch (err) {
    console.warn(`[fill-chart] ${ticker}: the chart couldn't be read: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
