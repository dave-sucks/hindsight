/**
 * claim-names-level.ts — the one sentence a save adds when it moves a level
 * the claim still names (step 12, part 1).
 *
 * MU, 2026-09-23: the morning run raised the floor $969 → $1,041 and "MU
 * closes below the $969 stop-loss" stayed in what-proves-it-wrong; by 10-09
 * the floor was $1,005 and the line still said $969. Information, never a
 * refusal: the claim is the writer's and the owner's to fix, the save only
 * says it has gone stale. A dollar figure counts when it sits within 0.5% of
 * the level's old value; sizes ($22B, $50M) and percentages are not levels.
 */

export type PlanLevels = { entryPrice: number | null; targetPrice: number | null; stopLoss: number | null };

const SLOTS: Array<[keyof PlanLevels, string]> = [
  ["entryPrice", "the buy level"],
  ["targetPrice", "the target"],
  ["stopLoss", "the floor"],
];

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
 * One sentence per moved level the claim still names: "Your what-proves-it-
 * wrong line still names $969; the floor is now $1,041." Empty when no level
 * moved, or the claim names none of the old numbers.
 */
export function claimNamesOldLevel(input: {
  before: PlanLevels;
  after: PlanLevels;
  coreBelief: string | null;
  invalidationConds: string[];
}): string[] {
  const texts: Array<[string, string]> = [];
  if (input.coreBelief?.trim()) texts.push(["Your belief", input.coreBelief]);
  if (input.invalidationConds.length) texts.push(["Your what-proves-it-wrong line", input.invalidationConds.join("\n")]);
  const out: string[] = [];
  for (const [slot, name] of SLOTS) {
    const was = input.before[slot];
    const now = input.after[slot];
    if (was == null || now == null || Math.abs(now - was) < 0.005) continue;
    for (const [who, text] of texts) {
      const named = dollarFigures(text).find((f) => Math.abs(f - was) <= Math.abs(was) * 0.005);
      if (named != null) out.push(`${who} still names ${money(named)}; ${name} is now ${money(now)}.`);
    }
  }
  return out;
}
