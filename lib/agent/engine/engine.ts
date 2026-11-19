/**
 * The agent engine: one way to build an agent's model request from its
 * record (docs/plans/AGENT_ENGINE.md). An agent is its instructions, its
 * context and its tools.
 *
 * - The instructions: its instruction files (lib/agent/engine/agents/*.md:
 *   its own and the shared ones it uses) and the facts its record places
 *   among them (the analyst, the playbooks, the stock's situations), in the
 *   record's order.
 * - The first message: the date line, then each read and the message (the
 *   run's task as whoever started it wrote it) in the order the record
 *   lists them. In a conversation the date line and the reads ride on each
 *   new message.
 *
 * The facts are read by their loaders (lib/agent/context/), for the run's
 * subject, before the request is put together (./build.ts).
 *
 * Each part is put in a blank line after the one before, and the request
 * says which part is which, so the run can keep that with what it sent and
 * the Context panel can name each part. The engine writes one text of its
 * own, the date line; every other text comes from the code that writes it.
 */
import type { PortfolioPiece, PortfolioPieceId } from "@/lib/agent/portfolio-block";
import { instructionSections } from "./instructions";
import { CONTEXT, DATE_LINE, GROUP_HEADINGS } from "./parts";
import { isFile, type AgentInput, type AgentRecord, type BuiltNewest, type BuiltRequest, type ContextId, type SentPartManifest, type Where } from "./types";

/** Every text for one request, already read. */
export interface Loaded {
  /** The Market and portfolio reads, from their one loader (lib/agent/portfolio-block.ts); null when the run has none. */
  pieces?: PortfolioPiece[] | null;
  /** Every other fact: its text for this run (null: none this run). */
  context?: Partial<Record<ContextId, string | null>>;
}

/** Between two parts: a blank line. */
export const SEP = "\n\n";

/** The Market and portfolio reads, and the part of their loader each one is. */
const PIECE_OF: Partial<Record<ContextId, PortfolioPieceId>> = {
  market_numbers: "market_numbers",
  market_digest: "market_digest",
  portfolio: "portfolio_snapshot",
  portfolio_digest: "portfolio_digest",
};
const isPiece = (id: ContextId) => PIECE_OF[id] != null;

/** The line every first message opens with: the date and time in New York, and the account. */
export function dateLine(now: Date, environment: "PAPER" | "LIVE"): string {
  const day = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return `${day}, ${time} ET, the ${environment} account.`;
}

/** Build the request from texts already read: the instruction files and the facts placed among them, then the first message. */
export function composeAgentRequest(record: AgentRecord, input: AgentInput, loaded: Loaded): BuiltRequest {
  const instructions = new Printer("instructions");
  for (const e of record.instructions) {
    if (isFile(e)) {
      // Its one document, its imports inlined, and where each starts.
      const sections = instructionSections(e);
      instructions.push(
        { id: e, title: `Its instructions (${e})`, kind: "own", source: `lib/agent/engine/agents/${e}`, ...(sections.length > 1 ? { sections: sections.map((x) => ({ label: x.label, chars: x.text.length })) } : {}) },
        sections.map((x) => x.text).join(""),
      );
      continue;
    }
    const text = loaded.context?.[e];
    if (text === undefined) throw new Error(`${record.id} reads ${e} but it wasn't read`);
    if (text != null) instructions.push({ id: e, title: CONTEXT[e].title, kind: "context", source: CONTEXT[e].source }, text);
  }
  if (record.conversation) return { agent: record.id, instructions: instructions.text, message: "", parts: instructions.parts, tools: record.tools };

  const message = new Printer("message");
  printFirst(record, input, loaded, (m, text) => message.push(m, text));
  return { agent: record.id, instructions: instructions.text, message: message.text, parts: [...instructions.parts, ...message.parts], tools: record.tools };
}

/**
 * What rides on a conversation's newest message: the date line, then each
 * read, each its own text, the Market and portfolio reads one text. Its parts
 * are named as if the texts were joined by a blank line, the way the run's
 * Context panel reads a message.
 */
export function composeNewest(record: AgentRecord, input: AgentInput, loaded: Loaded): BuiltNewest {
  if (!record.conversation) throw new Error(`${record.id} is not a conversation`);
  const texts: string[] = [];
  const parts: SentPartManifest[] = [];
  printFirst(record, input, loaded, (m, text, continuesGroup) => {
    parts.push({ ...m, where: "newest", sep: parts.length ? SEP : "", chars: text.length });
    if (continuesGroup && texts.length) texts[texts.length - 1] += SEP + text;
    else texts.push(text);
  });
  return { agent: record.id, texts, parts };
}

/**
 * What the run page shows as the run's opening: the message, the run's task
 * as whoever started it wrote it. Never the reads: the Context panel shows
 * those part by part.
 */
export function openingOf(built: BuiltRequest): string {
  let at = 0;
  for (const p of built.parts.filter((x) => x.where === "message")) {
    at += (p.sep ?? "").length;
    if (p.kind === "message") return built.message.slice(at, at + p.chars);
    at += p.chars;
  }
  return "";
}

type PartHead = Omit<SentPartManifest, "where" | "chars" | "sep">;

/**
 * The date line, then each read and the message in the record's order, the
 * Market and portfolio reads under their one heading.
 */
function printFirst(record: AgentRecord, input: AgentInput, loaded: Loaded, put: (m: PartHead, text: string, continuesGroup: boolean) => void): void {
  put({ id: "line", ...DATE_LINE, kind: "line" }, dateLine(input.now, input.environment), false);
  const pieces = loaded.pieces ?? null;
  const unreadable = pieces?.find((p) => p.id === "unreadable") ?? null;
  const firstPiece = record.context.find((c): c is ContextId => c !== "message" && isPiece(c));
  let groupOpen: string | null = null;
  for (const id of record.context) {
    if (id === "message") {
      groupOpen = null;
      if (input.message?.trim()) put({ id: "message", title: "The message", kind: "message", source: record.messageFrom }, input.message.trim(), false);
      continue;
    }
    const def = CONTEXT[id];
    const m: PartHead = { id, title: def.title, kind: "context", source: def.source };
    if (!isPiece(id)) {
      groupOpen = null;
      const text = loaded.context?.[id];
      if (text === undefined) throw new Error(`${record.id} reads ${id} but it wasn't read`);
      if (text != null) put(m, text, false);
      continue;
    }
    // Nothing could be read: the one line stands where the first read would be.
    let text = unreadable ? (id === firstPiece ? unreadable.text : null) : (pieces?.find((p) => p.id === PIECE_OF[id])?.text ?? null);
    if (text == null) continue;
    const continuesGroup = groupOpen === def.group;
    if (def.group && !continuesGroup) {
      text = `${GROUP_HEADINGS[def.group]}${SEP}${text}`;
      groupOpen = def.group;
    }
    put(m, text, continuesGroup);
  }
}

/** Parts joined by a blank line, each one named. */
class Printer {
  text = "";
  parts: SentPartManifest[] = [];
  constructor(private where: Where) {}
  push(m: PartHead, text: string) {
    const sep = this.parts.length ? SEP : "";
    this.parts.push({ ...m, where: this.where, sep, chars: text.length });
    this.text += sep + text;
  }
}
