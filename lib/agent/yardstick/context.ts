/**
 * A case's context: the facts a run was sent, kept as the run sent them, so
 * a replay sends the day's facts with today's instructions
 * (docs/plans/AGENT_ENGINE.md, "The yardstick"). The cutter
 * (scripts/hero-case-from-run.ts) slices them out of the run's saved request;
 * the runner (scripts/hero-case.ts) puts them back together with today's
 * record, so the record's own words, the house rules and the order are
 * today's.
 *
 * Each piece is stored under the name the agent will read it by once the
 * engine has three parts (instructions, context, the message), with the
 * block it is today beside it, so a case cut now still replays after that.
 */
import { BLOCKS, GROUP_HEADINGS } from "@/lib/agent/engine/blocks";
import { SEP, type Loaded } from "@/lib/agent/engine/engine";
import { isOwn, type AgentRecord, type BlockId, type BlockPart, type SentPartManifest } from "@/lib/agent/engine/types";
import type { PortfolioPiece } from "@/lib/agent/portfolio-block";
import { HOUSE_LINES } from "@/lib/agent/house-rules";

/** The context's names after the rebuild. */
export type ContextName =
  | "market_numbers"
  | "market_digest"
  | "portfolio"
  | "portfolio_digest"
  | "the_book"
  | "the_analysts"
  | "the_stock"
  | "stock_data"
  | "playbook_record"
  | "earnings_this_week"
  | "filings_this_week"
  | "refused_calls"
  | "last_output";

/**
 * Today's blocks that carry a run's facts, by the name each will have. A block
 * written once in code (the house rules) is never stored: the replay reads
 * today's. `regime` has no name of its own on the list: it is the market's
 * regime and what it means for a buy, so it goes with the market numbers.
 */
export const CONTEXT_NAMES: Partial<Record<BlockId, ContextName>> = {
  market_numbers: "market_numbers",
  regime: "market_numbers",
  market_digest: "market_digest",
  portfolio_snapshot: "portfolio",
  portfolio_digest: "portfolio_digest",
  watching: "the_book",
  held_beliefs: "the_book",
  watched_beliefs: "the_book",
  book_context: "the_book",
  analyst_brief: "the_analysts",
  analyst_rooms: "the_analysts",
  analyst_scope: "the_analysts",
  money_context: "the_analysts",
  stock_row: "the_stock",
  existing_thesis: "the_stock",
  stock_data: "stock_data",
  setup_record: "playbook_record",
  earnings_week: "earnings_this_week",
  filings_week: "filings_this_week",
  blocked_last_time: "refused_calls",
  last_writeup: "last_output",
  last_digest: "last_output",
  reviewer_notes: "last_output",
};

/** One fact the run was sent: its name after the rebuild, the block it is today, and its text (null: the run had none). */
export interface StoredContext {
  name: ContextName;
  block: BlockId;
  /** A part of the Market and portfolio block (a piece, under its own ### heading), not a block on its own. */
  piece: boolean;
  text: string | null;
}

/** Blocks written once in code: the replay reads today's text. */
const FIXED = new Set<BlockId>(["house_rules", "how_you_write", "date_awareness", "research_note", "thesis_claim", "earnings_triggers", "what_the_owner_reads"]);

const blockParts = (record: AgentRecord): BlockPart[] => [...record.instructions, ...record.message].filter((p): p is BlockPart => !isOwn(p));
const inGroup = (p: BlockPart) => Boolean(BLOCKS[p.block].group) && !p.alone && p.heading == null;

function nameOf(block: BlockId): ContextName {
  const name = CONTEXT_NAMES[block];
  if (!name) throw new Error(`no context name for the block ${block}: add it to CONTEXT_NAMES (lib/agent/yardstick/context.ts)`);
  return name;
}

/** The text a block was given, from what was printed: its heading (or the group's) taken off. */
function bodyOf(part: BlockPart | undefined, printed: string): string {
  const group = part && BLOCKS[part.block].group ? `${GROUP_HEADINGS[BLOCKS[part.block].group!]}${SEP}` : null;
  if (part && inGroup(part) && group && printed.startsWith(group)) return printed.slice(group.length);
  if (part?.heading != null && printed.startsWith(`${part.heading}\n`)) return printed.slice(part.heading.length + 1);
  return printed;
}

/**
 * The facts a request carried, from its text and its parts manifest, for the
 * record that built it. Every block the record lists that the request didn't
 * print is stored as null.
 */
export function contextFromParts(record: AgentRecord, sent: { instructions: string; message: string }, parts: SentPartManifest[]): StoredContext[] {
  const at: Record<string, number> = { instructions: 0, message: 0 };
  const printed = new Map<BlockId, string>();
  for (const p of parts) {
    if (p.where !== "instructions" && p.where !== "message") continue;
    const text = sent[p.where];
    at[p.where] += (p.sep ?? (at[p.where] === 0 ? "" : SEP)).length;
    if (p.kind === "block") printed.set(p.id as BlockId, text.slice(at[p.where], at[p.where] + p.chars));
    at[p.where] += p.chars;
  }
  // A block today that was the record's own text when the run was sent (the morning run's regime until #1021): found by its heading.
  for (const p of blockParts(record)) {
    if (FIXED.has(p.block) || inGroup(p) || printed.has(p.block)) continue;
    const opening = p.heading != null ? `${p.heading}\n` : OPENINGS[p.block];
    const found = opening ? byOpening(opening, [sent.instructions, sent.message], stopsOf(record)) : null;
    if (found != null) printed.set(p.block, found);
  }
  return storeAll(record, printed);
}

/**
 * The facts of a request saved before its parts were kept, for a record that
 * prints its Market and portfolio block whole and its other blocks under
 * their headings (the Portfolio Manager), its one block alone (the digest),
 * or blocks that open with their own heading (the morning run's, OPENINGS).
 * The group's parts are found by their own `### ` headings. A block runs to
 * the next heading, banner or fixed block.
 */
export function contextFromHeadings(record: AgentRecord, sent: { instructions: string; message: string }): StoredContext[] {
  const printed = new Map<BlockId, string>();
  const parts = blockParts(record);
  const texts = [sent.instructions, sent.message];
  // The record's only block, alone in its part of the request: that whole text is the block.
  for (const where of ["instructions", "message"] as const) {
    const list = where === "instructions" ? record.instructions : record.message;
    const only = list.length === 1 && !isOwn(list[0]) ? (list[0] as BlockPart) : null;
    if (only && !inGroup(only) && only.heading == null && !OPENINGS[only.block]) printed.set(only.block, sent[where]);
  }
  // The Market and portfolio block, wherever the run printed it, its parts by their own headings.
  const heading = GROUP_HEADINGS.market_and_portfolio;
  if (parts.some(inGroup)) {
    const text = texts.find((t) => t.includes(`${heading}${SEP}`));
    if (!text) throw new Error(`no "${heading}" in the saved request`);
    const after = text.slice(text.indexOf(`${heading}${SEP}`) + heading.length + SEP.length);
    const end = after.search(/\n\n(?:## |═)/);
    for (const piece of (end < 0 ? after : after.slice(0, end)).split(/\n\n(?=### )/)) {
      const id = PIECE_HEADINGS.find(([h]) => piece.startsWith(h))?.[1];
      if (!id) throw new Error(`a part of the Market and portfolio block with no known heading: ${piece.slice(0, 60)}`);
      printed.set(id, piece);
    }
  }
  for (const p of parts.filter((x) => !inGroup(x) && !FIXED.has(x.block) && !printed.has(x.block))) {
    const opening = p.heading != null ? `${p.heading}\n` : OPENINGS[p.block];
    if (!opening) throw new Error(`${record.id}: the block ${p.block} has no heading to find it by in a request saved without its parts`);
    const found = byOpening(opening, texts, stopsOf(record));
    if (found != null) printed.set(p.block, found);
  }
  return storeAll(record, printed);
}

/** What a block found by its heading stops at: the house rules and the record's own words, by their opening characters. */
const stopsOf = (record: AgentRecord) => [HOUSE_LINES, ...[...record.instructions, ...record.message].flatMap((p) => (isOwn(p) && typeof p.text === "string" ? [p.text] : []))].map((t) => t.slice(0, 40));

/** A block found by its opening line: from there to the next heading, banner, the house rules or the record's own words; null when no text has it. */
function byOpening(opening: string, texts: string[], stops: string[]): string | null {
  for (const text of texts) {
    const start = text.startsWith(opening) ? 0 : text.indexOf(`\n${opening}`) + 1;
    if (start <= 0 && !text.startsWith(opening)) continue;
    const rest = text.slice(start);
    const ends = [rest.slice(opening.length).search(/\n\n(?:## |═)/) + opening.length, ...stops.map((t) => rest.indexOf(`\n\n${t}`))].filter((i) => i >= opening.length);
    return ends.length ? rest.slice(0, Math.min(...ends)) : rest;
  }
  return null;
}

/** Blocks that open with their own heading, as the code that writes each prints it. */
export const OPENINGS: Partial<Record<BlockId, string>> = {
  analyst_brief: "## Analyst: ",
  earnings_week: "## Earnings on your book this week",
  filings_week: "## Filings on your book this week",
  regime: "## Regime and cash",
  blocked_last_time: "## Blocked last time",
};

/** The Market and portfolio block's parts, by the heading each opens with (lib/agent/portfolio-block.ts). */
const PIECE_HEADINGS: Array<[string, BlockId]> = [
  ["### Market numbers", "market_numbers"],
  ["### Market digest", "market_digest"],
  ["### Portfolio snapshot", "portfolio_snapshot"],
  ["### Watching", "watching"],
  ["### Portfolio digest", "portfolio_digest"],
];

function storeAll(record: AgentRecord, printed: Map<BlockId, string>): StoredContext[] {
  const out: StoredContext[] = [];
  for (const p of blockParts(record)) {
    if (FIXED.has(p.block) || out.some((c) => c.block === p.block)) continue;
    const text = printed.get(p.block);
    out.push({ name: nameOf(p.block), block: p.block, piece: inGroup(p), text: text == null ? null : bodyOf(p, text) });
  }
  return out;
}

/**
 * What the engine composes a replay from: the stored facts, read for today's
 * record. A block today's record lists that the case doesn't have is read as
 * none and named in `missing`, so a replay says what its case lacks.
 */
export function loadedFrom(record: AgentRecord, context: StoredContext[]): { loaded: Loaded; missing: BlockId[] } {
  const pieces: PortfolioPiece[] = [];
  const blocks: NonNullable<Loaded["blocks"]> = {};
  const missing: BlockId[] = [];
  for (const p of blockParts(record)) {
    if (FIXED.has(p.block)) continue;
    const stored = context.find((c) => c.block === p.block);
    if (!stored) missing.push(p.block);
    if (inGroup(p)) {
      if (stored?.text != null) pieces.push({ id: p.block as PortfolioPiece["id"], text: stored.text });
    } else {
      blocks[p.block] = stored?.text ?? null;
    }
  }
  return { loaded: { pieces: pieces.length ? pieces : null, blocks }, missing };
}

/** A saved request body's instructions and first message: the first system or developer message and the first user message. */
export function sentOf(body: unknown): { instructions: string; message: string } {
  const b = body as { messages?: unknown[]; input?: unknown[]; system?: unknown };
  const list = (b.messages ?? b.input ?? []) as Array<{ role: string; content: unknown }>;
  const textOf = (c: unknown): string =>
    typeof c === "string" ? c : Array.isArray(c) ? (c as Array<{ text?: string }>).map((x) => x.text ?? "").join("") : "";
  const sys = list.find((m) => m.role === "system" || m.role === "developer");
  const user = list.find((m) => m.role === "user");
  return { instructions: textOf(sys?.content ?? b.system), message: textOf(user?.content) };
}
