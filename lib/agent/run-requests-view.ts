/**
 * run-requests-view.ts — what the run page shows of a model call's record:
 * one piece per distinct thing the call passed in, with its size in
 * characters. The instructions, the first message, the tool menu, each
 * tool result as the model read it, and any message added along the way
 * (a nudge sent with one request only, a retry's note).
 *
 * Read from the rebuilt requests (run-requests-format.ts), in the three
 * shapes the providers take: Chat Completions (`messages`, the instructions
 * as the first message), Responses (`input`, earlier output sent back by
 * id) and Anthropic (`system` apart from `messages`). The model's own words
 * are not pieces: the thread shows them. Pure.
 */
import { decodeSteps, isObj, type RequestRecord, type SentRef } from "@/lib/agent/run-requests-format";
import { promptBlocks, type PromptBlock } from "@/lib/agent/prompt-blocks";

export type PieceKind = "instructions" | "first-message" | "tool-menu" | "added-message" | "tool-result";

export interface SentPiece {
  id: string;
  kind: PieceKind;
  label: string;
  /** The stock or search a tool result was for, when its call named one. */
  hint?: string;
  /** Characters as sent. */
  chars: number;
  /** The first request (1-based) it was in, and the last. */
  request: number;
  lastRequest: number;
  text: string;
}

export interface CallView {
  call: string;
  source: string;
  provider: string | null;
  model: string | null;
  startedAt: string;
  endedAt: string;
  error: string | null;
  requests: number;
  /** Characters of the last request as sent. */
  lastRequestChars: number;
  pieces: SentPiece[];
}

type Entry =
  | { kind: "system"; text: string }
  | { kind: "user"; text: string }
  | { kind: "result"; callId: string; text: string; byProvider?: boolean };

interface Read {
  entries: Entry[];
  calls: Map<string, { name: string; input: unknown }>;
  tools: unknown[] | null;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content.map((p) => (isObj(p) && typeof p.text === "string" ? p.text : JSON.stringify(p))).join("\n\n");
}

function readChat(body: Record<string, unknown>, out: Read): void {
  for (const m of body.messages as unknown[]) {
    if (!isObj(m)) continue;
    if (m.role === "system" || m.role === "developer") out.entries.push({ kind: "system", text: textOf(m.content) });
    else if (m.role === "user") out.entries.push({ kind: "user", text: textOf(m.content) });
    else if (m.role === "tool") out.entries.push({ kind: "result", callId: String(m.tool_call_id ?? ""), text: textOf(m.content) });
    else if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const c of m.tool_calls) {
        if (isObj(c) && isObj(c.function)) out.calls.set(String(c.id), { name: String(c.function.name ?? ""), input: c.function.arguments });
      }
    }
  }
}

function readResponses(body: Record<string, unknown>, refs: Record<string, SentRef>, out: Read): void {
  if (typeof body.instructions === "string") out.entries.push({ kind: "system", text: body.instructions });
  for (const raw of body.input as unknown[]) {
    if (!isObj(raw)) continue;
    const ref = raw.type === "item_reference" && typeof raw.id === "string" ? refs[raw.id] : undefined;
    if (ref?.type === "function_call" && ref.callId) {
      out.calls.set(ref.callId, { name: ref.name ?? "", input: ref.input });
      continue;
    }
    if (raw.role === "system" || raw.role === "developer") out.entries.push({ kind: "system", text: textOf(raw.content) });
    else if (raw.role === "user") out.entries.push({ kind: "user", text: textOf(raw.content) });
    else if (raw.type === "function_call") out.calls.set(String(raw.call_id), { name: String(raw.name ?? ""), input: raw.arguments });
    else if (raw.type === "function_call_output") out.entries.push({ kind: "result", callId: String(raw.call_id ?? ""), text: textOf(raw.output) });
  }
}

function readAnthropic(body: Record<string, unknown>, out: Read): void {
  if (body.system !== undefined) out.entries.push({ kind: "system", text: textOf(body.system) });
  for (const m of body.messages as unknown[]) {
    if (!isObj(m)) continue;
    const parts = typeof m.content === "string" ? [{ type: "text", text: m.content }] : Array.isArray(m.content) ? m.content : [];
    if (m.role === "user") {
      // One user turn can carry tool results and words (a nudge after them): kept in order.
      let words: unknown[] = [];
      const flush = () => {
        if (words.length > 0) out.entries.push({ kind: "user", text: textOf(words) });
        words = [];
      };
      for (const p of parts) {
        if (isObj(p) && p.type === "tool_result") {
          flush();
          out.entries.push({ kind: "result", callId: String(p.tool_use_id ?? ""), text: textOf(p.content) });
        } else words.push(p);
      }
      flush();
    } else if (m.role === "assistant") {
      for (const p of parts) {
        if (!isObj(p)) continue;
        if (p.type === "tool_use" || p.type === "server_tool_use") out.calls.set(String(p.id), { name: String(p.name ?? ""), input: p.input });
        // A search Anthropic ran itself: its results come back inside the model's own turn.
        else if (typeof p.type === "string" && p.type.endsWith("_tool_result") && "tool_use_id" in p)
          out.entries.push({ kind: "result", callId: String(p.tool_use_id), text: textOf(p.content), byProvider: true });
      }
    }
  }
}

function readBody(body: unknown, provider: string | null, refs: Record<string, SentRef>): Read | null {
  if (!isObj(body)) return null;
  const out: Read = { entries: [], calls: new Map(), tools: Array.isArray(body.tools) ? body.tools : null };
  if (Array.isArray(body.input)) readResponses(body, refs, out);
  else if (Array.isArray(body.messages) && (provider?.startsWith("anthropic") || "system" in body)) readAnthropic(body, out);
  else if (Array.isArray(body.messages)) readChat(body, out);
  else return null;
  return out;
}

/** The stock or search a call was for, when its input names one. */
function hintOf(input: unknown): string | undefined {
  let v = input;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return undefined;
    }
  }
  if (!isObj(v)) return undefined;
  for (const k of ["ticker", "symbol"]) if (typeof v[k] === "string" && v[k]) return v[k] as string;
  for (const k of ["tickers", "symbols"]) {
    const list = Array.isArray(v[k]) ? (v[k] as unknown[]).filter((x): x is string => typeof x === "string") : [];
    if (list.length > 0) return list.slice(0, 3).join(", ") + (list.length > 3 ? ` +${list.length - 3}` : "");
  }
  if (typeof v.query === "string" && v.query) return v.query.length > 40 ? `${v.query.slice(0, 39)}…` : v.query;
  return undefined;
}

const RANK: Record<PieceKind, number> = { instructions: 0, "first-message": 1, "tool-menu": 2, "added-message": 3, "tool-result": 3 };

/** Every distinct piece the requests passed in, in the order the model first got them. */
export function piecesOf(bodies: unknown[], provider: string | null, refs: Record<string, SentRef> = {}): SentPiece[] {
  // Pieces by kind (and call or occurrence), then by their exact text. A rebuilt request reuses the
  // one before's items, so the same string comes back and no long key is built per request.
  const buckets = new Map<string, Map<string, SentPiece>>();
  const menuText = new Map<unknown, string>();
  // Each request resends the same instructions: cut them into blocks once.
  const blocksOf = new Map<string, PromptBlock[]>();
  const made: SentPiece[] = [];
  let firstTaken = false;
  bodies.forEach((body, i) => {
    const n = i + 1;
    const read = readBody(body, provider, refs);
    if (!read) return;
    const take = (bucket: string, text: string, make: () => Omit<SentPiece, "id" | "request" | "lastRequest" | "text" | "chars">, chars = text.length) => {
      let pieces = buckets.get(bucket);
      if (!pieces) buckets.set(bucket, (pieces = new Map()));
      const had = pieces.get(text);
      if (had) {
        had.lastRequest = n;
        return;
      }
      const piece: SentPiece = { id: `p${made.length}`, ...make(), chars, text, request: n, lastRequest: n };
      pieces.set(text, piece);
      made.push(piece);
    };
    const seenWords = new Map<string, number>();
    for (const e of read.entries) {
      if (e.kind === "system") {
        // One piece per block the builders print: the instructions, the analyst's brief, the house rules, each Market part, a stock's row.
        let blocks = blocksOf.get(e.text);
        if (!blocks) blocksOf.set(e.text, (blocks = promptBlocks(e.text)));
        for (const b of blocks) take(`s:${b.label}`, b.text, () => ({ kind: "instructions", label: n === 1 ? b.label : `${b.label}, changed` }), b.chars);
      } else if (e.kind === "user") {
        const nth = (seenWords.get(e.text) ?? 0) + 1;
        seenWords.set(e.text, nth);
        take(`u:${nth}`, e.text, () => {
          const first = !firstTaken;
          firstTaken = true;
          return { kind: first ? "first-message" : "added-message", label: first ? "First message" : "Added message" };
        });
      } else {
        take(`r:${e.callId}`, e.text, () => {
          const call = read.calls.get(e.callId);
          const name = call?.name || "Tool result";
          const hint = hintOf(call?.input);
          return { kind: "tool-result", label: e.byProvider ? `${name}, run by the provider` : name, ...(hint ? { hint } : {}) };
        });
      }
    }
    if (read.tools) {
      const tools = read.tools;
      let text = menuText.get(tools);
      if (text === undefined) menuText.set(tools, (text = JSON.stringify(tools)));
      take("t", text, () => ({ kind: "tool-menu", label: `Tool menu (${tools.length} tool${tools.length === 1 ? "" : "s"})${n === 1 ? "" : ", changed"}` }));
    }
  });
  // A message that first came after the first request was added by the run's code (prepareStep): a nudge.
  for (const p of made) {
    if (p.kind !== "added-message" || p.request === 1) continue;
    p.label = p.lastRequest === p.request ? `Nudge, request ${p.request} only` : `Nudge, requests ${p.request}–${p.lastRequest}`;
  }
  return made
    .map((p, order) => ({ p, order }))
    .sort((a, b) => a.p.request - b.p.request || RANK[a.p.kind] - RANK[b.p.kind] || a.order - b.order)
    .map(({ p }) => p);
}

/** One call as the run page shows it. `refs` are every call's of the run: a retry sends the main call's output back by id. */
export function viewOfCall(record: RequestRecord, refs: Record<string, SentRef> = record.refs ?? {}): CallView {
  const bodies = decodeSteps(record);
  const last = bodies[bodies.length - 1];
  return {
    call: record.call,
    source: record.source,
    provider: record.provider,
    model: record.model,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    error: record.error ?? null,
    requests: bodies.length,
    lastRequestChars: last === undefined ? 0 : (JSON.stringify(last) ?? "").length,
    pieces: piecesOf(bodies, record.provider, refs),
  };
}

/** A stored row's record, or null when the row is not one this code wrote. */
export function parseRecord(content: string): RequestRecord | null {
  try {
    const r = JSON.parse(content) as RequestRecord;
    return isObj(r) && r.v === 1 && Array.isArray(r.steps) ? r : null;
  } catch {
    return null;
  }
}
