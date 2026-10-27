/**
 * written-up.ts — the price under a thesis's belief ("Written Sep 13 at
 * $38.38"): what the stock cost when the research writer wrote it up.
 *
 * The writer's own pull records it ("Data pulled", payload.currentPrice). A
 * mint's CREATED row stamps the plan's buy level instead (IOT 2026-09-13:
 * $39.55 against a $38.38 stock), so it is never the fallback; a refresh's
 * row stamps the pulled price, so it is.
 */
export function writtenUpPrice(
  row: { type: string; priceAtTime: number | null } | null,
  pullPayload: unknown,
): number | null {
  const pulled = (pullPayload as { currentPrice?: unknown } | null)?.currentPrice;
  if (typeof pulled === "number" && Number.isFinite(pulled) && pulled > 0) return pulled;
  if (!row || row.type === "CREATED") return null;
  return row.priceAtTime ?? null;
}
