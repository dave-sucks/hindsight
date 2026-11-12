/**
 * run-requests.ts — what a run's model call was sent, kept exactly and shown
 * on the run's page.
 *
 * A record is one RunMessage row (role "request") beside the run's thread
 * (role "thread", lib/agent/run-thread.ts): each request the call made, as
 * the JSON body that went to the provider. The run page's Context panel shows
 * each part of it, cut at the headings the prompt prints, and the raw request.
 * The 8 PM Portfolio Digest and the Market Reviewer keep their own; every
 * other agent's is kept by the model it gets from modelFor (model.ts).
 */
import { prisma } from "@/lib/prisma";

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
  /** Its text, cut at the headings the prompt prints. */
  sections: SentPart[];
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
const FIRST_MESSAGE: Record<string, string> = { "portfolio-digest": "Portfolio snapshot", "market-reviewer": "Portfolio, watchlist and last digest" };

/** A heading as the prompts print one: a markdown heading, or a line opening with a label in capitals ("HELD POSITIONS:", "WHAT TO COVER (in roughly this order):"). */
const HEADING = /^(?:#{1,3} +(.+)|([A-Z][A-Z0-9&/' -]*[A-Z0-9])(?= *[:(—]))/;

/** A message's text cut at its headings, each part named by its heading. The parts add up to the text. */
export function partsAtHeadings(text: string): SentPart[] {
  const parts: { label: string; lines: string[] }[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(HEADING);
    const cur = parts[parts.length - 1];
    // A heading with nothing after it ("FACTS:") stays with the line under it.
    const lone = cur?.lines.length === 1 && /:\s*$/.test(cur.lines[0]);
    if (m && !lone) parts.push({ label: (m[1] ?? m[2]).trim(), lines: [line] });
    else if (cur) cur.lines.push(line);
    else parts.push({ label: "Opening", lines: [line] });
  }
  return parts.map((p, i) => {
    const t = p.lines.join("\n") + (i < parts.length - 1 ? "\n" : "");
    return { label: p.label, chars: t.length, text: t };
  });
}

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
  const add = (name: string, part: SentCategory["part"], text: string) => categories.push({ name, part, chars: text.length, sections: partsAtHeadings(text) });
  for (const m of items.filter(isSystem)) add("Instructions", "job", said(m));
  if (rest.length) add(FIRST_MESSAGE[r.source] ?? "First message", "read", said(rest[0]));
  if (rest.length > 2) add("The conversation so far", null, rest.slice(1, -1).map(said).join("\n\n"));
  if (rest.length > 1) add("Newest message", null, said(rest[rest.length - 1]));
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
