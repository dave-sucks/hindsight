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
import {
  eventKind,
  ladderChangeLines,
  notAppliedLines,
  proposalUserMessage,
  titleSegments,
  type TimelineUpdate,
} from "@/components/agent/sheets/thesis-timeline-utils";
import { recentItems, RECENT_ITEMS, type FeedItem } from "@/lib/thesis/activity-feed";

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

/** The principal's newest word no run has answered: a note, a decline with a comment, a resized approval, a hand edit. */
export interface UnansweredWord {
  at: Date;
  summary: string;
}

export interface StockContext {
  /** The block, ready to print; null when the feed is empty. */
  text: string | null;
  openFires: OpenFire[];
  unansweredDecision: UnansweredWord | null;
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
  return !!r.runId && r.type !== "TRIGGER_FIRED" && r.type !== "NOTE" && !isPrincipalRow(r);
}

/**
 * How a removal in the cleanup of copied rules (scripts/sweep-frozen-copies.ts)
 * begins its summary; thesis-edit.ts writes it from here. Those removals took
 * template lines off stocks and decided nothing about a stock, so they never
 * ask a run for an answer.
 */
export const COPIED_RULE_CLEANUP = "Removed a copied rule from ";

const isCopiedRuleCleanup = (r: ActivityRow) => (r.summary ?? "").startsWith(COPIED_RULE_CLEANUP);

/**
 * The principal's word that asks a run for an answer: a note, a decline with
 * a comment, an approval at a changed size, or an edit by hand (a removal
 * included: ABT 10-07, a run never read the removal and set the buy again).
 * A bare decline and a plain approval decide nothing further; the cleanup of
 * copied rules decided nothing about the stock.
 */
export function wantsAnswer(r: ActivityRow): boolean {
  if (r.type === "NOTE") return true;
  if (!isPrincipalRow(r)) return false;
  const to = changesOf(r).proposal?.to;
  if (r.type === "PROPOSAL_REJECTED") {
    const raw = to?.userMessage ?? r.rationale ?? "";
    // A no-message decline stored a "[REJECTED:USER] …" line until 2026-10-29; it stores none now.
    return !!raw && !raw.startsWith("[REJECTED:USER]");
  }
  if (r.type === "PROPOSAL_APPROVED") return to?.edited === true;
  if (r.type.startsWith("PROPOSAL_")) return false;
  if (isCopiedRuleCleanup(r)) return false;
  const ops = changesOf(r).triggerOps?.to ?? [];
  return ops.some((o) => o?.text) || !!oneLine(r.summary ?? "");
}

/** The principal's newest word, newer than the newest agent answer, that asks for one. */
export function unansweredWord(rows: ActivityRow[]): UnansweredWord | null {
  for (const r of newestFirst(rows)) {
    if (isAgentAnswer(r)) return null;
    if (wantsAnswer(r)) return { at: r.timestamp, summary: oneLine(r.summary ?? r.type) };
  }
  return null;
}

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
function asTimelineUpdate(item: FeedItem): TimelineUpdate {
  return {
    ...item,
    timestamp: item.timestamp.toISOString(),
    fieldChanges: (item.fieldChanges ?? null) as TimelineUpdate["fieldChanges"],
    positionAtTime: (item.positionAtTime ?? null) as TimelineUpdate["positionAtTime"],
  };
}

/**
 * One Activity line as the agent reads it: the time, the price then, the
 * title the owner sees, what changed, and the paragraph if someone wrote one.
 * The same title grammar as the Activity tab, so the two never differ.
 */
export function saidLine(item: FeedItem): string {
  const tu = asTimelineUpdate(item);
  const kind = eventKind(tu);
  const t = titleSegments(tu);
  const title = kind === "note" ? "Your note" : [t.primary, t.secondary].filter(Boolean).join(" ").trim();
  const chips = [...ladderChangeLines(tu), ...notAppliedLines(tu)].map((c) => c.text);
  const comment = proposalUserMessage(tu);
  const paragraph = comment ?? (item.rationale?.trim() ? item.rationale.replace(/^\[USER\]\s*/, "").trim() : null);
  const parts = [etStamp(item.timestamp), item.priceAtTime != null ? money(item.priceAtTime) : null, title].filter(Boolean);
  let line = `  ${parts.join(" · ")}`;
  if (chips.length) line += ` [${chips.join("; ")}]`;
  if (paragraph) line += ` — "${oneLine(paragraph)}"`;
  return line;
}

/** The block every agent reads first on a stock: the newest 8 lines of its feed. */
export function saidBlock(ticker: string, feed: FeedItem[]): string | null {
  const items = recentItems(feed);
  if (items.length === 0) return null;
  const T = ticker.toUpperCase();
  return [
    `WHAT'S BEEN SAID ON $${T} — its newest ${items.length === RECENT_ITEMS ? RECENT_ITEMS : items.length} Activity lines, newest first, as the owner sees them:`,
    ...items.map(saidLine),
    `Full history: get_theses(tickers: ["${T}"], include_history: true)`,
  ].join("\n");
}

/** What a run is handed on a stock, and the two facts the situations read off the whole feed. */
export function buildStockContext(args: { ticker: string; feed: FeedItem[] }): StockContext {
  return {
    text: saidBlock(args.ticker, args.feed),
    openFires: openFires(args.feed),
    unansweredDecision: unansweredWord(args.feed),
  };
}
