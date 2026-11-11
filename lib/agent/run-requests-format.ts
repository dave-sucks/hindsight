/**
 * run-requests-format.ts — how a model call's requests are kept, and read
 * back exactly.
 *
 * A request is the body the AI SDK sent the provider (`step.request.body`),
 * which is the body that went over the wire: the instructions, the tool
 * menu, every message, every tool result in the model's version, and any
 * message added for one step only. Each step of a call resends the whole
 * conversation, so a step is kept as its difference from the step before:
 * how many conversation items it shares with that step from the start, the
 * items after them, and any other key whose value changed. Rebuilt in order,
 * every step comes back as the same JSON that was sent, and a call's record
 * is about one full request in size.
 *
 * The Responses API (the trigger run) sends the model's earlier output back
 * by id (`{ type: "item_reference", id }`); OpenAI holds the item. Each
 * step's own reply is kept by those ids (`refs`) so a screen can show what
 * a reference stood for. Pure: no database, no SDK.
 */

/** One request, kept as its difference from the request before it. */
export interface SentStep {
  /** The body's keys in order, when they differ from the request before (always on the first). */
  keys?: string[];
  /** Keys whose value differs from the request before (every key on the first), the conversation aside. */
  set?: Record<string, unknown>;
  /** Conversation items shared with the request before, from the start. */
  keep?: number;
  /** The conversation items after them. */
  add?: unknown[];
  /** A body that was not a JSON object, kept as it came. */
  raw?: unknown;
  /** The SDK handed over no body for this request. */
  missing?: true;
}

/** What the model wrote, under the item id the Responses API sends back in its place. */
export interface SentRef {
  /** The request (1-based) whose reply it was. */
  request: number;
  type: "reasoning" | "function_call" | "message";
  text?: string;
  name?: string;
  callId?: string;
  input?: unknown;
}

/** One model call of a run: every request it sent, in order. */
export interface RequestRecord {
  v: 1;
  /** Which call of the run: "Main", "Retry", "Recovery"… */
  call: string;
  /** The code that made it: "morning-research", "tactical-run"… */
  source: string;
  /** The SDK's provider id: "openai.chat", "openai.responses", "anthropic.messages". */
  provider: string | null;
  model: string | null;
  /** The body key that holds the conversation: "messages" or "input". */
  list: string | null;
  startedAt: string;
  endedAt: string;
  steps: SentStep[];
  refs?: Record<string, SentRef>;
  /** Why the call ended early. The request it was waiting on then is not in `steps`. */
  error?: string;
}

type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The key that carries the conversation in this body, if any. */
export function listKeyOf(body: unknown): string | null {
  if (!isObj(body)) return null;
  if (Array.isArray(body.messages)) return "messages";
  if (Array.isArray(body.input)) return "input";
  return null;
}

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** Turns each request of a call into its difference from the one before, as the requests come. */
export class RequestEncoder {
  readonly steps: SentStep[] = [];
  list: string | null = null;
  private prev: Obj | null = null;
  private prevItems: string[] = [];
  /** Characters of the newest request as sent. */
  lastChars = 0;

  get count(): number {
    return this.steps.length;
  }

  push(body: unknown): void {
    if (body === undefined) {
      this.steps.push({ missing: true });
      this.prev = null;
      this.prevItems = [];
      return;
    }
    // The wire form: what JSON.stringify sent (keys holding undefined are not on the wire).
    const wire = typeof body === "string" ? body : JSON.stringify(body);
    this.lastChars = wire?.length ?? 0;
    const sent: unknown = typeof body === "string" ? body : JSON.parse(wire);
    if (!isObj(sent)) {
      this.steps.push({ raw: sent });
      this.prev = null;
      this.prevItems = [];
      return;
    }
    if (this.list === null && this.steps.every((s) => s.missing || "raw" in s)) this.list = listKeyOf(sent);
    const list = this.list;
    const step: SentStep = {};
    const keys = Object.keys(sent);
    const prev = this.prev;
    if (!prev || !sameKeys(keys, Object.keys(prev))) step.keys = keys;
    const items = list && Array.isArray(sent[list]) ? (sent[list] as unknown[]) : null;
    const set: Obj = {};
    for (const k of keys) {
      if (k === list && items) continue;
      if (!prev || !(k in prev) || JSON.stringify(prev[k]) !== JSON.stringify(sent[k])) set[k] = sent[k];
    }
    if (Object.keys(set).length > 0) step.set = set;
    let itemJson: string[] = [];
    if (items) {
      itemJson = items.map((i) => JSON.stringify(i));
      const before = prev && list && Array.isArray(prev[list]) ? this.prevItems : [];
      let keep = 0;
      while (keep < before.length && keep < itemJson.length && before[keep] === itemJson[keep]) keep++;
      step.keep = keep;
      if (items.length > keep) step.add = items.slice(keep);
    }
    this.steps.push(step);
    this.prev = sent;
    this.prevItems = itemJson;
  }
}

/** Every request of a call, rebuilt as sent. A missing body comes back undefined. */
export function decodeSteps(record: Pick<RequestRecord, "list" | "steps">): unknown[] {
  const out: unknown[] = [];
  let prev: Obj | null = null;
  for (const s of record.steps) {
    if (s.missing) {
      out.push(undefined);
      prev = null;
      continue;
    }
    if ("raw" in s) {
      out.push(s.raw);
      prev = null;
      continue;
    }
    const keys = s.keys ?? (prev ? Object.keys(prev) : []);
    const body: Obj = {};
    for (const k of keys) {
      if (k === record.list && s.keep !== undefined) {
        const before = prev && Array.isArray(prev[k]) ? (prev[k] as unknown[]) : [];
        body[k] = [...before.slice(0, s.keep), ...(s.add ?? [])];
      } else if (s.set && k in s.set) {
        body[k] = s.set[k];
      } else {
        body[k] = prev?.[k];
      }
    }
    out.push(body);
    prev = body;
  }
  return out;
}

/** The items of one reply, by the id the Responses API will send back in their place. */
export function refsFromStep(content: unknown, request: number): Record<string, SentRef> {
  const refs: Record<string, SentRef> = {};
  if (!Array.isArray(content)) return refs;
  for (const part of content) {
    if (!isObj(part)) continue;
    const meta = isObj(part.providerMetadata) && isObj(part.providerMetadata.openai) ? part.providerMetadata.openai : null;
    const id = meta?.itemId;
    if (typeof id !== "string") continue;
    const text = typeof part.text === "string" ? part.text : "";
    if (part.type === "reasoning" || part.type === "text") {
      const type = part.type === "reasoning" ? "reasoning" : "message";
      const had = refs[id]?.text;
      refs[id] = { request, type, text: had ? `${had}\n\n${text}` : text };
    } else if (part.type === "tool-call") {
      refs[id] = { request, type: "function_call", name: String(part.toolName ?? ""), callId: String(part.toolCallId ?? ""), input: part.input };
    }
  }
  return refs;
}

/** A request with each item reference replaced by what it stood for, marked as not sent. */
export function withRefsFilled(body: unknown, refs: Record<string, SentRef>): { body: unknown; filled: number } {
  if (!isObj(body) || !Array.isArray(body.input)) return { body, filled: 0 };
  let filled = 0;
  const input = body.input.map((item) => {
    if (!isObj(item) || item.type !== "item_reference" || typeof item.id !== "string") return item;
    const ref = refs[item.id];
    if (!ref) return item;
    filled++;
    return { ...item, filled_in_not_sent: ref };
  });
  return { body: { ...body, input }, filled };
}
