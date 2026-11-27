/**
 * The chart a recorded Writer case was shown, read back from its data block's
 * text (format-data-block.ts's Snapshot and Price structure lines): the
 * numbers a playbook's keys read (fillValue, lib/agent/knowledge/playbooks.ts).
 * A replay prices the playbook's triggers from it as the save prices them
 * from the pull's chart (scripts/hero-case.ts). Pure.
 */
import type { PriceStructure } from "@/lib/market-data/price-structure";

const $ = (s: string) => Number(s.replace(/,/g, ""));

/** The chart's key numbers in a data block, or null when it has none. */
export function chartFromText(text: string): PriceStructure | null {
  const range = text.match(/Range — 20-day \$([\d,.]+)–\$([\d,.]+) · 52-week \$([\d,.]+)–\$([\d,.]+)/);
  if (!range) return null;
  const high = text.match(/last swing high \$([\d,.]+) \(([\d-]+)\)/);
  const low = text.match(/last swing low \$([\d,.]+) \(([\d-]+)\)/);
  const base = text.match(/Base — (\d+) sessions, ([\d-]+) to ([\d-]+): pivot \$([\d,.]+), low \$([\d,.]+)/);
  const gapsLine = text.match(/Gaps \(last 10 sessions, 3%\+\) — ([^\n]*)/)?.[1] ?? "";
  const gaps = [...gapsLine.matchAll(/([\d-]+) (UP|DOWN) ([+-]?[\d.]+)%(?: on ([\d.]+)× volume)?: gap-day low \$([\d,.]+) · mid \$([\d,.]+) · high \$([\d,.]+)/g)].map((g) => ({
    date: g[1], direction: g[2], pct: Number(g[3]), volumeRatio: g[4] != null ? Number(g[4]) : null, low: $(g[5]), mid: $(g[6]), high: $(g[7]),
  }));
  const price = text.match(/Current: \$([\d,.]+)/);
  // The averages line: "Moving averages — 20-day $281.40 (…) · 50-day $269.51 (…) · … · 10-day EMA $279.10".
  const averages = text.match(/Moving averages — ([^\n]*)/)?.[1] ?? "";
  const sma = (days: number) => {
    const m = averages.match(new RegExp(`\\b${days}-day \\$([\\d,.]+)`));
    return m ? { value: $(m[1]) } : null;
  };
  const ema = (days: number) => {
    const m = averages.match(new RegExp(`\\b${days}-day EMA \\$([\\d,.]+)`));
    return m ? $(m[1]) : null;
  };
  return {
    price: price ? $(price[1]) : null,
    range: { low20: $(range[1]), high20: $(range[2]), low52w: $(range[3]), high52w: $(range[4]) },
    swings: { lastHigh: high ? { price: $(high[1]), date: high[2] } : null, lastLow: low ? { price: $(low[1]), date: low[2] } : null },
    base: base ? { lengthBars: Number(base[1]), startDate: base[2], endDate: base[3], pivot: $(base[4]), low: $(base[5]) } : null,
    gaps,
    sma: { d20: sma(20), d50: sma(50), d150: sma(150), d200: sma(200) },
    ema: { d10: ema(10), d21: ema(21) },
  } as unknown as PriceStructure;
}
