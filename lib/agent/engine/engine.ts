/**
 * The agent engine: one way to build an agent's model request, from its
 * record (docs/plans/AGENT_ENGINE.md). It loads each block the record lists,
 * puts every part in the record's order with a blank line between, and says
 * which part of the request is which, so the run can keep that with what it
 * sent and the Context panel can name each part.
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

/** The parts the agent gets from this record, as they are printed. */
interface Printed {
  manifest: Omit<SentPartManifest, "chars">;
  text: string;
}

const JOIN = "\n\n";

/** Blocks whose text is the same for every run, written once in code. */
const BUILT_IN: Partial<Record<BlockId, () => Promise<string>>> = {
  house_rules: async () => HOUSE_LINES,
  how_you_write: async () => HOW_YOU_WRITE,
};

/** A block printed inside its group (the Market and portfolio block), not on its own. */
const inGroup = (p: RecordPart): boolean => !isOwn(p) && Boolean(BLOCKS[p.block].group) && !p.alone && p.heading == null;

export async function buildAgentRequest(record: AgentRecord, input: AgentInput, sources: Sources): Promise<BuiltRequest> {
  const listed = new Set<BlockId>([...record.instructions, ...record.message].flatMap((p) => (!isOwn(p) && inGroup(p) ? [p.block] : [])));
  let pieces: Promise<PortfolioPiece[]> | null = null;
  const portfolioPieces = () => {
    if (!sources.portfolioPieces) throw new Error(`${record.id} lists a Market and portfolio block but its run gave no way to read it`);
    pieces ??= sources.portfolioPieces({ watching: listed.has("watching"), portfolioDigest: listed.has("portfolio_digest") });
    return pieces;
  };

  async function print(parts: readonly RecordPart[], where: Where): Promise<Printed[]> {
    const out: Printed[] = [];
    let groupOpen: string | null = null;
    for (const part of parts) {
      if (isOwn(part)) {
        groupOpen = null;
        out.push({ manifest: { id: part.own, title: part.title, kind: "own", where, source: `lib/agent/engine/agents (${record.id})` }, text: typeof part.text === "string" ? part.text : part.text(input) });
        continue;
      }
      const def = BLOCKS[part.block];
      if (!inGroup(part)) {
        groupOpen = null;
        const load = BUILT_IN[part.block] ?? sources.blocks?.[part.block];
        if (!load) throw new Error(`${record.id} lists the block ${part.block} but its run gave no way to read it`);
        const body = await load();
        if (body == null) continue;
        out.push({ manifest: { id: def.id, title: def.title, kind: "block", where, source: def.source }, text: part.heading != null ? `${part.heading}\n${body}` : body });
        continue;
      }
      let text = await groupText(part.block);
      if (text == null) continue;
      if (def.group && groupOpen !== def.group) {
        text = `${GROUP_HEADINGS[def.group]}${JOIN}${text}`;
        groupOpen = def.group;
      }
      out.push({ manifest: { id: def.id, title: def.title, kind: "block", where, source: def.source }, text });
    }
    return out;
  }

  /** A Market and portfolio part's text, or null when the read left it out. */
  async function groupText(id: BlockId): Promise<string | null> {
    const all = await portfolioPieces();
    // Nothing could be read: the one line stands where the first part would be.
    const unreadable = all.find((p) => p.id === "unreadable");
    if (unreadable) return firstListedOfGroup() === id ? unreadable.text : null;
    return all.find((p) => p.id === id)?.text ?? null;
  }

  function firstListedOfGroup(): BlockId | undefined {
    return [...record.instructions, ...record.message].flatMap((p) => (!isOwn(p) && inGroup(p) ? [p.block] : []))[0];
  }

  const instructions = await print(record.instructions, "instructions");
  const message = await print(record.message, "message");
  return {
    instructions: instructions.map((p) => p.text).join(JOIN),
    message: message.map((p) => p.text).join(JOIN),
    parts: [...instructions, ...message].map((p) => ({ ...p.manifest, chars: p.text.length })),
    tools: record.tools,
  };
}
