/**
 * A held stock, or a watched one with a buy price, with no setup named.
 * Rule: setup-checklist.ts `nameTheSetup`.
 */
import { nameTheSetup } from "@/lib/agent/knowledge/setup-checklist";
import type { SituationDefinition } from "./types";

export const noSetupNamed: SituationDefinition<"NO_SETUP_NAMED"> = {
  code: "NO_SETUP_NAMED",
  order: 16,
  appliesTo: "both",
  entry: "full",
  guidance: "",
  rule: (stock, book) => {
    const ask = nameTheSetup(
      { setupId: stock.setupId ?? null, status: stock.work.thesis.status ?? null, entryPrice: stock.entryPrice ?? null },
      stock.setupChoices ?? null,
      book.setupOverrides,
    );
    return ask ? { active: true, data: ask } : { active: false };
  },
};
