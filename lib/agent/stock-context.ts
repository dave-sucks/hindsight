/**
 * stock-context.ts — what an agent is handed about one stock before it
 * decides: its Activity (lib/thesis/activity-feed.ts) as one list, newest
 * first, one sentence per line (`activityRead`). The rule is a filter and
 * nothing else:
 *
 *   in  — the newest 3 reviews (a run's line with a note; one per run), the
 *         newest 3 news notes (the Market Reviewer's), the owner's newest 3
 *         notes, and the owner's last decline that carries words (`READ`);
 *   out — trigger edits, trigger fires, and proposal steps with no words.
 *
 * Every sentence has the same parts: what it is, who wrote it, when, the
 * price then, the verdict when it has one, and the note. Every agent reads
 * the same list; it is built here and nowhere else.
 *
 * Two facts read off the same feed stay here: the fires no run has answered
 * (`openFires`), which decide whether the stock is on a run's list, and what
 * the owner set on each trigger (`ownerSets`), said on the trigger's own line.
 *
 * Pure: needs-action.ts imports it.
 */
import { isNotelessEdit } from "@/lib/agent/no-note";
import { proposalUserMessage, titleSegments, type TimelineUpdate } from "@/components/agent/sheets/thesis-timeline-utils";
import type { FeedItem } from "@/lib/thesis/activity-feed";

/** One Activity line, as the callers load it. Any order. */
export interface ActivityRow {
  id?: string;
  type: string;
  timestamp: Date;
  triggerId?: string | null;
  summary?: string | null;
  rationale?: string | null;
  fieldChanges?: unknown;
  /** Set when a run wrote the line; null for the principal and the app's bookkeeping. */
  runId?: string | null;
  runMode?: string | null;
  priceAtTime?: number | null;
}

/** A trigger fired since the last agent answer. */
export interface OpenFire {
  triggerId: string;
  count: number;
  firstAt: Date;
  lastAt: Date;
  lastPrice: number | null;
  /** The newest fire line's summary — the label when the trigger is gone. */
  summary: string | null;
}

export interface StockContext {
  /** The list, ready to print; null when nothing on the stock is read. */
  text: string | null;
  openFires: OpenFire[];
  /** The owner's newest change to each trigger, by trigger id. */
  ownerSets: Map<string, OwnerSet>;
}

/** The owner's newest change to a trigger: when, and what it was before (null when it was added, or nothing in its sentence moved). */
export interface OwnerSet {
  at: Date;
  was: string | null;
}

type Changes = {
  source?: { to?: unknown };
  triggerOps?: { to?: Array<{ op?: string; id?: string; text?: string }> };
  proposal?: { to?: { intent?: string; quantity?: number; proposedQuantity?: number; edited?: boolean; userMessage?: string } };
};
const changesOf = (r: ActivityRow): Changes =>
  r.fieldChanges && typeof r.fieldChanges === "object" ? (r.fieldChanges as Changes) : {};
const newestFirst = <T extends ActivityRow>(rows: T[]): T[] => [...rows].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const money = (n: number) => `$${n.toFixed(2)}`;

/** A proposal step, or an edit made by hand. */
export function isPrincipalRow(r: ActivityRow): boolean {
  if (r.type.startsWith("PROPOSAL_")) return true;
  if (r.runId) return false;
  return (r.rationale ?? "").startsWith("[USER]") || changesOf(r).source?.to === "USER";
}

/**
 * A line a run wrote: a review, an update, a status move, a close. Not a fire,
 * a proposal step, the principal's edit, or the app's bookkeeping (those
 * carry no run).
 */
export function isAgentAnswer(r: ActivityRow): boolean {
  return !!r.runId && r.type !== "TRIGGER_FIRED" && r.type !== "NOTE" && !isPrincipalRow(r) && !isNotelessEdit(r.fieldChanges);
}

/**
 * How a removal in the cleanup of copied rules (scripts/sweep-frozen-copies.ts)
 * begins its summary; thesis-edit.ts writes it from here. Those removals took
 * template lines off stocks and decided nothing about a stock, so they never
 * ask a run for an answer.
 */
export const COPIED_RULE_CLEANUP = "Removed a copied rule from ";

/** Every trigger fired after the newest agent answer, newest first. */
export function openFires(rows: ActivityRow[]): OpenFire[] {
  const byTrigger = new Map<string, OpenFire>();
  for (const r of newestFirst(rows)) {
    if (isAgentAnswer(r)) break;
    if (r.type !== "TRIGGER_FIRED" || !r.triggerId) continue;
    const seen = byTrigger.get(r.triggerId);
    if (seen) {
      seen.count += 1;
      seen.firstAt = r.timestamp;
    } else {
      byTrigger.set(r.triggerId, {
        triggerId: r.triggerId,
        count: 1,
        firstAt: r.timestamp,
        lastAt: r.timestamp,
        lastPrice: typeof r.priceAtTime === "number" ? r.priceAtTime : null,
        summary: r.summary ?? null,
      });
    }
  }
  return [...byTrigger.values()];
}

const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "09-14 11:43", Eastern. */
export function etStamp(d: Date): string {
  const p = Object.fromEntries(ET.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** The feed item in the shape the Activity tab's title grammar reads. */
export function asTimelineUpdate(item: FeedItem): TimelineUpdate {
  return {
    ...item,
    timestamp: item.timestamp.toISOString(),
    fieldChanges: (item.fieldChanges ?? null) as TimelineUpdate["fieldChanges"],
    positionAtTime: (item.positionAtTime ?? null) as TimelineUpdate["positionAtTime"],
  };
}

/** How many of each kind of line an agent reads, the newest of each. Every kind has a number. */
export const READ = { review: 3, news: 3, note: 3, decline: 1 } as const;
type Kind = keyof typeof READ;

const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** Who wrote a run's line, by the run's kind. */
const WRITERS: Record<string, string> = {
  MORNING_PLAN: "its analyst",
  INTRADAY_TACTICAL: "its analyst",
  THESIS_WRITER: "the Writer",
  PORTFOLIO_MANAGER: "the Portfolio Manager",
  PRINCIPAL_CHAT: "the chat",
};

type Read = { kind: Kind; what: string; who: string; verdict: string | null; note: string };
type SharedNote = { author?: string; impact?: string | null; effect?: string | null };

/** The line as an agent reads it, or null when the filter leaves it out. */
function readOf(i: FeedItem): Read | null {
  const note = oneLine((i.rationale ?? "").replace(/^\[USER\]\s*/, ""));
  if (i.type === "TRIGGER_FIRED") return null;
  // The owner's decline, named as the Activity tab names it ("Declined sell 300 shares"), with the words they wrote on it.
  if (i.type === "PROPOSAL_REJECTED") {
    const tu = asTimelineUpdate(i);
    const words = proposalUserMessage(tu) ?? (i.id.startsWith("order:") ? note : null);
    const t = titleSegments(tu);
    return words ? { kind: "decline", what: [t.primary, t.secondary].filter(Boolean).join(" "), who: "you", verdict: null, note: oneLine(words) } : null;
  }
  if (i.type.startsWith("PROPOSAL_") && !i.runId) return null;
  if (!note) return null;
  if (i.type === "SHARED_NOTE") {
    const n = ((i.fieldChanges as { sharedNote?: { to?: SharedNote } } | null)?.sharedNote?.to ?? {}) as SharedNote;
    if (n.author !== "MARKET_REVIEWER") return { kind: "note", what: "Note", who: "you", verdict: null, note };
    return { kind: "news", what: "News", who: "the Market Reviewer", verdict: [n.impact ? `${n.impact} impact` : null, n.effect].filter(Boolean).join(", ") || null, note };
  }
  if (i.type === "NOTE") return { kind: "note", what: "Note", who: "you", verdict: null, note };
  // A review: a run's line with a note. An edit saved with no note, the owner's edit and the app's own lines carry no run or no note.
  if (!i.runId || isNotelessEdit(i.fieldChanges)) return null;
  return { kind: "review", what: "Review", who: WRITERS[i.runMode ?? ""] ?? "an agent", verdict: i.verdict ? i.verdict.toLowerCase() : null, note };
}

/** "Review by its analyst, Nov 18, 8:01 AM at $39.27: weaker. <note> [id …]" — the id is the one a later note answers. */
function sentence(i: FeedItem, r: Read): string {
  const price = i.priceAtTime != null ? ` at ${money(i.priceAtTime)}` : "";
  const id = i.noteId ?? (i.id.startsWith("order:") || i.id.startsWith("note:") ? null : i.id);
  return `  ${r.what} by ${r.who}, ${WHEN.format(i.timestamp)}${price}: ${r.verdict ? `${r.verdict}. ` : ""}${r.note}${id ? ` [id ${id}]` : ""}`;
}

/** The stock's Activity as every agent reads it (see the top of the file). */
export function activityRead(args: { ticker: string; feed: FeedItem[] }): string | null {
  const runs = new Set<string>();
  const read: Record<Kind, number> = { review: 0, news: 0, note: 0, decline: 0 };
  const lines: string[] = [];
  for (const i of args.feed) {
    const r = readOf(i);
    if (!r || read[r.kind] === READ[r.kind]) continue;
    // A run that saved its note on two lines is one review.
    if (r.kind === "review" && runs.has(i.runId!)) continue;
    if (r.kind === "review") runs.add(i.runId!);
    read[r.kind] += 1;
    lines.push(sentence(i, r));
  }
  if (lines.length === 0) return null;
  const T = args.ticker.toUpperCase();
  return [
    `Activity on $${T}, newest first: the last ${READ.review} reviews, ${READ.news} news notes and ${READ.note} of your notes, and your last decline.`,
    ...lines,
    `Full history: get_theses(tickers: ["${T}"], include_history: true)`,
  ].join("\n");
}

/** "Sell if below $930.60" beside "Sell if below $804" → "$930.60": the part of the old sentence the new one doesn't share. */
function wasWords(before: string, after: string): string | null {
  if (before === after) return null;
  const a = before.split(" ");
  const b = after.split(" ");
  let same = 0;
  while (same < a.length - 1 && a[same] === b[same]) same += 1;
  return a.slice(same).join(" ");
}

/** The owner's newest change to each trigger, read off the stock's own Activity lines: when, and what the trigger was before. */
export function ownerSets(feed: FeedItem[]): Map<string, OwnerSet> {
  const out = new Map<string, OwnerSet>();
  for (const item of feed) {
    if (!isPrincipalRow(item)) continue;
    const ops = changesOf(item).triggerOps?.to;
    for (const o of Array.isArray(ops) ? ops : []) {
      if (!o?.id || out.has(o.id) || o.op === "remove") continue;
      const changed = /^Changed: (.+) → (.+)$/.exec(o.text ?? "");
      out.set(o.id, { at: item.timestamp, was: changed ? wasWords(changed[1], changed[2]) : null });
    }
  }
  return out;
}

/** What a run is handed on a stock, and the fires no run has answered, read off the whole feed. */
export function buildStockContext(args: { ticker: string; feed: FeedItem[] }): StockContext {
  return { text: activityRead(args), openFires: openFires(args.feed), ownerSets: ownerSets(args.feed) };
}
