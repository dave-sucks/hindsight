/**
 * A playbook: what to do in one situation, written once, attached only when
 * code finds the situation (docs/plans/AGENT_ARCHITECTURE.md, 10.1, 10.4).
 * Its text has five parts in order: when it applies, the questions to answer,
 * what you can do, what counts as answered, the known mistakes.
 */
import type { StockRow } from "@/lib/agent/stock-brief";

export interface Playbook {
  /** The name a row and a read carry it by. */
  key: string;
  /** Its size limit in characters; the size test holds it. */
  cap: number;
  text: string;
  /** Whether a stock's row in the morning or chat read carries it. */
  appliesToRow: (row: StockRow) => boolean;
  /** Whether a trigger run carries it, from what fired. */
  appliesToFire: (fire: { action: string; held: boolean }) => boolean;
}
