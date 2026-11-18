/**
 * The color of each part of a request to the model: the Framework page draws
 * an agent's parts with these, the docs' context chips wear them, and a run's
 * Context panel colors what it sent with them. An agent's own text is one
 * color, the shared texts by kind (the house's, the analyst's), the reads
 * (the Market and portfolio reads their own), the message, and its tools.
 * Situations, sent only when the stock is in one, are outlined.
 */
import type { CSSProperties } from "react";
import { CONTEXT } from "@/lib/agent/engine/parts";
import type { ContextId, PartKind } from "@/lib/agent/engine/types";

export type PartId = "job" | "house" | "analyst" | "portfolio" | "tools" | "read" | "message" | "guidance";

export const SWATCH: Record<PartId, { className: string; style?: CSSProperties }> = {
  job: { className: "bg-foreground/70" },
  house: { className: "bg-sky-400" },
  analyst: { className: "bg-violet-400" },
  portfolio: { className: "bg-amber-400" },
  tools: { className: "bg-brand" },
  read: { className: "bg-blue-500" },
  message: { className: "bg-emerald-400" },
  guidance: { className: "border border-dashed border-muted-foreground bg-muted-foreground/35" },
};

/** A part's color, by what it is: the agent's own text, a shared text, a read, the date line, the message, the situations. */
export function swatchOf(p: { kind: PartKind; id: string }): PartId {
  if (p.kind === "own") return "job";
  if (p.kind === "situations") return "guidance";
  if (p.kind === "message") return "message";
  if (p.kind === "shared") return p.id === "the_analyst" || p.id === "playbooks" ? "analyst" : "house";
  if (p.kind === "context") return CONTEXT[p.id as ContextId]?.group ? "portfolio" : p.id === "playbook_record" ? "analyst" : "read";
  // A request kept before the three parts named its parts "block": colored by what they were.
  if ((p.kind as string) === "block") return OLD_BLOCKS[p.id] ?? "read";
  return "read";
}

const OLD_BLOCKS: Record<string, PartId> = {
  house_rules: "house", market_block_rule: "house", how_you_write: "house",
  analyst_brief: "analyst", playbooks: "analyst", setup_record: "analyst",
  market_numbers: "portfolio", market_digest: "portfolio", portfolio_snapshot: "portfolio", watching: "portfolio", portfolio_digest: "portfolio",
  situations: "guidance",
};
