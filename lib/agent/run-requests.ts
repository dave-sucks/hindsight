/**
 * run-requests.ts — what a run's model call was sent, kept exactly and shown
 * on the run's page.
 *
 * A record is one RunMessage row (role "request") beside the run's thread
 * (role "thread", lib/agent/run-thread.ts): each request the call made, as
 * the JSON body that went to the provider. The run page's Context panel shows
 * each part of it, cut at the headings the prompt prints, and the raw request.
 * Kept by the account runs, the morning run, the trigger run, the Writer and
 * each chat turn; a call of several steps keeps its first request (the rest
 * are in the conversation).
 */
import { prisma } from "@/lib/prisma";
import { promptBlocks, type PromptPart } from "@/lib/agent/prompt-blocks";

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
  /** A call of several steps keeps only its first request: how many it made in all. */
  of?: number;
  /** Why the call failed, when it did. */
  error?: string;
}

/**
 * Keep a call's record on its run. A failed save is logged, never thrown.
 * `replace`: the run keeps only its newest record of this call (a chat
 * message's first request resends the whole conversation, so one per
 * message would grow with the square of its length).
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

const errorText = (e: unknown) => (e instanceof Error ? e.message || e.name : typeof e === "string" ? e : JSON.stringify(e)) || "Error";

/**
 * Record a model call's first request exactly as the AI SDK sent it (step 1's
 * request body) and how many it made: hand each finished step's `request` to
 * `step`, and save once when the call ends or fails (`around` does both ends).
 * With no run id nothing is kept; `replace`: see saveRequestRecord.
 */
export function recordFirstRequest(runId: string | null | undefined, call: string, source: string, model: string, opts: { replace?: boolean } = {}) {
  const startedAt = new Date().toISOString();
  let first: unknown;
  let steps = 0;
  let saved = false;
  async function save(error?: unknown): Promise<void> {
    if (!runId || saved) return;
    saved = true;
    const requests = first === undefined ? [] : [first];
    await saveRequestRecord(runId, { v: 1, call, source, model, startedAt, endedAt: new Date().toISOString(), requests, of: steps, ...(error !== undefined ? { error: errorText(error) } : {}) }, opts);
  }
  return {
    step(request: { body?: unknown } | undefined): void {
      if (++steps === 1) first = request?.body;
    },
    save,
    async around<T>(call: Promise<T>): Promise<T> {
      try {
        const out = await call;
        await save();
        return out;
      } catch (err) {
        await save(err);
        throw err;
      }
    },
  };
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
  part: PromptPart | "tools" | null;
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
  /** When the record is a run's first request of several: how many it made in all. */
  of: number | null;
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

type Sent = { system: boolean; text: string };

/** A message's content as text: a string as is, a list of parts by their text (any other part as JSON). */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content.map((p) => (typeof p?.text === "string" ? p.text : JSON.stringify(p))).join("\n\n");
}

/** A request's messages in the three shapes the agents send: Chat Completions (`messages`), Responses (`input`, `instructions`), Anthropic (`system`, `messages`). */
function messagesOf(body: Record<string, unknown>): Sent[] {
  const out: Sent[] = [];
  if (body.system !== undefined) out.push({ system: true, text: textOf(body.system) });
  if (typeof body.instructions === "string") out.push({ system: true, text: body.instructions });
  const items = [...(Array.isArray(body.messages) ? body.messages : []), ...(Array.isArray(body.input) ? body.input : [])] as Array<Record<string, unknown>>;
  for (const m of items) out.push({ system: m.role === "system" || m.role === "developer", text: textOf(m.content ?? m.output ?? m) });
  return out;
}

/** One record as the run page shows it: its instructions cut into the parts they are built from, its messages, its tool menu. */
export function viewOfRecord(r: RequestRecord): CallView {
  const body = r.requests[r.requests.length - 1] ?? null;
  const sent = body && typeof body === "object" ? messagesOf(body as Record<string, unknown>) : [];
  const categories: SentCategory[] = [];
  const add = (name: string, part: SentCategory["part"], text: string, chars = text.length) => categories.push({ name, part, chars, sections: partsAtHeadings(text) });
  for (const m of sent.filter((x) => x.system)) {
    for (const b of promptBlocks(m.text)) {
      if (b.sections) categories.push({ name: b.label, part: b.part, chars: b.chars, sections: b.sections.map((x) => ({ ...x, chars: x.text.length })) });
      else add(b.label, b.part, b.text, b.chars);
    }
  }
  // A chat turn resends the conversation: everything before its new message is one part.
  const rest = sent.filter((x) => !x.system);
  const earlier = rest.slice(0, -1);
  if (earlier.length) add("The conversation so far", null, earlier.map((x) => x.text).join("\n\n"), earlier.reduce((n, x) => n + x.text.length, 0));
  if (rest.length) add(earlier.length ? "This message" : (FIRST_MESSAGE[r.source] ?? "First message"), "read", rest[rest.length - 1].text);
  // The tools it was offered, counted as sent and shown spaced out.
  const offered = (body as { tools?: unknown } | null)?.tools;
  const tools = (Array.isArray(offered) ? (offered as Array<{ name?: string; function?: { name?: string } }>) : []).map((t) => ({
    label: t.function?.name ?? t.name ?? "tool",
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
    of: r.of && r.of > 1 ? r.of : null,
  };
}

/** A run's records, oldest first, as its page shows them; `latest`: the newest only (a chat keeps one per message). */
export async function loadRunRequests(runId: string, opts: { latest?: boolean } = {}): Promise<CallView[]> {
  const rows = await prisma.runMessage.findMany({
    where: { runId, role: REQUEST_ROLE },
    orderBy: { createdAt: opts.latest ? "desc" : "asc" },
    ...(opts.latest ? { take: 1 } : {}),
    select: { content: true },
  });
  return rows.flatMap((row) => {
    try {
      const r = JSON.parse(row.content) as RequestRecord;
      return r?.v === 1 && Array.isArray(r.requests) ? [viewOfRecord(r)] : [];
    } catch {
      return [];
    }
  });
}
