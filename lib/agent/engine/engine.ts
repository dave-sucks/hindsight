/**
 * The agent engine: one way to build an agent's model request from its
 * record (docs/plans/AGENT_ENGINE.md). An agent is its instructions, its
 * context and its tools.
 *
 * - The instructions: its own text and the shared texts it uses, in the
 *   record's order; when its context has the stock, the stock's situations
 *   end them.
 * - The first message: the date line, then each read and the message (the
 *   run's task as whoever started it wrote it) in the order the record
 *   lists them. In a conversation the date line and the reads ride on each
 *   new message.
 *
 * Each part is put in a blank line after the one before, and the request
 * says which part is which, so the run can keep that with what it sent and
 * the Context panel can name each part. The engine writes one text of its
 * own, the date line; every other text comes from the code that writes it.
 */
import { HOUSE_LINES, HOW_YOU_WRITE } from "@/lib/agent/house-rules";
import { RESEARCH_RULES } from "@/lib/agent/thesis-research/writer-rules";
import type { PortfolioPiece, PortfolioPieceId } from "@/lib/agent/portfolio-block";
import { CONTEXT, DATE_LINE, GROUP_HEADINGS, SHARED, SITUATIONS_PART } from "./parts";
import { isOwnPart, readsOf, type AgentInput, type AgentRecord, type BuiltNewest, type BuiltRequest, type ContextId, type SentPartManifest, type SharedId, type Where } from "./types";

/** The shared texts a run reads (the rest are the same on every run, written once in code). */
export type RunShared = "the_analyst" | "playbooks";

/** Every text for one request, already read. */
export interface Loaded {
  /** The analyst and its playbooks for this run (null: none this run). */
  shared?: Partial<Record<RunShared, string | null>>;
  /** The stock's situations and what each asks (null or absent: none). Given only to an agent whose context has the stock. */
  situations?: string | null;
  /** The Market and portfolio reads, from their one loader (lib/agent/portfolio-block.ts); null when the run has none. */
  pieces?: PortfolioPiece[] | null;
  /** Every other read: its text for this run (null: none this run). */
  context?: Partial<Record<ContextId, string | null>>;
}

/** Where the texts that change by run come from, handed in by the run. */
export interface Sources {
  /** The Market and portfolio reads; `portfolioDigest` is false when the agent doesn't get the 8 PM digest. */
  portfolioPieces?: (want: { portfolioDigest: boolean }) => Promise<PortfolioPiece[]>;
  shared?: Partial<Record<RunShared, () => Promise<string | null>>>;
  situations?: () => Promise<string | null>;
  context?: Partial<Record<ContextId, () => Promise<string | null>>>;
}

/** Between two parts: a blank line. */
export const SEP = "\n\n";

/** The shared texts that are the same on every run. */
const FIXED: Partial<Record<SharedId, string>> = {
  house_rules: HOUSE_LINES,
  how_you_write: HOW_YOU_WRITE,
  research_rules: RESEARCH_RULES,
};

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

/** Read every text the record needs, then build the request. */
export async function buildAgentRequest(record: AgentRecord, input: AgentInput, sources: Sources): Promise<BuiltRequest> {
  const loaded: Loaded = { shared: {}, context: {} };
  if (readsOf(record).some(isPiece)) {
    if (!sources.portfolioPieces) throw new Error(`${record.id} reads the Market and portfolio context but its run gave no way to read it`);
    loaded.pieces = await sources.portfolioPieces({ portfolioDigest: record.context.includes("portfolio_digest") });
  }
  for (const p of record.instructions) {
    if (isOwnPart(p) || FIXED[p] != null) continue;
    const load = sources.shared?.[p as RunShared];
    if (!load) throw new Error(`${record.id} uses the shared text ${p} but its run gave no way to read it`);
    loaded.shared![p as RunShared] = await load();
  }
  for (const id of readsOf(record)) {
    if (isPiece(id)) continue;
    const load = sources.context?.[id];
    if (!load) throw new Error(`${record.id} reads ${id} but its run gave no way to read it`);
    loaded.context![id] = await load();
  }
  if (sources.situations) loaded.situations = await sources.situations();
  return composeAgentRequest(record, input, loaded);
}

/** Build the request from texts already read. */
export function composeAgentRequest(record: AgentRecord, input: AgentInput, loaded: Loaded): BuiltRequest {
  const instructions = new Printer("instructions");
  for (const p of record.instructions) {
    if (isOwnPart(p)) {
      instructions.push({ id: "own", title: "Its own text", kind: "own", source: `lib/agent/engine/agents (${record.id})` }, p.own);
      continue;
    }
    const text = FIXED[p] ?? loaded.shared?.[p as RunShared];
    if (text === undefined) throw new Error(`${record.id} uses the shared text ${p} but it wasn't read`);
    if (text != null) instructions.push({ id: p, title: SHARED[p].title, kind: "shared", source: SHARED[p].source }, text);
  }
  if (loaded.situations) {
    if (!record.context.includes("the_stock")) throw new Error(`${record.id} was given a stock's situations but its context has no stock`);
    instructions.push({ id: "situations", ...SITUATIONS_PART, kind: "situations" }, loaded.situations);
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
  const firstPiece = readsOf(record).find(isPiece);
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
