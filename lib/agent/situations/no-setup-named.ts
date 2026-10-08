/**
 * A held stock, or a watched one with a buy price, with no setup named.
 * Rule: `nameTheSetup` (moved from knowledge/setup-checklist.ts).
 */
import { isNamedSetup, setupsForAnalyst, NO_SETUP_FITS } from "@/lib/agent/knowledge/setups";
import type { SetupOverrides } from "@/lib/agent/knowledge/setup-overrides";
import type { SituationDefinition } from "./types";

/** What a row with no setup carries instead: the ask, and the seat's choices. */
export interface NameTheSetup {
  ask: string;
  choose: { id: string; name: string; when: string }[];
}

/**
 * A held stock, or a watched one with a buy price, written before setups
 * were named (DAV-285: 29 of 32 on 2026-09-17). Everything setup-aware skips
 * it — the tactical run's confirmation, the exits a buy writes, the held
 * checklist, the scorecard — until a review names one. Null when the row has
 * a setup, when a review already said none fits, or when there is no plan
 * to name a setup for.
 */
export function nameTheSetup(
  row: { setupId: string | null | undefined; status: string | null; entryPrice: unknown },
  /** The analyst's own setups (`AgentConfig.setupIds`); none chosen = the whole catalog. */
  analystSetupIds: readonly string[] | null | undefined,
  overrides?: SetupOverrides,
): NameTheSetup | null {
  if (isNamedSetup(row.setupId) || row.setupId === NO_SETUP_FITS) return null;
  const held = row.status === "HOLDING";
  if (!held && !(row.status === "WATCHING" && row.entryPrice != null)) return null;
  return {
    ask: held
      ? `This stock has no setup named. On this review, name the one it was bought on from the chart and the thesis: update_thesis(setup_id). That also writes the setup's own exits onto the stock. If none fits, setup_id "NONE" and say why in the rationale.`
      : `This plan has no setup named. On this review, name the one its buy price is written on: update_thesis(setup_id). If none fits, setup_id "NONE" and say why in the rationale.`,
    choose: setupsForAnalyst(analystSetupIds, overrides).map((s) => ({ id: s.id, name: s.name, when: s.summary })),
  };
}

export const noSetupNamed: SituationDefinition<"NO_SETUP_NAMED"> = {
  code: "NO_SETUP_NAMED",
  order: 16,
  appliesTo: "both",
  entry: "full",
  guidance: "",
  lists: () => true,
  rule: (stock, book) => {
    const ask = nameTheSetup(
      { setupId: stock.setupId ?? null, status: stock.work.thesis.status ?? null, entryPrice: stock.entryPrice ?? null },
      stock.setupChoices ?? null,
      book.setupOverrides,
    );
    return ask ? { active: true, data: ask } : { active: false };
  },
};
