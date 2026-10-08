/**
 * A quiet watch woke: a review fired or is true now on a watched stock with
 * no direction and no review clock of its own. Rule: the step-6 quiet-watch
 * attachment (9e323ec9:lib/agent/playbooks/quiet-watch.ts), narrowed to a
 * review (QB ruling, 2026-10-07).
 */
import { firstFlag, itemsFor, stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

export const quietWatchWoke: SituationDefinition<"QUIET_WATCH_WOKE"> = {
  code: "QUIET_WATCH_WOKE",
  order: 8,
  appliesTo: "watched",
  entry: "full",
  guidance: "",
  lists: () => true,
  rule: (stock, book, now) => {
    const items = itemsFor(stockFacts(stock, book, now), "QUIET_WATCH_WOKE");
    if (items.length === 0) return { active: false };
    return { active: true, data: { flag: firstFlag(items), fires: items.map((i) => i.ref) } };
  },
};
