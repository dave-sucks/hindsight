/**
 * stock-context.ts — what an agent is handed about one stock before it
 * decides: its Activity (lib/thesis/activity-feed.ts) in four parts, cut by
 * kind and not by how recent a line is (`activityRead`):
 *
 *   Where it stands — the last verdict that wasn't "unchanged", since when
 *                     and why, and conviction.
 *   The last look   — the newest lines a run wrote with a note, in full.
 *   Since then      — every line after that look, one each; price triggers
 *                     that fired are one count.
 *   Open            — a proposal that waits, and the owner's last decline
 *                     with its words.
 *
 * No paragraph is printed twice. A stock compared across the account (the
 * Portfolio Manager's read) gets the first and last parts only (`brief`).
 * Every agent's read of a stock's Activity is built here and nowhere else.
 *
 * Two facts read off the same feed stay here: the fires no run has answered
 * (`openFires`), which decide whether the stock is on a run's list, and what
 * the owner set on each trigger (`ownerSets`), said on the trigger's own line.
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
  triggerPhrase,
  type TimelineUpdate,
  type TitleTrigger,
} from "@/components/agent/sheets/thesis-timeline-utils";
import { conditionsOf, shapeOf } from "@/lib/agent/triggers/condition";
import { hasWrittenParagraph, type FeedItem } from "@/lib/thesis/activity-feed";

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
  /** The four parts, ready to print; null when the feed is empty. */
  text: string | null;
  /** Where it stands and what is open: what a stock compared across the account carries. */
  brief: string | null;
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

/**
 * One Activity line as the agent reads it: the time, the price then, the
 * title the owner sees, what changed, the paragraph if someone wrote one, the
 * verdict's line, the line it answers, and its own id (the one a later note
 * answers). The same title grammar as the Activity tab, so the two never differ.
 * A paragraph or verdict line already in `seen` is left off: no note reads twice.
 */
export function saidLine(item: FeedItem, triggers?: ReadonlyArray<TitleTrigger>, seen?: Set<string>): string {
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
  const once = (text: string | null | undefined): string | null => {
    const t = text ? oneLine(text) : "";
    if (!t || seen?.has(t)) return null;
    seen?.add(t);
    return t;
  };
  const said = once(paragraph);
  const verdict = once(item.verdictLine);
  if (said) line += ` — "${said}"`;
  if (verdict) line += ` — verdict: "${verdict}"`;
  if (item.answersUpdateId) line += ` — answers the ${item.answersAt ? etStamp(item.answersAt) : item.answersUpdateId} line`;
  // An order's own step has no saved line to answer; a Proposed step answers as the run's note it carries.
  // A shared note is no line of this stock's to answer by id.
  const id = item.noteId ?? (item.id.startsWith("order:") || item.id.startsWith("note:") ? null : item.id);
  if (id) line += ` [id ${id}]`;
  return line;
}

/** "11-09", Eastern. */
const etDay = (d: Date) => etStamp(d).split(" ")[0];

/** A line a run wrote with a note: a look. */
const isLook = (i: FeedItem) => !!i.runId && i.type !== "TRIGGER_FIRED" && i.type !== "NOTE" && i.type !== "SHARED_NOTE" && hasWrittenParagraph(i);
const proposalStatus = (i: FeedItem) => (i.fieldChanges as { proposal?: { to?: { status?: unknown } } } | null)?.proposal?.to?.status;
const waits = (i: FeedItem) => i.type === "PROPOSAL_PROPOSED" && proposalStatus(i) === "AWAITING_APPROVAL";

/** A fire that says something happened (a report, a filing, a note), not that a price was reached: it keeps its own line. */
const HAPPENED: ReadonlySet<string> = new Set(["report", "surprise", "filing", "note"]);
function somethingHappened(i: FeedItem): boolean {
  const when = shapeOf(i.triggerCondition);
  return !!when && conditionsOf(when).some((c) => HAPPENED.has(c.watch));
}

/**
 * Where the stock stands: the newest verdict that wasn't "unchanged", dated
 * from the first look of the unbroken run that gave it (a look that said the
 * same, or "unchanged", keeps it standing) with that look's own reason.
 */
function standingLine(feed: FeedItem[], conviction: string | null | undefined, seen: Set<string>): string | null {
  const looks = feed.filter((i) => i.verdict);
  const at = looks.findIndex((i) => i.verdict !== "UNCHANGED");
  let stands: string | null = null;
  if (at >= 0) {
    let first = looks[at];
    for (const l of looks.slice(at + 1)) {
      if (l.verdict === first.verdict) first = l;
      else if (l.verdict !== "UNCHANGED") break;
    }
    // The oldest look read here gave it too: it may have stood longer than the lines loaded show.
    const orEarlier = first === looks[looks.length - 1] ? "at least " : "";
    const why = first.verdictLine ? oneLine(first.verdictLine) : "";
    // Said here, so the look that gave it doesn't say it again below.
    if (why) seen.add(why);
    stands = `${first.verdict!.toLowerCase()} since ${orEarlier}${etDay(first.timestamp)}${why ? ` — "${why}"` : ""}`;
  } else if (looks.length) {
    stands = "unchanged at every look read here";
  }
  const parts = [stands, conviction ? `conviction ${conviction}` : null].filter(Boolean);
  return parts.length ? `Where it stands: ${parts.join(" · ")}` : null;
}

/** The price triggers that fired, as one line: each trigger's sentence, how often, and its newest fire. */
function firesLine(fires: FeedItem[]): string | null {
  if (fires.length === 0) return null;
  const by = new Map<string, { n: number; last: FeedItem }>();
  for (const f of fires) {
    const key = f.triggerId ?? f.summary;
    const seen = by.get(key);
    if (seen) seen.n += 1;
    else by.set(key, { n: 1, last: f });
  }
  const each = [...by.values()].map(({ n, last }) => `${triggerPhrase(last.summary)} ×${n} (last ${etStamp(last.timestamp)}${last.priceAtTime != null ? ` at ${money(last.priceAtTime)}` : ""})`);
  return `  Triggers fired ${fires.length} time${fires.length === 1 ? "" : "s"}: ${each.join("; ")}`;
}

/**
 * The stock's Activity as an agent reads it, in four parts (see the top of
 * the file). `triggers` is the thesis's resolved list, so a review's title
 * names the trigger it answered.
 */
export function activityRead(args: { ticker: string; feed: FeedItem[]; triggers?: ReadonlyArray<TitleTrigger>; conviction?: string | null }): { text: string | null; brief: string | null } {
  const { feed, triggers } = args;
  if (feed.length === 0) return { text: null, brief: null };
  const T = args.ticker.toUpperCase();
  const seen = new Set<string>();
  const standing = standingLine(feed, args.conviction, seen);

  const lookAt = feed.findIndex(isLook);
  const run = lookAt >= 0 ? feed[lookAt].runId : null;
  const ofTheLook = (i: FeedItem) => run != null && i.runId === run && i.type !== "TRIGGER_FIRED";
  const look = feed.filter(ofTheLook).map((i) => saidLine(i, triggers, seen));

  const waiting = feed.filter(waits);
  const decline = feed.find((i) => i.type === "PROPOSAL_REJECTED");
  const inOpen = new Set([...waiting, ...(decline ? [decline] : [])]);
  const since = (lookAt >= 0 ? feed.slice(0, lookAt) : feed).filter((i) => !ofTheLook(i) && !inOpen.has(i));
  const counted = since.filter((i) => i.type === "TRIGGER_FIRED" && !somethingHappened(i));
  const sinceLines = [...since.filter((i) => !counted.includes(i)).map((i) => saidLine(i, triggers, seen)), firesLine(counted)].filter((l): l is string => l != null);

  // A waiting proposal is its title: its reason is a look's note, read above when it is the last one.
  const open = [
    ...waiting.map((i) => saidLine({ ...i, rationale: null, verdictLine: null, answersUpdateId: null }, triggers)),
    ...(decline ? [saidLine(decline, triggers)] : []),
  ];
  const part = (label: string, lines: string[], none: string) => (lines.length ? [`${label}:`, ...lines] : [`${label}: ${none}`]);
  const text = [
    `ACTIVITY ON $${T} — where it stands, the last look, what happened since, and what is open:`,
    ...(standing ? [standing] : []),
    ...part("The last look", look, "none yet."),
    ...part(lookAt >= 0 ? "Since then" : "What has happened", sinceLines, "nothing."),
    ...part("Open", open, "nothing."),
    `Full history: get_theses(tickers: ["${T}"], include_history: true)`,
  ].join("\n");
  const brief = [...(standing ? [standing] : []), ...(open.length ? ["Open:", ...open] : [])].join("\n") || null;
  return { text, brief };
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
export function buildStockContext(args: { ticker: string; feed: FeedItem[]; triggers?: ReadonlyArray<TitleTrigger>; conviction?: string | null }): StockContext {
  return { ...activityRead(args), openFires: openFires(args.feed), ownerSets: ownerSets(args.feed) };
}
