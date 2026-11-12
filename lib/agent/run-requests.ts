/**
 * run-requests.ts — what a run's model call was sent, kept exactly and shown
 * on the run's page.
 *
 * A record is one RunMessage row (role "request") beside the run's thread
 * (role "thread", lib/agent/run-thread.ts): each request the call made, as
 * the JSON body that went to the provider. The run page's Context panel shows
 * each part of it, cut at the headings the prompt prints, and the raw request.
 * Only the 8 PM Portfolio Digest keeps one so far.
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
  /** A call of several steps keeps only its first request: how many it made in all. */
  of?: number;
  /** Why the call failed, when it did. */
  error?: string;
}

/** Keep a call's record on its run. A failed save is logged, never thrown. */
export async function saveRequestRecord(runId: string, record: RequestRecord): Promise<void> {
  try {
    await prisma.runMessage.create({ data: { runId, role: REQUEST_ROLE, content: JSON.stringify(record) } });
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

/** One record as the run page shows it: each message of its last request but the model's own (the thread has those). */
export function viewOfRecord(r: RequestRecord): CallView {
  const body = r.requests[r.requests.length - 1] ?? null;
  const sent = (body as { messages?: Array<{ role?: string; content?: unknown }> } | null)?.messages ?? [];
  let users = 0;
  const categories = sent
    .filter((m) => m.role !== "assistant")
    .map((m): SentCategory => {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      const system = m.role === "system" || m.role === "developer";
      const first = !system && users++ === 0;
      return {
        name: system ? "Instructions" : first ? (FIRST_MESSAGE[r.source] ?? "First message") : "Added message",
        part: system ? "job" : first ? "read" : null,
        chars: text.length,
        sections: partsAtHeadings(text),
      };
    });
  // The tools it was offered: an agent's menu, counted as sent and shown spaced out.
  const tools = ((body as { tools?: Array<{ function?: { name?: string } }> } | null)?.tools ?? []).map((t) => ({
    label: t.function?.name ?? "tool",
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
