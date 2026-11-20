/**
 * stock-context.ts — what an agent is handed about one stock before it
 * decides: the stock's newest 8 Activity lines, exactly as they read in the
 * feed (lib/thesis/activity-feed.ts). The Overview shows the same 8, so the
 * owner always sees what the agent read. One list, one number, no cutting.
 *
 * Until 2026-10-30 this file built six lists, each a patch for one bad day
 * (the last three notes cut to 900 and 500 characters, the principal's three
 * newest notes, three removals by hand, the fires since the last answer, the
 * decisions since it, a waiting sale as shares and a time), and nobody could
 * say in a sentence what the agent read. Now it reads the feed.
 *
 * Two facts the situations read off the WHOLE feed, not the 8, stay here:
 * the fires no run has answered (`openFires`) and the principal's newest
 * word no run has answered (`unansweredWord`). Those decide whether the
 * stock is on a run's list; the 8 lines are what the run then reads.
 *
 * Pure: needs-action.ts imports it.
 */
import { isNotelessEdit } from "@/lib/agent/no-note";
import {
  eventKind,
  isPlainReview,
  ladderChangeLines,
  notAppliedLines,
  proposalUserMessage,
  reviewTitle,
  titleSegments,
  type TimelineUpdate,
  type TitleTrigger,
} from "@/components/agent/sheets/thesis-timeline-utils";
import { notedItems, recentItems, RECENT_ITEMS, type FeedItem } from "@/lib/thesis/activity-feed";

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
  /** The block, ready to print; null when the feed is empty. */
  text: string | null;
  /** The Overview's "Agent insights" as lines: the newest Activity lines with a written paragraph. */
  insights: string[];
  openFires: OpenFire[];
}

type Changes = {
  source?: { to?: unknown };
  triggerOps?: { to?: Array<{ op?: string; text?: string }> };
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

/**
 * One Activity line as the agent reads it: the time, the price then, the
 * title the owner sees, what changed, the paragraph if someone wrote one, the
 * verdict's line, the line it answers, and its own id (the one a later note
 * answers). The same title grammar as the Activity tab, so the two never differ.
 */
export function saidLine(item: FeedItem, triggers?: ReadonlyArray<TitleTrigger>): string {
  const tu = asTimelineUpdate(item);
  const kind = eventKind(tu);
  // A plain review reads as the page titles it: the kind of review, from the trigger it answered ("Pre-earnings review · weaker"); everything that happened keeps its title.
  const t = isPlainReview(tu) ? reviewTitle(tu, triggers) : titleSegments(tu);
  const title = kind === "note" ? "Your note" : [t.primary, t.secondary].filter(Boolean).join(" ").trim();
  const chips = [...ladderChangeLines(tu), ...notAppliedLines(tu)].map((c) => c.text);
  const comment = proposalUserMessage(tu);
  const paragraph = comment ?? (item.rationale?.trim() ? item.rationale.replace(/^\[USER\]\s*/, "").trim() : null);
  const parts = [etStamp(item.timestamp), item.priceAtTime != null ? money(item.priceAtTime) : null, title].filter(Boolean);
  let line = `  ${parts.join(" · ")}`;
  if (chips.length) line += ` [${chips.join("; ")}]`;
  if (paragraph) line += ` — "${oneLine(paragraph)}"`;
  if (item.verdictLine) line += ` — verdict: "${oneLine(item.verdictLine)}"`;
  if (item.answersUpdateId) line += ` — answers the ${item.answersAt ? etStamp(item.answersAt) : item.answersUpdateId} line`;
  // An order's own step has no saved line to answer; a Proposed step answers as the run's note it carries.
  // A shared note is no line of this stock's to answer by id.
  const id = item.noteId ?? (item.id.startsWith("order:") || item.id.startsWith("note:") ? null : item.id);
  if (id) line += ` [id ${id}]`;
  return line;
}

/** The block every agent reads first on a stock: the newest 8 lines of its feed. `triggers` is the thesis's resolved list, so a review's title names the trigger it answered. */
export function saidBlock(ticker: string, feed: FeedItem[], triggers?: ReadonlyArray<TitleTrigger>): string | null {
  const items = recentItems(feed);
  if (items.length === 0) return null;
  const T = ticker.toUpperCase();
  return [
    `WHAT'S BEEN SAID ON $${T} — its newest ${items.length === RECENT_ITEMS ? RECENT_ITEMS : items.length} Activity lines, newest first, as the owner sees them:`,
    ...items.map((i) => saidLine(i, triggers)),
    `Full history: get_theses(tickers: ["${T}"], include_history: true)`,
  ].join("\n");
}

/** What a run is handed on a stock, and the fires no run has answered, read off the whole feed. */
export function buildStockContext(args: { ticker: string; feed: FeedItem[]; triggers?: ReadonlyArray<TitleTrigger> }): StockContext {
  return {
    text: saidBlock(args.ticker, args.feed, args.triggers),
    insights: notedItems(args.feed).map((i) => saidLine(i, args.triggers).trim()),
    openFires: openFires(args.feed),
  };
}
