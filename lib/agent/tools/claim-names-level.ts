/**
 * claim-names-level.ts — the one sentence a save adds when it moves a
 * trigger's price that the claim still names (step 12, part 1).
 *
 * MU, 2026-09-23: the morning run raised the floor $969 → $1,041 and "MU
 * closes below the $969 stop-loss" stayed in what-proves-it-wrong; by 10-09
 * the floor was $1,005 and the line still said $969. Information, never a
 * refusal: the claim is the writer's and the owner's to fix, the save only
 * says it has gone stale. A dollar figure counts when it sits within 0.5% of
 * the trigger's old price; sizes ($22B, $50M) and percentages are not prices.
 *
 * Each trigger is compared with itself, by id, before and after the save.
 */

import { sentenceOf } from "@/lib/agent/triggers/condition/describe";
import { typedPriceOf } from "@/lib/agent/triggers/price-levels";
import type { Trigger } from "@/lib/agent/triggers/types";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Every dollar figure in a text ($969, $1,041.50), leaving out sizes ($22B, $50M, $5K) and percentages. */
export function dollarFigures(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)(?![\d,.])(?!\s?[BMK%])/g)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * One sentence per moved trigger the claim still names: "Your KPIs
 * still name $969; the trigger now reads "Sell if below $1,041"."
 * Empty when no trigger's price moved, or the claim names none of the old prices.
 */
export function claimNamesOldLevel(input: {
  before: readonly Trigger[];
  after: readonly Trigger[];
  coreBelief: string | null;
  kpis: string[];
}): string[] {
  const texts: Array<[string, string]> = [];
  if (input.coreBelief?.trim()) texts.push(["Your belief", input.coreBelief]);
  if (input.kpis.length) texts.push(["A KPI line", input.kpis.join("\n")]);
  const out: string[] = [];
  for (const now of input.after) {
    const then = input.before.find((t) => t.id === now.id);
    const was = then ? typedPriceOf(then) : null;
    const is = typedPriceOf(now);
    if (was == null || is == null || Math.abs(is - was) < 0.005) continue;
    for (const [who, text] of texts) {
      const named = dollarFigures(text).find((f) => Math.abs(f - was) <= Math.abs(was) * 0.005);
      if (named != null) out.push(`${who} still names ${money(named)}; the trigger now reads "${sentenceOf(now)}".`);
    }
  }
  return out;
}
