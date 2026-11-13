/**
 * row-for-model.ts — one row of get_theses as the model reads it (Roadmap
 * step 8, docs/plans/AGENT_ARCHITECTURE.md §11.5; the owner's grid,
 * 2026-11-06).
 *
 * A quiet stock is one line. A stock in a situation is the row, and the
 * situation decides which of its fields are sent (ROW_FIELDS): the standing
 * fields on every row (the chart numbers among them), the fields a
 * situation's decision reads with that situation (the Street on a buy, what
 * would prove us wrong on a sale signal), the whole case only when the review clock came
 * due, and the old research sections and the history only when the stock is
 * asked for by name. A row asked for with no situation named carries every
 * field (the "book" read). Code decides from the row's situations; nothing
 * depends on the model asking.
 *
 * The tool saves the whole row for the screen and the run; this builder
 * writes what the model reads, and each line explains itself, so no prompt
 * carries a glossary of the row. The screen's source citations
 * (`[STRUCTURED:…]`, `[WEB:…]`) are stripped from every text here. Pure: a
 * saved row or a recorded one (scripts/hero-cases) builds the same way.
 */
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";
import { stripCitationTags } from "@/lib/thesis/clean-text";
import { writtenNote } from "@/lib/agent/triggers/note";
import { streetLine } from "@/lib/market-data/street-consensus";

export type RowSize = "line" | "short" | "full";

/** The facts a full row has carried since step 8's first pull request; the builder reads them, the model never sees them raw. */
export const ROW_FACTS = ["position", "proposals", "price", "chart", "inheritedTriggers"] as const;

type Row = Record<string, unknown>;

/** Which size a listed row gets: the full row for a named read, the row otherwise; its situations pick the row's fields. */
export function sizeFor(_row: Row, named: boolean): RowSize {
  return named ? "full" : "short";
}

/**
 * When a row key is sent (the owner's grid, 2026-11-06):
 *   "always" — on every row in a situation;
 *   a list of situations — only when the stock is in one of them (each one's
 *   guidance in situations.ts names the key; row-for-model.by-situation.test.ts
 *   holds the two together);
 *   "review" — only when the review clock came due (REVIEW_DUE), which reads
 *   the whole case;
 *   "named" — only when the stock is asked for by name.
 * The review clock and a named read carry everything above them too.
 */
export type RowKeyRule = "always" | "review" | "named" | readonly SituationCode[];

export const ROW_FIELDS: Readonly<Record<string, RowKeyRule>> = {
  stock: "always",
  id: "always",
  analyst: "always",
  situations: "always",
  repeat: "always",
  said: "always",
  position: "always",
  proposal_waiting: "always",
  price: "always",
  triggers: "always",
  belief: "always",
  research: "always",
  note: "always",
  // This morning's averages, range, RSI and strength: every decision reads a level off them.
  chart: "always",
  // The facts a situation's text refers to, by name: each with its situation.
  plan_checks: ["BUY_ARRIVES", "BUY_BLOCKED_FULL", "PLAN_PROBLEM", "YOUR_WORD_UNANSWERED"],
  floor_risk: ["PROTECTIVE_SALE", "ADD_OR_WINNER", "PROTECTION"],
  buyBlockedByFull: ["BUY_BLOCKED_FULL"],
  heldThroughFloor: ["PROTECTIVE_SALE", "AUTO_TRADE"],
  supersededBy: ["PLAN_PROBLEM"],
  nameTheSetup: ["NO_SETUP_NAMED"],
  street: ["BUY_ARRIVES", "BUY_BLOCKED_FULL", "ADD_OR_WINNER", "PLAN_PROBLEM"],
  setup: ["BUY_ARRIVES", "BUY_BLOCKED_FULL", "NO_SETUP_NAMED"],
  setup_lines: ["BUY_ARRIVES", "BUY_BLOCKED_FULL", "NO_SETUP_NAMED"],
  assumptions: ["EARNINGS", "STALE_RESEARCH"],
  would_prove_it_wrong: ["PROTECTIVE_SALE", "AUTO_TRADE", "EARNINGS", "FILING", "STALE_RESEARCH", "PLAN_PROBLEM"],
  catalyst: ["BUY_ARRIVES", "ADD_OR_WINNER", "EARNINGS", "PLAN_PROBLEM"],
  paper_record: ["PROMOTED_AWAITING"],
  // The whole case: the review clock, and a named read.
  company: "review",
  bull_case: "review",
  bear_case: "review",
  conviction_rationale: ["PLAN_PROBLEM"],
  variant_view: ["BUY_ARRIVES", "BUY_BLOCKED_FULL"],
  snapshot: ["PLAN_PROBLEM"],
  // Only when asked for by name.
  recentCatalysts: "named",
  fundamentals: "named",
  latestEarnings: "named",
  catalystsAndEvents: "named",
  analystConsensus: "named",
  insiderTechnical: "named",
  researchData: "named",
  history: "named",
};

/** The situation that reads the whole case. */
export const REVIEW_SITUATION: SituationCode = "REVIEW_DUE";

/**
 * The keys a row sends: every key on a full row (the history only when
 * named); on the row, the keys the stock's situations call for, or every
 * short key when no situation is named (the "book" read, and a row built
 * with no situations).
 */
export function rowKeysFor(codes: readonly SituationCode[], opts: { size: "short" | "full"; named: boolean }): Set<string> {
  const keys = Object.keys(ROW_FIELDS);
  if (opts.size === "full") return new Set(keys.filter((k) => ROW_FIELDS[k] !== "named" || opts.named || k !== "history"));
  const short = keys.filter((k) => ROW_FIELDS[k] !== "named");
  if (codes.length === 0) return new Set(short);
  const review = codes.includes(REVIEW_SITUATION);
  return new Set(short.filter((k) => {
    const rule = ROW_FIELDS[k];
    if (rule === "always") return true;
    if (rule === "review") return review;
    return review || (rule as readonly SituationCode[]).some((c) => codes.includes(c));
  }));
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

/** The text's sentences up to `max` characters, never a cut word. */
function firstParagraph(text: string, max: number): string {
  const clean = stripSourceTags(text);
  if (clean.length <= max) return clean;
  let out = "";
  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  return out || clean.slice(0, max).replace(/\s+\S*$/, "");
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
function researchLine(row: Row, size: RowSize): string {
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
  return size === "full" ? line : `${line} Full row: get_theses(tickers: ["${String(row.ticker)}"]).`;
}

// ── The one line ───────────────────────────────────────────────────────────

/** A quiet stock: the stock and its stance, the price, the buy it waits on, the next review, the id. The levels are the triggers; a quiet row names none. */
function line(row: Row): string {
  const held = row.status === "HOLDING";
  const price = num(row.currentPrice);
  const entry = num(row.entryPrice);
  const review = date(row.reviewDueAt);
  const catalyst = date(row.catalystDate);
  const { noClaim, failedOn } = writeUp(row);
  return [
    String(row.ticker),
    stance(row.status),
    str(row.direction) ?? "no view",
    noClaim ? (failedOn ? `write-up failed ${etDay(failedOn)}` : "no write-up yet") : null,
    str(row.setupId) ?? str(row.horizon),
    price != null ? money(price) : null,
    entry != null ? `${held ? "entry" : "buy"} ${money(entry)}` : noPlan(row) ? "no plan" : null,
    // A trade waiting for the principal is off the work list, so its stock is often quiet: the line says it waits.
    proposalLine(row) ? `proposal waiting: ${proposalLine(row)}` : null,
    review ? `review ${etDay(review)}` : null,
    catalyst ? `catalyst ${isoDay(catalyst)}` : catalystDateMissing(row) ? "catalyst date missing" : null,
    `id ${String(row.id)}`,
    // An account-wide read names each stock's analyst, last.
    str(row.analyst),
  ].filter((x): x is string => x != null).join(" · ");
}

// ── The short row and the full row ─────────────────────────────────────────

type TriggerLine = { id?: string; says?: string; rationale?: string; lastFiredAt?: string; setBy?: string; level?: string };

function whoSet(setBy: string | undefined): string | null {
  switch (setBy) {
    case "PRINCIPAL": return "set by hand";
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
    return [t.says ?? "", fired ? `fired ${etStamp(fired)}` : null, whoSet(t.setBy), note(t)]
      .filter(Boolean)
      .join(" · ") + ` [id ${t.id}]`;
  });
  const inherited = list<TriggerLine>(row.inheritedTriggers).map((t) => {
    const fired = date(t.lastFiredAt);
    return [t.says ?? "", "inherited", fired ? `fired ${etStamp(fired)}` : null, fired ? note(t) : null]
      .filter(Boolean)
      .join(" · ") + (fired ? ` [id ${t.id}]` : "");
  });
  return [...own, ...inherited];
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

/** A watched stock with a view and no buy level: nothing to buy on (step 12, part 3). */
const noPlan = (row: Row) => row.status === "WATCHING" && str(row.direction) != null && num(row.entryPrice) == null;
/** A dated-event stock with no date: nothing to schedule around (step 12, part 3). */
const catalystDateMissing = (row: Row) => row.horizon === "CATALYST" && date(row.catalystDate) == null;

function setupLine(row: Row): string | null {
  const s = obj(row.setup) as { id?: string; name?: string; failureSigns?: string[]; manage?: string | null; time?: string | null } | null;
  if (!s) return null;
  const parts = [[s.id, s.name].filter(Boolean).join(", ") + "."];
  if (s.failureSigns?.length) parts.push(`Failure looks like: ${s.failureSigns.join("; ")}.`);
  if (s.manage) parts.push(`Manage: ${s.manage}`);
  if (s.time) parts.push(`Time: ${s.time}`);
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

/**
 * The lower-priority research sections a read loads with include_research,
 * under their own names. The full row carries the ones a row has, as text
 * with the screen's citations removed; the short row and the one line never do.
 */
const RESEARCH_SECTIONS = ["recentCatalysts", "fundamentals", "latestEarnings", "catalystsAndEvents", "analystConsensus", "insiderTechnical", "researchData"] as const;

/** A research section as text: a paragraph, a list of bullets, or a plain string; citations dropped, tags stripped. */
function sectionText(v: unknown): string | string[] | null {
  if (typeof v === "string") return str(v) ? stripSourceTags(v) : null;
  const o = obj(v);
  if (!o) return null;
  if (Array.isArray(o.bullets)) {
    const bullets = strings(list<{ text?: unknown }>(o.bullets).map((b) => (typeof b === "string" ? b : b?.text)));
    return bullets.length ? bullets : null;
  }
  return str(o.text) ? stripSourceTags(o.text as string) : null;
}

/** The short row, and the full row when `size` is "full". Keys in reading order; a line with nothing to say is left out. */
function shortOrFull(row: Row, size: "short" | "full", named: boolean, setupLinesOn = false): Row {
  const held = row.status === "HOLDING";
  const price = num(obj(row.price)?.current) ?? num(obj(row.resolved)?.currentPrice);
  const resolved = obj(row.resolved);
  const codes = list<SituationCode>(row.situations);
  const snapshot = str(obj(row.snapshot)?.text) ?? str(row.snapshot);
  const out: Row = {};
  const sent = rowKeysFor(codes, { size, named });
  const put = (k: string, v: unknown) => { if (sent.has(k) && v != null && v !== "" && !(Array.isArray(v) && v.length === 0)) out[k] = v; };

  put("stock", [String(row.ticker), stance(row.status), str(row.direction) ?? "no view", str(row.setupId) ?? str(row.horizon), str(row.conviction) ? `conviction ${row.conviction}` : null].filter(Boolean).join(" · "));
  // What the company does and how it makes money, in two sentences: the Writer's, on every stock written up from 2026-11-03.
  put("company", str(row.company) ? stripSourceTags(row.company as string) : null);
  put("id", row.id);
  // An account-wide read names each stock's analyst.
  put("analyst", str(row.analyst));
  put("situations", codes.map((c) => `${c}${SITUATIONS[c] ? ` (${SITUATIONS[c].name})` : ""}`));
  put("said", str(row.context));
  put("position", positionLine(row, price));
  put("proposal_waiting", proposalLine(row));
  put("price", priceLine(row));
  // The levels are the triggers (`triggers`, each with its id): no plan line and no protection line restate them.
  put("plan_checks", list<{ text?: string }>(resolved?.planSanity).map((f) => f.text).filter(Boolean));
  put("floor_risk", str(obj(resolved?.floorRisk)?.line));
  put("triggers", triggerLines(row));
  put("belief", str(row.coreBelief) ? stripSourceTags(row.coreBelief as string) : null);
  put("assumptions", strings(row.keyAssumptions));
  put("would_prove_it_wrong", strings(row.invalidationConds));
  // The whole view, on every row an agent decides from (short and full).
  put("bull_case", strings(list<{ text?: unknown }>(obj(row.bullCase)?.bullets).map((b) => b?.text)));
  put("bear_case", strings(list<{ text?: unknown }>(obj(row.bearCase)?.bullets).map((b) => b?.text)));
  put("conviction_rationale", str(row.convictionRationale) ? stripSourceTags(row.convictionRationale as string) : null);
  put("variant_view", str(row.variantView) ? stripSourceTags(row.variantView as string) : null);
  // The lines a fire checks for the stock's horizon (setupLines' decision cut), in place of the compact line: on the full row, and on the trigger run's row (whatever its situation).
  const lines = size === "full" || setupLinesOn ? strings(obj(row.setup)?.lines) : [];
  if (lines.length) { if (setupLinesOn) sent.add("setup_lines"); put("setup_lines", lines); }
  else put("setup", setupLine(row));
  // The facts a situation's text refers to, by the names it uses.
  put("nameTheSetup", row.nameTheSetup);
  put("buyBlockedByFull", row.buyBlockedByFull);
  put("heldThroughFloor", row.heldThroughFloor);
  put("supersededBy", resolved?.supersededBy);
  put("snapshot", snapshot ? (size === "full" ? stripSourceTags(snapshot) : firstParagraph(snapshot, 300)) : null);
  if (size === "full") {
    for (const k of RESEARCH_SECTIONS) put(k, sectionText(row[k]));
  }
  put("chart", chartLine(row));
  put("street", streetLine(row));
  put("research", researchLine(row, size));
  const catalyst = date(row.catalystDate);
  put("catalyst", catalyst ? isoDay(catalyst) : catalystDateMissing(row) ? "date missing" : null);
  put("repeat", str(obj(row.needsAction)?.repeatLine));
  // The conviction rule, on the row it applies to.
  if (held && row.conviction === "LOW") put("note", "Conviction is LOW: tighten the floor on this review.");
  put("paper_record", paperRecord(row));
  if (size === "full" && named) put("history", list(row.history));
  return out;
}

/**
 * One row as the model reads it. A quiet row builds the one line; a listed
 * row builds the row with the fields its situations call for (ROW_FIELDS),
 * or the full row for a named read (`sizeFor`). The screen and a saved run
 * keep the whole row.
 *
 * `setupLines` is the trigger run's door (step 10): its stock is the short
 * row with the lines a fire checks for the stock's horizon (`setup_lines`,
 * setupLines' decision cut) in place of the compact setup line. Every other
 * short row is unchanged; the full row always carries them.
 */
export function rowForModel(row: Row, opts: { named: boolean; size: RowSize; setupLines?: boolean }): string | Row {
  return opts.size === "line" ? line(row) : shortOrFull(row, opts.size, opts.named, opts.setupLines);
}
