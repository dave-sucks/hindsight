/**
 * row-for-model.ts — one stock's row as an agent reads it.
 *
 * Every stock is a line of the stock table (lib/agent/stock-table.ts). A
 * stock in a situation, and any stock an agent opens by ticker, is also a
 * row: the same row whatever the situation and whoever reads it. ROW_FIELDS
 * is the whole of it, one line per field: its name, what it is, when it is
 * included, and how its value is read off the saved row. A field with
 * nothing to say is left off. To stop sending a field, delete its line.
 *
 * A field is included always, or when the stock has it (a fact about the
 * stock, never its situation), or only when the read asks for it (the long
 * research, the raw history). The situations page prints this table
 * (lib/docs/situations-library.ts), so the page and the code can't differ.
 *
 * The screen's source citations (`[STRUCTURED:…]`, `[WEB:…]`) are stripped
 * from every text here. Pure: a saved row or a recorded one builds the same way.
 */
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";
import { stripCitationTags } from "@/lib/thesis/clean-text";
import { writtenNote } from "@/lib/agent/triggers/note";
import { streetLine } from "@/lib/market-data/street-consensus";

/** The facts a row carries beside the thesis's own columns; the builder reads them, the model never sees them raw. */
export const ROW_FACTS = ["position", "proposals", "price", "chart", "inheritedTriggers"] as const;

type Row = Record<string, unknown>;

/** What a read may ask for beyond the row: the long research, and the raw Activity log. */
export interface RowAsk {
  research?: boolean;
  history?: boolean;
}

/** The screen's citations and markdown bold, off a text the model reads. */
export function stripSourceTags(s: string): string {
  return stripCitationTags(s.replace(/\*\*/g, ""));
}

// ── Values off a saved or recorded row ─────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const date = (v: unknown): Date | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" && v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
  return null;
};
const obj = (v: unknown): Row | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null);
const list = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const strings = (v: unknown): string[] => list(v).map((x) => (typeof x === "string" ? stripSourceTags(x) : "")).filter(Boolean);

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number, places = 1) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(places)}%`;
const ET = { timeZone: "America/New_York" } as const;
/** `MM-DD HH:MM ET`. */
const etStamp = (d: Date) => `${d.toLocaleDateString("en-US", { ...ET, month: "2-digit", day: "2-digit" }).replace("/", "-")} ${d.toLocaleTimeString("en-GB", { ...ET, hour: "2-digit", minute: "2-digit", hour12: false })} ET`;
/** `MM-DD`, Eastern. */
const etDay = (d: Date) => d.toLocaleDateString("en-US", { ...ET, month: "2-digit", day: "2-digit" }).replace("/", "-");
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function stance(status: unknown): string {
  switch (status) {
    case "HOLDING": return "held";
    case "WATCHING": return "watch";
    case "PROMOTED": return "promoted";
    default: return String(status ?? "").toLowerCase();
  }
}

/**
 * The stock's write-up, read off the `writerRun` fact (get_theses: the newest
 * THESIS_WRITER run on the stock): a seed with no claim has none yet, and a
 * failed run is said with its date, so the morning run dispatches again
 * (step 12, part 1). Nothing silent.
 */
function writeUp(row: Row): { noClaim: boolean; failedOn: Date | null } {
  const w = obj(row.writerRun) as { status?: string; startedAt?: unknown } | null;
  return { noClaim: row.direction === null && !str(row.coreBelief), failedOn: w?.status === "FAILED" ? date(w.startedAt) : null };
}

/** When the research was written and at what price; how to get the whole thing. */
function researchLine(row: Row): string {
  const ago = (n: number) => `${n} day${n === 1 ? "" : "s"} ago`;
  const updatedAt = date(row.researchUpdatedAt);
  const updated = updatedAt ? isoDay(updatedAt) : null;
  const w = obj(row.researchWritten) as { on?: string; price?: number; daysAgo?: number } | null;
  const age = num(obj(row.researchAge)?.daysOld);
  const priceThen = num(row.researchPriceThen);
  const { noClaim, failedOn } = writeUp(row);
  let line: string;
  if (w?.on && num(w.price) != null) {
    // The writer's save gives the date and the price together; a later edit of a research field is said as an edit, never as the date of the writing.
    line = `Written ${w.on} at ${money(w.price!)}${num(w.daysAgo) != null ? `, ${ago(w.daysAgo!)}` : ""}${updated && updated > w.on ? `, edited ${updated}` : ""}.`;
  } else if (updated && !noClaim) {
    line = `Written ${updated}${priceThen != null ? ` at ${money(priceThen)}` : ""}${age != null ? `, ${ago(age)}` : ""}.`;
  } else if (noClaim) {
    line = failedOn ? `No write-up yet; the last write-up failed ${isoDay(failedOn)}.` : "No write-up yet.";
  } else {
    line = "No research written yet.";
  }
  if (failedOn && !noClaim) line += ` The newest write-up failed ${isoDay(failedOn)}.`;
  return line;
}

// ── The short row and the full row ─────────────────────────────────────────

type TriggerLine = { id?: string; says?: string; rationale?: string; lastFiredAt?: string; setBy?: string; level?: string; ownerSetAt?: string; was?: string };

/** Who set the trigger. The owner's says when and what it was before ("set by you Nov 12, was $850"), where the stock's Activity still shows the change. */
function whoSet(t: TriggerLine): string | null {
  const at = date(t.ownerSetAt);
  switch (t.setBy) {
    case "PRINCIPAL": return at ? `set by you ${at.toLocaleDateString("en-US", { ...ET, month: "short", day: "numeric" })}${t.was ? `, was ${t.was}` : ""}` : "set by hand";
    case "AGENT": return "set by the agent";
    case "DEFAULT": return "a default rule";
    default: return null;
  }
}

/**
 * Every rule on the stock as a sentence: the stock's own, each with its id
 * and the reason someone wrote (`writtenNote`; a template's is left off),
 * then the ones it inherits, marked. An inherited rule's
 * reason is the analyst's or the account's standing text and would repeat on
 * every stock of theirs, so it travels only on a rung that fired; so does its
 * id, which a run answering the fire names as trigger_id. An inherited rule
 * that has not fired carries no id: it is not the stock's to edit or remove
 * (PBH 09-23, no rules of its own, two runs named the account's for removal).
 */
function triggerLines(row: Row): string[] {
  const note = (t: TriggerLine) => {
    const written = writtenNote({ rationale: t.rationale, source: t.setBy });
    return written ? `"${stripSourceTags(written)}"` : null;
  };
  const own = list<TriggerLine>(row.triggers).map((t) => {
    const fired = date(t.lastFiredAt);
    return [t.says ?? "", fired ? `fired ${etStamp(fired)}` : null, whoSet(t), note(t)]
      .filter(Boolean)
      .join(" · ") + ` [id ${t.id}]`;
  });
  const inherited = list<TriggerLine>(row.inheritedTriggers).map((t) => {
    const fired = date(t.lastFiredAt);
    return [t.says ?? "", "inherited", fired ? `fired ${etStamp(fired)}` : null, fired ? note(t) : null]
      .filter(Boolean)
      .join(" · ") + (fired ? ` [id ${t.id}]` : "");
  });
  // A holding with nothing of its own beyond the floor, said as a fact.
  const bare = row.status !== "HOLDING" || row.beyondTheFloor !== 0 ? [] : own.length ? ["No holding trigger besides the floor."] : ["No trigger of its own."];
  return [...own, ...bare, ...inherited];
}

function positionLine(row: Row, price: number | null): string | null {
  const pos = obj(row.position);
  if (!pos || row.status !== "HOLDING") return null;
  const qty = num(pos.quantity);
  const avg = num(pos.avgCost);
  if (qty == null || avg == null) return null;
  const opened = date(pos.openedAt);
  const peak = num(pos.peakPrice);
  const parts = [`${qty} sh at ${money(avg)}`];
  if (price != null) parts[0] += ` → ${money(price)} (${pct(((price - avg) / avg) * 100)}), ${money0(qty * price)}`;
  if (opened) parts.push(`opened ${etDay(opened)}`);
  if (peak != null) parts.push(`high since we bought ${money(peak)}`);
  return parts.join("; ");
}

function proposalLine(row: Row): string | null {
  const props = list<{ side?: string; intent?: string | null; quantity?: number; createdAt?: unknown; expiresAt?: unknown }>(row.proposals);
  if (props.length === 0) return null;
  return props
    .map((p) => {
      const verb = p.side === "SELL" ? (p.intent === "PARTIAL_CLOSE" ? "trim" : "sell") : p.intent === "ADD" ? "add" : "buy";
      const placed = date(p.createdAt);
      const expires = date(p.expiresAt);
      return `${verb} ${num(p.quantity) ?? "?"} sh${placed ? `, placed ${etStamp(placed)}` : ""}${expires ? `, expires ${etStamp(expires)}` : ""}`;
    })
    .join("; ");
}

function priceLine(row: Row): string | null {
  const p = obj(row.price);
  const current = num(p?.current) ?? num(obj(row.resolved)?.currentPrice);
  if (current == null) return null;
  const dp = num(p?.dayChangePct);
  const at = date(p?.asOf);
  return `${money(current)}${dp != null ? `, ${pct(dp)} today` : ""}${at ? ` (${etStamp(at)})` : ""}`;
}

/** "outlook bullish" on the stock's line, or that a stock with a view has not been rated yet; nothing on a stock with no view. */
function outlookWord(row: Row): string | null {
  if (row.direction !== "LONG" && row.direction !== "SHORT") return null;
  const outlook = str(row.outlook);
  return outlook ? `outlook ${outlook.toLowerCase()}` : "outlook not rated yet";
}

/** A dated-event stock with no date: nothing to schedule around (step 12, part 3). */
const catalystDateMissing = (row: Row) => row.horizon === "CATALYST" && date(row.catalystDate) == null;

function setupLine(row: Row): string | null {
  const s = obj(row.setup) as { id?: string; name?: string; failureSigns?: string[] } | null;
  if (!s) return null;
  const parts = [[s.id, s.name].filter(Boolean).join(", ") + "."];
  if (s.failureSigns?.length) parts.push(`Failure looks like: ${s.failureSigns.join("; ")}.`);
  return parts.join(" ");
}


function chartLine(row: Row): string | null {
  const c = obj(row.chart) as Record<string, number | string | null> | null;
  if (!c) return null;
  const n = (k: string) => num(c[k]);
  const rs = [n("rsVsSpy1M") != null ? `1M ${pct(n("rsVsSpy1M")!)}` : null, n("rsVsSpy3M") != null ? `3M ${pct(n("rsVsSpy3M")!)}` : null].filter(Boolean);
  const parts = [
    n("sma20") != null ? `20d ${money(n("sma20")!)}` : null,
    n("sma50") != null ? `50d ${money(n("sma50")!)}` : null,
    n("sma200") != null ? `200d ${money(n("sma200")!)}` : null,
    n("rsi14") != null ? `RSI ${n("rsi14")} (14-day, from the closes and the live price)` : null,
    n("low20") != null && n("high20") != null ? `20d range ${money(n("low20")!)}–${money(n("high20")!)}` : null,
    n("high52w") != null ? `52w high ${money(n("high52w")!)}` : null,
    n("atr14") != null ? `ATR ${money(n("atr14")!)}` : null,
    rs.length ? `vs the S&P ${rs.join(" / ")}` : null,
    n("volumeAvg20") != null ? `20d avg volume ${n("volumeAvg20")! >= 1e6 ? `${(n("volumeAvg20")! / 1e6).toFixed(1)}M` : `${Math.round(n("volumeAvg20")! / 1e3)}K`}` : null,
    n("move5dPct") != null ? `5d ${pct(n("move5dPct")!)}` : null,
    n("move20dPct") != null ? `20d ${pct(n("move20dPct")!)}` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return `as of the ${str(c.asOf) ?? "last"} close: ${parts.join(" · ")}`;
}

function paperRecord(row: Row): string | null {
  if (row.status !== "PROMOTED") return null;
  const days = num(row.paperTenureDays);
  const pnl = num(row.paperRealizedPnl);
  const reviews = num(row.paperReviewCount);
  const parts = [days != null ? `held ${days} days on paper` : null, pnl != null ? `realized ${money(pnl)}` : null, reviews != null ? `${reviews} review${reviews === 1 ? "" : "s"}` : null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export interface RowField {
  key: string;
  /** What the field is, in plain words. */
  what: string;
  /** When it is included: always, a fact about the stock, or what the read asked for. */
  when: string;
  /** Set on a field that comes only when the read asks for it. */
  ask?: keyof RowAsk;
  read: (row: Row) => unknown;
}

const ALWAYS = "always";
const text = (v: unknown) => (str(v) ? stripSourceTags(v as string) : null);
const livePrice = (row: Row) => num(obj(row.price)?.current) ?? num(obj(row.resolved)?.currentPrice);
const bullets = (v: unknown) => strings(list<{ text?: unknown }>(obj(v)?.bullets).map((b) => b?.text));
const playbookLines = (row: Row) => strings(obj(row.setup)?.lines);

/** The row, field by field, in reading order. */
export const ROW_FIELDS: readonly RowField[] = [
  { key: "stock", what: "The ticker, held or watch, the direction, the playbook, the outlook and conviction", when: ALWAYS, read: (r) => [String(r.ticker), stance(r.status), str(r.direction) ?? "no view", str(r.setupId) ?? str(r.horizon), outlookWord(r), str(r.conviction) ? `conviction ${r.conviction}` : null].filter(Boolean).join(" · ") },
  { key: "company", what: "What the company does, in two sentences", when: ALWAYS, read: (r) => text(r.company) },
  { key: "id", what: "The thesis id a note or a trade names", when: ALWAYS, read: (r) => r.id },
  { key: "analyst", what: "The analyst that covers it", when: "the read covers more than one analyst", read: (r) => str(r.analyst) },
  { key: "situations", what: "Each situation it is in, by name", when: "it is in one", read: (r) => list<SituationCode>(r.situations).map((c) => `${c}${SITUATIONS[c] ? ` (${SITUATIONS[c].name})` : ""}`) },
  { key: "said", what: "Its Activity: the last 3 reviews, 3 news notes, 3 of the owner's notes and the owner's last decline, from the last 45 days", when: ALWAYS, read: (r) => str(r.context) },
  { key: "position", what: "The shares, what we paid, the gain, when it was bought and the high since", when: "it is held", read: (r) => positionLine(r, livePrice(r)) },
  { key: "proposal_waiting", what: "A trade on it that waits for the owner", when: "one waits", read: (r) => proposalLine(r) },
  { key: "price", what: "The price, the day's move and when it printed", when: ALWAYS, read: (r) => priceLine(r) },
  { key: "floor_risk", what: "How far the floor lags the gain, or how much of the account it would lose", when: "it is held and its floor is out of line with its gain", read: (r) => str(obj(obj(r.resolved)?.floorRisk)?.line) },
  { key: "triggers", what: "Every trigger as its sentence, the stock's own with their ids, then the ones it inherits", when: ALWAYS, read: (r) => triggerLines(r) },
  { key: "belief", what: "The belief", when: ALWAYS, read: (r) => text(r.coreBelief) },
  { key: "assumptions", what: "What must stay true", when: ALWAYS, read: (r) => strings(r.keyAssumptions) },
  { key: "would_prove_it_wrong", what: "What would prove the case wrong", when: ALWAYS, read: (r) => strings(r.invalidationConds) },
  { key: "bull_case", what: "The bull case", when: "the read asks for the research", ask: "research", read: (r) => bullets(r.bullCase) },
  { key: "bear_case", what: "The bear case", when: "the read asks for the research", ask: "research", read: (r) => bullets(r.bearCase) },
  { key: "conviction_rationale", what: "Why the conviction is what it is", when: ALWAYS, read: (r) => text(r.convictionRationale) },
  { key: "outlook_reason", what: "Why the outlook is what it is", when: ALWAYS, read: (r) => text(r.outlookReason) },
  { key: "variant_view", what: "Where we differ from Wall Street", when: ALWAYS, read: (r) => text(r.variantView) },
  { key: "playbook_checks", what: "What its playbook checks, and on a watch the triggers that come with the buy", when: "its playbook is named", read: (r) => playbookLines(r) },
  { key: "setup", what: "Its playbook's name and failure signs, in one line", when: "its playbook has no checks to list", read: (r) => (playbookLines(r).length ? null : setupLine(r)) },
  { key: "buyBlockedByFull", what: "Its buy can't go through: its analyst holds its limit of stocks", when: "it is watched, its buy fired and its analyst is full", read: (r) => r.buyBlockedByFull },
  { key: "heldThroughFloor", what: "The owner declined its sale or let it lapse: how often, their words, the low since", when: "it is held, that happened in the last 7 days and the price is still past the floor", read: (r) => r.heldThroughFloor },
  { key: "supersededBy", what: "The newer thesis that replaced it", when: "one did", read: (r) => obj(r.resolved)?.supersededBy },
  { key: "snapshot", what: "The research summary", when: "the read asks for the research", ask: "research", read: (r) => text(obj(r.snapshot)?.text ?? r.snapshot) },
  { key: "chart", what: "This morning's averages, range, RSI, strength against the S&P and volume", when: ALWAYS, read: (r) => chartLine(r) },
  { key: "street", what: "Wall Street's ratings, target range and EPS consensus", when: ALWAYS, read: (r) => streetLine(r) },
  { key: "research", what: "When the research was written and at what price", when: ALWAYS, read: (r) => researchLine(r) },
  { key: "catalyst", what: "Its event date", when: "its thesis has one, or its playbook needs one and it is missing", read: (r) => { const d = date(r.catalystDate); return d ? isoDay(d) : catalystDateMissing(r) ? "date missing" : null; } },
  { key: "repeat", what: "That the same trigger has fired again with nothing changed since", when: "it has", read: (r) => str(obj(r.needsAction)?.repeatLine) },
  { key: "paper_record", what: "Its record on paper: days held, the gain, the reviews", when: "it was promoted to live", read: (r) => paperRecord(r) },
  { key: "history", what: "The raw Activity log", when: "the read asks for the history", ask: "history", read: (r) => list(r.history) },
];

const empty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

/** One stock's row as the model reads it: every field of ROW_FIELDS that has something to say. */
export function rowForModel(row: Row, ask: RowAsk = {}): Row {
  const out: Row = {};
  for (const f of ROW_FIELDS) {
    if (f.ask && !ask[f.ask]) continue;
    const v = f.read(row);
    if (!empty(v)) out[f.key] = v;
  }
  return out;
}
