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
  /** The Market and portfolio block's parts, for the parts the record lists. */
  portfolioPieces?: (want: { watching: boolean; portfolioDigest: boolean }) => Promise<PortfolioPiece[]>;
  /** The Portfolio Manager's last write-up, under its heading. */
  lastWriteup?: () => Promise<string>;
}

/** The parts the agent gets from this record, as they are printed. */
interface Printed {
  manifest: Omit<SentPartManifest, "chars">;
  text: string;
}

const JOIN = "\n\n";

export async function buildAgentRequest(record: AgentRecord, input: AgentInput, sources: Sources): Promise<BuiltRequest> {
  const listed = new Set<BlockId>([...record.instructions, ...record.message].flatMap((p) => (isOwn(p) ? [] : [p.block])));
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
      let text = await blockText(part.block);
      if (text == null) continue;
      if (def.group && groupOpen !== def.group) {
        text = `${GROUP_HEADINGS[def.group]}${JOIN}${text}`;
        groupOpen = def.group;
      } else if (!def.group) groupOpen = null;
      out.push({ manifest: { id: def.id, title: def.title, kind: "block", where, source: def.source }, text });
    }
    return out;
  }

  /** A block's text, or null when it has none for this request (a part the read left out). */
  async function blockText(id: BlockId): Promise<string | null> {
    switch (id) {
      case "house_rules":
        return HOUSE_LINES;
      case "how_you_write":
        return HOW_YOU_WRITE;
      case "market_numbers":
      case "market_digest":
      case "portfolio_snapshot":
      case "watching":
      case "portfolio_digest": {
        const all = await portfolioPieces();
        // Nothing could be read: the one line stands where the first part would be.
        const unreadable = all.find((p) => p.id === "unreadable");
        if (unreadable) return firstListedOfGroup() === id ? unreadable.text : null;
        return all.find((p) => p.id === id)?.text ?? null;
      }
      case "last_writeup":
        if (!sources.lastWriteup) throw new Error(`${record.id} lists its last write-up but its run gave no way to read it`);
        return sources.lastWriteup();
    }
  }

  function firstListedOfGroup(): BlockId | undefined {
    return [...record.instructions, ...record.message].flatMap((p) => (isOwn(p) || !BLOCKS[p.block].group ? [] : [p.block]))[0];
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
