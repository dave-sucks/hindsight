/**
 * The agent engine: one way to build an agent's model request, from its
 * record (docs/plans/AGENT_ENGINE.md). It takes each block the record lists,
 * puts every part in the record's order, each after its separator (a blank
 * line unless the record says otherwise), and says which part of the request
 * is which, so the run can keep that with what it sent and the Context panel
 * can name each part.
 *
 * A block's text comes from the code that already wrote it (the house rules,
 * the Market and portfolio block's parts, the agent's own data); the engine
 * adds no text of its own.
 */
import { HOUSE_LINES, HOW_YOU_WRITE } from "@/lib/agent/house-rules";
import type { PortfolioPiece } from "@/lib/agent/portfolio-block";
import { BLOCKS, GROUP_HEADINGS } from "./blocks";
import { isOwn, type AgentInput, type AgentRecord, type BlockId, type BuiltRequest, type RecordPart, type SentPartManifest, type Where } from "./types";

/** Where the blocks that read live data get it, handed in by the run. */
export interface Sources {
  /** The Market and portfolio block's parts, for the parts the record lists inside it. */
  portfolioPieces?: (want: { watching: boolean; portfolioDigest: boolean }) => Promise<PortfolioPiece[]>;
  /** A block printed on its own: its text for this run, without its heading (null: none this run). */
  blocks?: Partial<Record<BlockId, () => Promise<string | null>>>;
}

/** Every block's text for one request, already read. */
export interface Loaded {
  /** The Market and portfolio block's parts; null when the run has none. */
  pieces?: PortfolioPiece[] | null;
  /** Each block printed on its own, without its heading (null: none this run). */
  blocks?: Partial<Record<BlockId, string | null>>;
}

/** The separator before a part when the record names none: a blank line. */
export const SEP = "\n\n";

/** Blocks whose text is the same for every run, written once in code. */
const BUILT_IN: Partial<Record<BlockId, string>> = {
  house_rules: HOUSE_LINES,
  how_you_write: HOW_YOU_WRITE,
};

/** A block printed inside its group (the Market and portfolio block), not on its own. */
const inGroup = (p: RecordPart): boolean => !isOwn(p) && Boolean(BLOCKS[p.block].group) && !p.alone && p.heading == null;

const allParts = (record: AgentRecord) => [...record.instructions, ...record.message];

/** Read every block the record lists, then build the request. */
export async function buildAgentRequest(record: AgentRecord, input: AgentInput, sources: Sources): Promise<BuiltRequest> {
  const grouped = new Set<BlockId>(allParts(record).flatMap((p) => (!isOwn(p) && inGroup(p) ? [p.block] : [])));
  let pieces: PortfolioPiece[] | null = null;
  if (grouped.size) {
    if (!sources.portfolioPieces) throw new Error(`${record.id} lists a Market and portfolio block but its run gave no way to read it`);
    pieces = await sources.portfolioPieces({ watching: grouped.has("watching"), portfolioDigest: grouped.has("portfolio_digest") });
  }
  const blocks: Partial<Record<BlockId, string | null>> = {};
  for (const p of allParts(record)) {
    if (isOwn(p) || inGroup(p) || BUILT_IN[p.block] != null || p.block in blocks) continue;
    const load = sources.blocks?.[p.block];
    if (!load) throw new Error(`${record.id} lists the block ${p.block} but its run gave no way to read it`);
    blocks[p.block] = await load();
  }
  return composeAgentRequest(record, input, { pieces, blocks });
}

/** Build the request from blocks already read. */
export function composeAgentRequest(record: AgentRecord, input: AgentInput, loaded: Loaded): BuiltRequest {
  const firstOfGroup = allParts(record).flatMap((p) => (!isOwn(p) && inGroup(p) ? [p.block] : []))[0];

  /** A Market and portfolio part's text, or null when the read left it out. */
  function groupText(id: BlockId): string | null {
    const all = loaded.pieces;
    if (!all) return null;
    // Nothing could be read: the one line stands where the first part would be.
    const unreadable = all.find((p) => p.id === "unreadable");
    if (unreadable) return firstOfGroup === id ? unreadable.text : null;
    return all.find((p) => p.id === id)?.text ?? null;
  }

  function print(parts: readonly RecordPart[], where: Where): Array<{ manifest: SentPartManifest; text: string }> {
    const out: Array<{ manifest: SentPartManifest; text: string }> = [];
    let groupOpen: string | null = null;
    const push = (m: Omit<SentPartManifest, "chars" | "sep">, sep: string | undefined, text: string) =>
      out.push({ manifest: { ...m, sep: out.length ? (sep ?? SEP) : "", chars: text.length }, text });
    for (const part of parts) {
      if (isOwn(part)) {
        groupOpen = null;
        const text = typeof part.text === "string" ? part.text : part.text(input);
        if (text == null) continue;
        push({ id: part.own, title: part.title, kind: "own", where, source: `lib/agent/engine/agents (${record.id})` }, part.sep, text);
        continue;
      }
      const def = BLOCKS[part.block];
      const manifest = { id: def.id, title: def.title, kind: "block" as const, where, source: def.source };
      if (!inGroup(part)) {
        groupOpen = null;
        const body = BUILT_IN[part.block] ?? loaded.blocks?.[part.block];
        if (body === undefined) throw new Error(`${record.id} lists the block ${part.block} but it wasn't read`);
        if (body == null) continue;
        push(manifest, part.sep, part.heading != null ? `${part.heading}\n${body}` : body);
        continue;
      }
      let text = groupText(part.block);
      if (text == null) continue;
      if (def.group && groupOpen !== def.group) {
        text = `${GROUP_HEADINGS[def.group]}${SEP}${text}`;
        groupOpen = def.group;
      }
      push(manifest, part.sep, text);
    }
    return out;
  }

  const instructions = print(record.instructions, "instructions");
  const message = print(record.message, "message");
  const join = (ps: typeof instructions) => ps.map((p) => p.manifest.sep + p.text).join("");
  return {
    instructions: join(instructions),
    message: join(message),
    parts: [...instructions, ...message].map((p) => p.manifest),
    tools: record.tools,
  };
}
