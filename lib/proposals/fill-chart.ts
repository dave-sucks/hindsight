/**
 * fill-chart.ts — the stock's chart at the fill, as get_stock_data reads it
 * (lib/market-data/price-structure.ts on a year of daily bars), for the
 * playbook's triggers that come with the buy (withTheBuyTriggers). Null when
 * the bars can't be read: those triggers are then not written, and the
 * fill's Activity line says so.
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
