/**
 * The playbooks, in the order the code ranks their situations
 * (needs-action.ts), and how they attach:
 *
 *  - a stock's row names the keys that apply to it (`playbooksForRow`), and
 *    the read carries each playbook's text once (`playbookTexts`);
 *  - a trigger run carries the one for what fired (`playbookForFire`).
 */
import type { StockRow } from "@/lib/agent/stock-brief";
import type { Playbook } from "./types";
import { protectiveSale } from "./protective-sale";
import { buyArrives } from "./buy-arrives";
import { addOrWinner } from "./add-or-winner";
import { earnings } from "./earnings";
import { filings } from "./filings";
import { protection } from "./protection";
import { staleResearch } from "./stale-research";
import { planProblems } from "./plan-problems";
import { quietWatch } from "./quiet-watch";
import { firstResearch } from "./first-research";

export type { Playbook } from "./types";

export const PLAYBOOKS: readonly Playbook[] = [protectiveSale, buyArrives, addOrWinner, earnings, filings, protection, staleResearch, planProblems, quietWatch, firstResearch];

export function playbooksForRow(row: StockRow): string[] {
  return PLAYBOOKS.filter((p) => p.appliesToRow(row)).map((p) => p.key);
}

/** The playbooks for what fired, in ranking order. */
export function playbooksForFire(fire: { action: string; held: boolean; predicate?: unknown }): Playbook[] {
  return PLAYBOOKS.filter((p) => p.appliesToFire(fire));
}

/** The first playbook for what fired. */
export function playbookForFire(fire: { action: string; held: boolean; predicate?: unknown }): Playbook | null {
  return playbooksForFire(fire)[0] ?? null;
}

/** Each named playbook's text, once, in ranking order. */
export function playbookTexts(keys: Iterable<string>): Record<string, string> {
  const wanted = new Set(keys);
  return Object.fromEntries(PLAYBOOKS.filter((p) => wanted.has(p.key)).map((p) => [p.key, p.text]));
}
