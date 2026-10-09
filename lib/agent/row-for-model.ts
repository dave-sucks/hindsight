/**
 * row-for-model.ts — one row of get_theses as the model reads it, in one of
 * three sizes (Roadmap step 8, docs/plans/AGENT_ARCHITECTURE.md §11.5).
 *
 * A quiet stock is one line. A stock in a situation is the short row: about
 * eighteen lines, each a plain label with a value in units, no research
 * essays. The full row comes by ticker or by rule, for the two situations
 * whose answer needs the research re-planned (QUIET_WATCH_WOKE,
 * NO_SETUP_NAMED): the short row plus the bull and bear cases, the
 * conviction rationale, the variant view, the score notes and the whole
 * snapshot. Code decides the size from the row's situations; nothing
 * depends on the model asking.
 *
 * The tool saves the whole row for the screen and the run; this builder
 * writes what the model reads, and each line explains itself, so no prompt
 * carries a glossary of the row. The screen's source citations
 * (`[STRUCTURED:…]`, `[WEB:…]`) are stripped from every text here. Pure: a
 * saved row or a recorded one (scripts/hero-cases) builds the same way.
 */
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";

export type RowSize = "line" | "short" | "full";

/** The facts a full row has carried since step 8's first pull request; the builder reads them, the model never sees them raw. */
export const ROW_FACTS = ["position", "proposals", "price", "chart", "inheritedTriggers"] as const;

/** The situations whose definition says the decision needs the research: the full row by rule. */
export const FULL_ROW_SITUATIONS: ReadonlySet<SituationCode> = new Set(["QUIET_WATCH_WOKE", "NO_SETUP_NAMED"]);

type Row = Record<string, unknown>;

/** Which size a listed row gets: the full row for a named read or by rule, the short row otherwise. */
export function sizeFor(row: Row, named: boolean): RowSize {
  if (named) return "full";
  const codes = Array.isArray(row.situations) ? (row.situations as SituationCode[]) : [];
  return codes.some((c) => FULL_ROW_SITUATIONS.has(c)) ? "full" : "short";
}

/** The screen's citations and markdown bold, off a text the model reads. */
export function stripSourceTags(s: string): string {
  return s.replace(/\s*\[(STRUCTURED|WEB)[^\]]*\]/g, "").replace(/\*\*/g, "").replace(/[ \t]{2,}/g, " ").trim();
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

/** When the research was written and at what price; how to get the whole thing. */
function researchLine(row: Row, size: RowSize): string {
  const ago = (n: number) => `${n} day${n === 1 ? "" : "s"} ago`;
  const updatedAt = date(row.researchUpdatedAt);
  const updated = updatedAt ? isoDay(updatedAt) : null;
  const w = obj(row.researchWritten) as { on?: string; price?: number; daysAgo?: number } | null;
  const age = num(obj(row.researchAge)?.daysOld);
  const priceThen = num(row.researchPriceThen);
  let line: string;
  if (w?.on && num(w.price) != null) {
    // The writer's save gives the date and the price together; a later edit of a research field is said as an edit, never as the date of the writing.
    line = `Written ${w.on} at ${money(w.price!)}${num(w.daysAgo) != null ? `, ${ago(w.daysAgo!)}` : ""}${updated && updated > w.on ? `, edited ${updated}` : ""}.`;
  } else if (updated) {
    line = `Written ${updated}${priceThen != null ? ` at ${money(priceThen)}` : ""}${age != null ? `, ${ago(age)}` : ""}.`;
  } else {
    line = "No research written yet.";
  }
  return size === "full" ? line : `${line} Full row: get_theses(tickers: ["${String(row.ticker)}"]).`;
}

// ── The one line ───────────────────────────────────────────────────────────

/** A quiet stock: the stock and its stance, the price, the plan levels, the next review, the score, the id. */
function line(row: Row): string {
  const held = row.status === "HOLDING";
  const price = num(row.currentPrice);
  const entry = num(row.entryPrice);
  const target = num(row.targetPrice);
  const floor = num(row.stopLoss);
  const review = date(row.reviewDueAt);
  const score = num(row.composite);
  const catalyst = date(row.catalystDate);
  return [
    String(row.ticker),
    stance(row.status),
    str(row.direction) ?? "no view",
    str(row.setupId) ?? str(row.horizon),
    price != null ? money(price) : null,
    entry != null ? `${held ? "entry" : "buy"} ${money(entry)}` : null,
    target != null ? `target ${money(target)}` : null,
    floor != null ? `floor ${money(floor)}` : null,
    review ? `review ${etDay(review)}` : null,
    score != null ? `score ${score}` : null,
    catalyst ? `catalyst ${isoDay(catalyst)}` : null,
    `id ${String(row.id)}`,
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
 * Every rule on the stock as a sentence: the stock's own, each with its
 * reason and its id, then the ones it inherits, marked. An inherited rule's
 * reason is the analyst's or the account's standing text and would repeat on
 * every stock of theirs, so it travels only on a rung that fired; so does its
 * id, which a run answering the fire names as trigger_id. An inherited rule
 * that has not fired carries no id: it is not the stock's to edit or remove
 * (PBH 09-23, no rules of its own, two runs named the account's for removal).
 */
function triggerLines(row: Row): string[] {
  const own = list<TriggerLine>(row.triggers).map((t) => {
    const fired = date(t.lastFiredAt);
    return [t.says ?? "", fired ? `fired ${etStamp(fired)}` : null, whoSet(t.setBy), t.rationale ? `"${stripSourceTags(t.rationale)}"` : null]
      .filter(Boolean)
      .join(" · ") + ` [id ${t.id}]`;
  });
  const inherited = list<TriggerLine>(row.inheritedTriggers).map((t) => {
    const fired = date(t.lastFiredAt);
    return [t.says ?? "", "inherited", fired ? `fired ${etStamp(fired)}` : null, fired && t.rationale ? `"${stripSourceTags(t.rationale)}"` : null]
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

function planLine(row: Row): string | null {
  const held = row.status === "HOLDING";
  const entry = num(row.entryPrice);
  const avg = num(obj(row.position)?.avgCost);
  const target = num(row.targetPrice);
  const floor = num(row.stopLoss);
  const progress = held ? num(obj(row.resolved)?.progressToTarget) : null;
  const parts = [
    held && (avg ?? entry) != null ? `entry ${money((avg ?? entry)!)} (filled)` : !held && entry != null ? `buy ${money(entry)}` : null,
    target != null ? `target ${money(target)}` : null,
    floor != null ? `floor ${money(floor)}` : null,
    progress != null ? `${Math.round(progress * 100)}% of the way to the target` : null,
  ].filter((x): x is string => x != null);
  return parts.length ? parts.join(" · ") : null;
}

function protectionLine(row: Row, price: number | null): string | null {
  if (row.status !== "HOLDING") return null;
  const lh = obj(obj(row.resolved)?.ladderHealth) as { summary?: string; floor?: { price?: number } | null; flooredGainPct?: number | null; hasTrail?: boolean; nearestRung?: { action?: string; label?: string; price?: number; distancePct?: number } | null; daysSinceLadderEdit?: number | null } | null;
  if (!lh) return null;
  const floor = num(lh.floor?.price);
  const short = row.direction === "SHORT";
  const breached = floor != null && price != null && (short ? price >= floor : price <= floor);
  if (!breached) return str(lh.summary);
  const rung = lh.nearestRung;
  return [
    `floor ${money(floor!)} is breached (price ${money(price!)}, ${pct((price! / floor! - 1) * 100)})`,
    num(lh.flooredGainPct) != null ? `it would lock ${pct(lh.flooredGainPct!)}` : null,
    lh.hasTrail ? "trail on" : "no trail",
    rung && num(rung.price) != null ? `next rung ${rung.action ?? ""} at ${money(rung.price!)}${num(rung.distancePct) != null ? ` (${pct(rung.distancePct!)} away)` : ""}`.replace(/\s+/g, " ") : null,
    num(lh.daysSinceLadderEdit) != null ? `ladder last edited ${lh.daysSinceLadderEdit}d ago` : null,
  ].filter(Boolean).join("; ");
}

function setupLine(row: Row): string | null {
  const s = obj(row.setup) as { id?: string; name?: string; failureSigns?: string[]; manage?: string | null; time?: string | null } | null;
  if (!s) return null;
  const parts = [[s.id, s.name].filter(Boolean).join(", ") + "."];
  if (s.failureSigns?.length) parts.push(`Failure looks like: ${s.failureSigns.join("; ")}.`);
  if (s.manage) parts.push(`Manage: ${s.manage}`);
  if (s.time) parts.push(`Time: ${s.time}`);
  return parts.join(" ");
}

const SCORE_PARTS: Array<[key: string, label: string]> = [["entryQuality", "entry"], ["trendStrength", "trend"], ["relativeStrength", "relative strength"], ["catalystFreshness", "catalyst"]];

function scoreLine(row: Row): string | null {
  const s = obj(row.scoring);
  const composite = num(s?.composite);
  if (composite == null) return null;
  const parts = SCORE_PARTS.map(([k, label]) => { const v = num(obj(s?.[k])?.score); return v != null ? `${label} ${v}` : null; });
  return parts.every(Boolean) ? `${composite}/10 (${parts.join(" · ")})` : `${composite}/10`;
}

function scoreNotes(row: Row): Record<string, string> | null {
  const s = obj(row.scoring);
  const out: Record<string, string> = {};
  for (const [k, label] of SCORE_PARTS) { const note = str(obj(s?.[k])?.note); if (note) out[label.replace(" ", "_")] = stripSourceTags(note); }
  return Object.keys(out).length ? out : null;
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
  const put = (k: string, v: unknown) => { if (v != null && v !== "" && !(Array.isArray(v) && v.length === 0)) out[k] = v; };

  put("stock", [String(row.ticker), stance(row.status), str(row.direction) ?? "no view", str(row.setupId) ?? str(row.horizon), str(row.conviction) ? `conviction ${row.conviction}` : null].filter(Boolean).join(" · "));
  put("id", row.id);
  put("situations", codes.map((c) => `${c}${SITUATIONS[c] ? ` (${SITUATIONS[c].name})` : ""}`));
  put("said", str(row.context));
  put("position", positionLine(row, price));
  put("proposal_waiting", proposalLine(row));
  put("price", priceLine(row));
  put("plan", planLine(row));
  put("plan_checks", list<{ text?: string }>(resolved?.planSanity).map((f) => f.text).filter(Boolean));
  put("protection", protectionLine(row, price));
  put("floor_risk", str(obj(resolved?.floorRisk)?.line));
  put("triggers", triggerLines(row));
  put("belief", str(row.coreBelief) ? stripSourceTags(row.coreBelief as string) : null);
  put("assumptions", strings(row.keyAssumptions));
  put("would_prove_it_wrong", strings(row.invalidationConds));
  // The setup's every decision line for the stock's horizon (setupLines), in place of the compact line: on the full row, and on the trigger run's short row.
  const lines = size === "full" || setupLinesOn ? strings(obj(row.setup)?.lines) : [];
  if (lines.length) put("setup_lines", lines);
  else put("setup", setupLine(row));
  // The facts a situation's text refers to, by the names it uses.
  put("nameTheSetup", row.nameTheSetup);
  put("buyBlockedByFull", row.buyBlockedByFull);
  put("heldThroughFloor", row.heldThroughFloor);
  put("supersededBy", resolved?.supersededBy);
  put("snapshot", snapshot ? (size === "full" ? stripSourceTags(snapshot) : firstParagraph(snapshot, 300)) : null);
  put("score", scoreLine(row));
  if (size === "full") {
    put("score_notes", scoreNotes(row));
    put("bull_case", strings(list<{ text?: unknown }>(obj(row.bullCase)?.bullets).map((b) => b?.text)));
    put("bear_case", strings(list<{ text?: unknown }>(obj(row.bearCase)?.bullets).map((b) => b?.text)));
    put("conviction_rationale", str(row.convictionRationale) ? stripSourceTags(row.convictionRationale as string) : null);
    put("variant_view", str(row.variantView) ? stripSourceTags(row.variantView as string) : null);
    for (const k of RESEARCH_SECTIONS) put(k, sectionText(row[k]));
  }
  put("chart", chartLine(row));
  put("research", researchLine(row, size));
  const catalyst = date(row.catalystDate);
  put("catalyst", catalyst ? isoDay(catalyst) : null);
  put("repeat", str(obj(row.needsAction)?.repeatLine));
  // The conviction rule, on the row it applies to.
  if (held && row.conviction === "LOW") put("note", "Conviction is LOW: tighten the floor on this review.");
  put("paper_record", paperRecord(row));
  if (size === "full" && named) put("history", list(row.history));
  return out;
}

/**
 * One row as the model reads it. A quiet row builds the one line; a listed
 * row builds the short row, or the full row for a named read or by rule
 * (`sizeFor`). The screen and a saved run keep the whole row.
 *
 * `setupLines` is the trigger run's door (step 10): its stock is the short
 * row with the setup's decision lines for the stock's horizon (`setup_lines`)
 * in place of the compact setup line. Every other short row is unchanged; the
 * full row always carries them.
 */
export function rowForModel(row: Row, opts: { named: boolean; size: RowSize; setupLines?: boolean }): string | Row {
  return opts.size === "line" ? line(row) : shortOrFull(row, opts.size, opts.named, opts.setupLines);
}
