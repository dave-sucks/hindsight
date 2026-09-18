import { setupsForAnalyst, type Setup } from "@/lib/agent/knowledge/setups";

/** An analyst's setups by id, for decision replays. */
export const setupsFor = (ids: string[]): Setup[] => setupsForAnalyst(ids);
