/**
 * run-requests.ts — what a run's model call was sent, kept exactly and shown
 * on the run's page.
 *
 * A record is one RunMessage row (role "request") beside the run's thread
 * (role "thread", lib/agent/run-thread.ts): each request the call made, as
 * the JSON body that went to the provider. The run page's Context panel shows
 * each part the agent engine named (lib/agent/engine), each message of the
 * conversation, the tool menu, and the raw request.
 * The 8 PM Portfolio Digest and the Market Reviewer keep their own; every
 * other agent's is kept by the model it gets from modelFor (model.ts).
 */
import { prisma } from "@/lib/prisma";
import type { SentPartManifest, Where } from "@/lib/agent/engine/types";

export const REQUEST_ROLE = "request";

export interface RequestRecord {
  v: 1;
  /** Which call of the run ("Main"). */
  call: string;
  /** The code that made it. */
  source: string;
  model: string;
  startedAt: string;
  endedAt: string;
  /** Each request the call sent, as the JSON body that went to the provider. */
  requests: unknown[];
  /** Why the call failed, when it did. */
  error?: string;
  /** Which part of the request is which, in order, when the agent engine built it. */
  parts?: SentPartManifest[];
}

/**
 * Keep a call's record on its run. A failed save is logged, never thrown.
 * `replace`: the run keeps only its newest record of this call (a chat
 * message resends the whole conversation, so one per message would pile up).
 */
export async function saveRequestRecord(runId: string, record: RequestRecord, opts: { replace?: boolean } = {}): Promise<void> {
  try {
    const content = JSON.stringify(record);
    if (opts.replace) await prisma.runMessage.deleteMany({ where: { runId, role: REQUEST_ROLE, content: { startsWith: `{"v":1,"call":${JSON.stringify(record.call)},` } } });
    await prisma.runMessage.create({ data: { runId, role: REQUEST_ROLE, content } });
  } catch (err) {
    console.error(`[${record.source}] couldn't keep what run ${runId} sent the model:`, err instanceof Error ? err.message : err);
  }
}

export interface SentPart {
  label: string;
  chars: number;
  text: string;
}

/** One part of a request, in the order it was sent. */
export interface SentCategory {
  name: string;
  /** Its Framework page part, for its color (components/docs/framework/swatch.ts); null when it has none. */
  part: "job" | "read" | "tools" | null;
  chars: number;
  /** Its text: whole, or for the tool menu, each tool. */
  sections: SentPart[];
  /** The file its text comes from, for a part the agent engine named. */
  source?: string;
}

export interface CallView {
  call: string;
  model: string;
  error: string | null;
  categories: SentCategory[];
  /** Characters of text sent: the categories together. */
  chars: number;
  /** The request exactly as sent, and its size as JSON. */
  raw: unknown;
  rawChars: number;
}

/** What a call's first message is, by the code that made it. */
const FIRST_MESSAGE: Record<string, string> = { "portfolio-digest": "Portfolio snapshot", "market-reviewer": "Market numbers, portfolio, watchlist, notes and last digest" };

/** A message's content as text: a string as is, a list of parts by their text (any other part, a tool call or its result, as JSON). */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content.map((p) => (typeof p?.text === "string" ? p.text : JSON.stringify(p))).join("\n\n");
}

const listOf = (x: unknown): Array<Record<string, unknown>> => (Array.isArray(x) ? x : []);

/**
 * One record as the run page shows it: its instructions, its first message,
 * and on a longer request (a chat message, a retry) the conversation since and
 * the newest message. Reads the three bodies the agents send: Chat Completions
 * (`messages`), Responses (`input`) and Anthropic (`system` and `messages`).
 */
export function viewOfRecord(r: RequestRecord): CallView {
  const body = (r.requests[r.requests.length - 1] ?? null) as Record<string, unknown> | null;
  const items = [...(body?.system !== undefined ? [{ role: "system", content: body.system }] : []), ...listOf(body?.messages), ...listOf(body?.input)];
  // An item with no content (a Responses tool call or its output) is shown whole.
  const said = (m: Record<string, unknown>) => (m.content !== undefined ? textOf(m.content) : JSON.stringify(m));
  const isSystem = (m: Record<string, unknown>) => m.role === "system" || m.role === "developer";
  const rest = items.filter((m) => !isSystem(m));
  const categories: SentCategory[] = [];
  const whole = (name: string, part: SentCategory["part"], text: string) => categories.push({ name, part, chars: text.length, sections: [{ label: name, chars: text.length, text }] });
  const named = (where: Where) => (r.parts ?? []).filter((p) => p.where === where);
  /** A text by the parts the engine named in it: the parts, then what follows them (the person's words) as `after`. Whole when they don't add up. */
  const show = (where: Where, text: string, name: string, after?: string) => {
    const cut = byParts(named(where), text);
    if (!cut || (cut.after && !after)) return void whole(name, "read", text);
    categories.push(...cut.parts);
    if (cut.after) whole(after!, null, cut.after);
  };
  const instructions = items.filter(isSystem).map(said).join("\n\n");
  if (instructions) show("instructions", instructions, "Instructions");
  const first = FIRST_MESSAGE[r.source] ?? "First message";
  if (rest.length) {
    // A conversation's only message carries what rides on its newest one.
    if (named("message").length) show("message", said(rest[0]), first);
    else if (rest.length === 1 && named("newest").length) show("newest", said(rest[0]), first, first);
    else whole(first, "read", said(rest[0]));
  }
  if (rest.length > 2) whole("The conversation so far", null, rest.slice(1, -1).map(said).join("\n\n"));
  if (rest.length > 1) {
    const newest = said(rest[rest.length - 1]);
    if (named("newest").length) show("newest", newest, "Newest message", "Newest message");
    else whole("Newest message", null, newest);
  }
  // The tools it was offered: an agent's menu, counted as sent and shown spaced out.
  // A function tool by its name, a provider's own (OpenAI's web search) by its type.
  const tools = (listOf(body?.tools) as Array<{ function?: { name?: string }; name?: string; type?: string }>).map((t) => ({
    label: t.function?.name ?? t.name ?? t.type ?? "tool",
    chars: JSON.stringify(t).length,
    text: JSON.stringify(t, null, 2),
  }));
  if (tools.length) categories.push({ name: "Tool menu", part: "tools", chars: tools.reduce((n, t) => n + t.chars, 0), sections: tools });
  return {
    call: r.call,
    model: r.model,
    error: r.error ?? null,
    categories,
    chars: categories.reduce((n, c) => n + c.chars, 0),
    raw: body,
    rawChars: JSON.stringify(body).length,
  };
}

/**
 * The engine's parts, one row each, cut from the front of what was sent by
 * their sizes and the separator before each; what follows the last part
 * (the person's words on a chat message) is `after`. Null when there are no
 * parts or the text doesn't add up to them (a request changed after it was
 * built). A part with no text this run is not shown.
 */
export function byParts(parts: SentPartManifest[], text: string): { parts: SentCategory[]; after: string } | null {
  if (!parts.length) return null;
  let at = 0;
  const cut: string[] = [];
  parts.forEach((p, i) => {
    at += i === 0 ? 0 : (p.sep ?? "\n\n").length;
    cut.push(text.slice(at, at + p.chars));
    at += p.chars;
  });
  if (parts.map((p, i) => (i === 0 ? "" : (p.sep ?? "\n\n")) + cut[i]).join("") !== text.slice(0, at)) return null;
  // After the parts, a blank line and the rest of the message.
  const tail = text.slice(at);
  if (tail && !tail.startsWith("\n\n")) return null;
  return {
    parts: parts.flatMap((p, i) => (p.chars > 0 ? [{ name: p.title, part: p.kind === "own" ? ("job" as const) : ("read" as const), chars: p.chars, sections: [{ label: p.title, chars: p.chars, text: cut[i] }], source: p.source }] : [])),
    after: tail.slice(2),
  };
}

/** A run's records, oldest first, as its page shows them. */
export async function loadRunRequests(runId: string): Promise<CallView[]> {
  const rows = await prisma.runMessage.findMany({ where: { runId, role: REQUEST_ROLE }, orderBy: { createdAt: "asc" }, select: { content: true } });
  return rows.flatMap((row) => {
    try {
      const r = JSON.parse(row.content) as RequestRecord;
      return r?.v === 1 && Array.isArray(r.requests) ? [viewOfRecord(r)] : [];
    } catch {
      return [];
    }
  });
}
