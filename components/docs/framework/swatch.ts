/**
 * The color of each part of a request to the model: the Framework page draws
 * an agent's parts with these, the docs' context chips wear them, and a run's
 * Context panel colors what it sent with them. An agent's own words are one
 * color, each kind of block from the library another (`swatchOf`), its tools
 * a third. Situations, sent only when the stock is in one, are outlined.
 */
import type { CSSProperties } from "react";
import type { BlockDef } from "@/lib/agent/engine/blocks";
import type { BlockId } from "@/lib/agent/engine/types";

export type PartId = "job" | "house" | "analyst" | "portfolio" | "tools" | "read" | "guidance";

export const SWATCH: Record<PartId, { className: string; style?: CSSProperties }> = {
  job: { className: "bg-foreground/70" },
  house: { className: "bg-sky-400" },
  analyst: { className: "bg-violet-400" },
  portfolio: { className: "bg-amber-400" },
  tools: { className: "bg-brand" },
  read: { className: "bg-blue-500" },
  guidance: { className: "border border-dashed border-muted-foreground bg-muted-foreground/35" },
};

/** The blocks that aren't about the stock or the run: the rules every agent shares, the analyst it works for, the stock's situations. */
const BLOCK_SWATCH: Partial<Record<BlockId, PartId>> = {
  house_rules: "house",
  how_you_write: "house",
  analyst_brief: "analyst",
  playbooks: "analyst",
  setup_record: "analyst",
  money_context: "analyst",
  book_context: "analyst",
  analyst_rooms: "analyst",
  situations: "guidance",
};

/** A library block's color: the Market and portfolio group's, the kind above, or the stock and the run's. */
export const swatchOf = (block: Pick<BlockDef, "id" | "group">): PartId => (block.group ? "portfolio" : (BLOCK_SWATCH[block.id] ?? "read"));
