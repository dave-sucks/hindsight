/**
 * stock-brief.ts — the one way an agent reads a stock
 * (docs/plans/AGENT_ARCHITECTURE.md, 10.3).
 *
 * `get_theses` gathers a stock's facts: the thesis row, its triggers, the
 * position, the live price, the flags (`needs-action.ts`, `plan-sanity.ts`,
 * `ladder-health.ts`, `floor-risk.ts`) and what's been said
 * (`stock-context.ts`). That row is what the screen shows and what a saved
 * run keeps. This file turns it into what the model reads, and nothing else
 * does:
 *
 *  - `stockBrief`: a stock with work today, in full. The morning run and
 *    the chat read it in `get_theses`; the trigger run reads it in its
 *    kickoff.
 *  - `stockLine`: one line per stock — a quiet stock in the morning read,
 *    a row of `list_theses_all`, the stock behind a proposal.
 *
 * Pure: no database, no clock. The same facts give the same bytes, so a
 * case rebuilt from a recorded row reads the same every time. A recorded
 * row from before this file is read as it is: anything it lacks is left
 * out, never guessed.
 *
 * Every field below has a reader (the table is in the PR that added this
 * file). A field nothing reads is not sent: the thesis bookkeeping columns,
 * the timestamps, the per-dimension score notes, the conviction rationale,
 * the resolver's trigger state and default labels, the research citations
 * and the source markers inside the text (the screen keeps both).
 */

import { triggerForAgent } from "@/lib/agent/triggers/format";
import { riskReward } from "@/lib/agent/thesis-shape";
import { etStamp } from "@/lib/agent/stock-context";
import { getSectionBullets, getSectionText } from "@/lib/agent/thesis-narrative";
import { NO_SETUP_FITS } from "@/lib/agent/knowledge/setups";
import { playbooksForRow } from "@/lib/agent/playbooks";

type Obj = Record<string, unknown>;

/** A stock's facts as `get_theses` records them. Dates are Dates live and ISO strings when read back from a saved run. */
export interface StockRow {
  id: string;
  ticker: string;
  status: string;
  direction: string | null;
  horizon?: string | null;
  coreBelief?: string | null;
  keyAssumptions?: string[];
  invalidationConds?: string[];
  entryPrice?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  catalystDate?: Date | string | null;
  conviction?: string | null;
  variantView?: string | null;
  scoring?: unknown;
  snapshot?: unknown;
  bullCase?: unknown;
  bearCase?: unknown;
  /** The stock's own triggers, as stored (or, on rows saved before the brief, already worded). */
  triggers?: unknown[];
  /** The analyst's and the account's triggers that also apply to this stock. */
  inheritedTriggers?: unknown[];
  context?: string | null;
  needsAction?: Obj | null;
  resolved?: Obj | null;
  setup?: Obj | null;
  nameTheSetup?: Obj | null;
  buyBlockedByFull?: string | null;
  researchAge?: { daysOld?: number | null; freshness?: string; horizonThreshold?: number | null } | null;
  researchUpdatedAt?: Date | string | null;
  researchPriceThen?: number | null;
  /** The newest save that changed the score, when the activity read reached it. */
  scoredAt?: { at: Date | string; price: number | null } | null;
  unapprovedExitCount?: number;
  heldThroughFloor?: Obj | null;
  /** The open position on a held stock. */
  position?: { quantity: number; avgCost: number; openedAt: Date | string | null; peakPrice: number | null } | null;
  history?: unknown[];
  [k: string]: unknown;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const round = (n: number, places: number) => Number(n.toFixed(places));
const isDate = (v: unknown): v is Date | string => v instanceof Date || (typeof v === "string" && !Number.isNaN(Date.parse(v)));
const asDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));
const day = (v: Date | string) => asDate(v).toISOString().slice(0, 10);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** ISO timestamps on a flag, as the Eastern stamps everything else uses. */
function stamped(o: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) out[k] = etStamp(new Date(v));
    else if (v instanceof Date) out[k] = etStamp(v);
    else if (Array.isArray(v)) out[k] = v.map((x) => (x && typeof x === "object" ? stamped(x as Obj) : x));
    else out[k] = v;
  }
  return out;
}

/** "$39.96 (10-02 11:15)": the price and when it printed, Eastern. */
export function priceLine(resolved: Obj | null | undefined): string {
  const price = num(resolved?.currentPrice);
  if (price == null) return "no live price";
  const age = num(resolved?.quoteAgeMs);
  const at = typeof resolved?.resolvedAt === "string" ? Date.parse(resolved.resolvedAt) : NaN;
  return age != null && Number.isFinite(at) ? `${money(price)} (${etStamp(new Date(at - age))})` : money(price);
}

/** "buy $67.00 (4.6% under the price)" for each level the plan has, and what it pays from the buy. */
export function planLine(row: Pick<StockRow, "direction" | "entryPrice" | "targetPrice" | "stopLoss">, price: number | null): string | null {
  const levels: Array<[string, number | null]> = [
    ["buy", num(row.entryPrice)],
    ["target", num(row.targetPrice)],
    ["floor", num(row.stopLoss)],
  ];
  const parts = levels
    .filter((l): l is [string, number] => l[1] != null)
    .map(([name, level]) => {
      if (price == null || price <= 0) return `${name} ${money(level)}`;
      const pct = ((level - price) / price) * 100;
      return `${name} ${money(level)} (${Math.abs(pct).toFixed(1)}% ${pct >= 0 ? "over" : "under"} the price)`;
    });
  if (!parts.length) return null;
  const e = num(row.entryPrice), t = num(row.targetPrice), s = num(row.stopLoss);
  const rr = (row.direction === "LONG" || row.direction === "SHORT") && e != null && t != null && s != null ? riskReward(row.direction, e, t, s) : null;
  return `${parts.join(" · ")}${rr != null ? `; pays ${rr.toFixed(1)}:1 from the buy` : ""}`;
}

const DIMENSIONS: Array<[string, string, number]> = [
  ["trendStrength", "trend", 3],
  ["relativeStrength", "relative strength", 3],
  ["entryQuality", "entry", 2],
  ["catalystFreshness", "catalyst", 2],
];

/** "7/10 — trend 2/3, relative strength 2/3, entry 1/2, catalyst 2/2; scored 2026-09-02 at $369.41". */
export function scoreLine(row: Pick<StockRow, "scoring" | "scoredAt" | "researchUpdatedAt" | "researchPriceThen">): string | null {
  const s = row.scoring && typeof row.scoring === "object" ? (row.scoring as Obj) : null;
  const composite = num(s?.composite);
  if (s == null || composite == null) return null;
  const dims = DIMENSIONS.map(([key, word, max]) => {
    const score = num((s[key] as Obj | undefined)?.score);
    return score == null ? null : `${word} ${score}/${max}`;
  }).filter(Boolean);
  const at = row.scoredAt?.at ?? row.researchUpdatedAt ?? null;
  const price = row.scoredAt ? row.scoredAt.price : row.researchPriceThen ?? null;
  const when = at && isDate(at) ? `; scored ${day(at)}${price != null ? ` at ${money(price)}` : ""}` : "";
  return `${composite}/10${dims.length ? ` — ${dims.join(", ")}` : ""}${when}`;
}

/** "Written 2026-09-02 at $369.41, 35 days ago." */
export function researchLine(row: Pick<StockRow, "researchUpdatedAt" | "researchPriceThen" | "researchAge">): string {
  const written = row.researchUpdatedAt && isDate(row.researchUpdatedAt) ? day(row.researchUpdatedAt) : null;
  const age = row.researchAge?.daysOld;
  // A row recorded with only the research's age says that much.
  if (!written) return age != null ? `Written ${age} days ago.` : "No research written yet.";
  const price = num(row.researchPriceThen);
  return `Written ${written}${price != null ? ` at ${money(price)}` : ""}${age != null ? `, ${age} days ago` : ""}.`;
}

/** The writer's source markers inside the text — "[WEB:https://…]", "[STRUCTURED:eps_q3]". The screen renders them; the model is not sent them. */
const SOURCE_MARKER = /\s?\[(?:WEB|STRUCTURED):[^\]]*\]/g;
const unmarked = (text: string) => text.replace(SOURCE_MARKER, "");

/** A setup's checklist without the parts it doesn't have. */
function setupEntry(setup: Obj): Obj {
  return Object.fromEntries(Object.entries(setup).filter(([, v]) => v != null && v !== false && !(Array.isArray(v) && v.length === 0)));
}

/** A trigger as the brief lists it: its sentence and id, why it was set, and who set it when that was the principal. */
function triggerEntry(t: unknown, sells: boolean, setOn?: string): Obj | null {
  if (!t || typeof t !== "object") return null;
  const x = t as Obj;
  if (typeof x.id !== "string") return null;
  // A row saved before the brief already carries the worded trigger.
  const worded = typeof x.says === "string" ? x : triggerForAgent(x as never, sells);
  return {
    id: worded.id,
    says: worded.says,
    ...(setOn ? { setOn } : worded.rationale ? { rationale: worded.rationale } : {}),
    ...(worded.firesDirectly ? { firesDirectly: true } : {}),
    ...(worded.setBy === "PRINCIPAL" ? { setBy: "PRINCIPAL" } : {}),
  };
}

const LEVEL_WORDS: Record<string, string> = { ANALYST: "analyst", ACCOUNT: "account" };

/** A flag's trigger in the words the trigger list uses, when the row has that trigger as stored. */
function worded(flag: Obj, row: StockRow): Obj {
  const all = [...(row.triggers ?? []), ...(row.inheritedTriggers ?? [])] as Obj[];
  const says = (id: unknown): string | null => {
    const t = all.find((x) => x && x.id === id && x.predicate != null);
    return t ? String(triggerForAgent(t as never, row.status === "HOLDING").says) : null;
  };
  const out: Obj = { ...flag };
  if (typeof out.summary === "string") out.summary = says(out.triggerId) ?? out.summary;
  if (typeof out.predicateSummary === "string") out.predicateSummary = says(out.triggerId) ?? out.predicateSummary;
  if (Array.isArray(out.alsoFired)) out.alsoFired = (out.alsoFired as Obj[]).map((f) => ({ ...f, summary: says(f.triggerId) ?? f.summary }));
  return out;
}

/**
 * Everything on the row that puts the stock on today's list, in the order
 * the code ranks it: the lead flag first (`needs-action.ts` ranks it), then
 * the rest. A flag that only repeats the lead is left out.
 */
function situations(row: StockRow, withPlaybooks: boolean): Obj {
  const out: Obj = {};
  const r = row.resolved ?? {};
  const lead = row.needsAction ?? null;
  const leadKind = typeof lead?.kind === "string" ? lead.kind : null;
  // The playbooks for its situations; the read carries each one's text once.
  const playbooks = withPlaybooks ? playbooksForRow(row) : [];
  if (playbooks.length) out.playbooks = playbooks;
  if (lead) out.needsAction = stamped(worded(lead, row));
  const floor = r.floorRisk as Obj | null | undefined;
  if (floor && leadKind !== "FLOOR_TOO_FAR") out.floorRisk = floor.line ?? floor;
  if (row.heldThroughFloor && leadKind !== "SALE_DECLINED") out.heldThroughFloor = row.heldThroughFloor;
  const flags = r.planSanity as Array<Obj> | null | undefined;
  if (flags?.length) out.planSanity = flags.map((f) => ({ kind: f.kind, text: f.text }));
  if (row.buyBlockedByFull) out.buyBlockedByFull = row.buyBlockedByFull;
  if (row.nameTheSetup) out.nameTheSetup = row.nameTheSetup;
  const age = row.researchAge;
  if (age && (age.freshness === "stale" || age.freshness === "missing") && leadKind !== "RESEARCH_STALE" && row.direction != null) {
    out.researchAge = { daysOld: age.daysOld ?? null, threshold: age.horizonThreshold ?? null, freshness: age.freshness };
  }
  // The resolver's labels that say something the flags don't: a buy level
  // the price has reached, a catalyst date gone by, a newer thesis that
  // ended this one. Its defaults (holding, waiting) say nothing.
  const actionability = typeof r.actionability === "string" ? r.actionability : null;
  if (actionability === "ENTER_NOW" || actionability === "STALE_PAST_CATALYST") out.actionability = actionability;
  if (actionability === "SUPERSEDED") {
    out.actionability = actionability;
    if (r.supersededBy) out.supersededBy = r.supersededBy;
  }
  return out;
}

/** The research sections a read asks for with include_research, as stored. */
const MORE_RESEARCH = ["researchData", "recentCatalysts", "fundamentals", "latestEarnings", "catalystsAndEvents", "analystConsensus", "insiderTechnical"];

/**
 * A stock with work today, in full: who it is and the price; why it is on
 * the list; what's been said; the plan; the triggers; the belief; the score;
 * the setup; the research. History only on a read of named stocks; the
 * score's notes and the rest of the research only when asked for.
 *
 * `playbooks: false` leaves out the playbook keys, for a reader that carries
 * its playbooks some other way (the trigger run's kickoff: the ones for what
 * fired). `inherited` adds the analyst's and the account's triggers that apply to
 * the stock. A read of one stock wants them (the trigger run); a read of the
 * book would repeat the same rules on every row, and the setup's manage line
 * and `ladderHealth` already say what protects a holding.
 */
export function stockBrief(row: StockRow, opts: { named: boolean; research?: boolean; inherited?: boolean; playbooks?: boolean }): Obj {
  const r = row.resolved ?? {};
  const price = num(r.currentPrice);
  const held = row.status === "HOLDING";
  const out: Obj = {
    id: row.id,
    ticker: row.ticker,
    status: row.status,
    direction: row.direction,
    ...(row.horizon ? { horizon: row.horizon } : {}),
    price: priceLine(r),
    ...situations(row, opts.playbooks !== false),
  };
  if (row.context) out.context = row.context;
  // A thesis that ended (a read of RETIRED or PASSED): when, and why.
  if (row.status !== "HOLDING" && row.status !== "WATCHING" && row.status !== "PROMOTED") {
    for (const k of ["closedAt", "invalidatedAt"]) if (row[k] && isDate(row[k])) out[k] = day(row[k] as Date | string);
    for (const k of ["closeReason", "invalidReason", "parentThesisId"]) if (row[k]) out[k] = row[k];
  }

  const plan = planLine(row, price);
  if (plan) out.plan = plan;
  if (held) {
    const p = row.position;
    if (p) out.position = `${p.quantity} shares at ${money(p.avgCost)}${p.openedAt && isDate(p.openedAt) ? `, bought ${day(p.openedAt)}` : ""}${p.peakPrice != null ? `; tracked ${row.direction === "SHORT" ? "low" : "high"} ${money(p.peakPrice)}` : ""}`;
    const gain = num(r.unrealizedGainPct);
    if (gain != null) out.unrealizedGainPct = round(gain, 1);
    const progress = num(r.progressToTarget);
    if (progress != null) out.progressToTarget = round(progress, 2);
    const health = r.ladderHealth as Obj | null | undefined;
    if (health?.summary) out.ladderHealth = health.summary;
    if (num(row.unapprovedExitCount)) out.unapprovedExitCount = row.unapprovedExitCount;
  }
  if (row.catalystDate && isDate(row.catalystDate)) out.catalystDate = day(row.catalystDate);

  const own = (row.triggers ?? []).map((t) => triggerEntry(t, held)).filter((t): t is Obj => t != null);
  const inherited = (opts.inherited ? row.inheritedTriggers ?? [] : [])
    .map((t) => triggerEntry(t, held, LEVEL_WORDS[String((t as Obj)?.level)] ?? "analyst"))
    .filter((t): t is Obj => t != null);
  if (own.length || inherited.length) out.triggers = [...own, ...inherited];

  if (row.coreBelief) out.coreBelief = row.coreBelief;
  if (row.keyAssumptions?.length) out.keyAssumptions = row.keyAssumptions;
  if (row.invalidationConds?.length) out.invalidationConds = row.invalidationConds;
  const score = scoreLine(row);
  if (score) out.score = score;
  if (row.conviction) out.conviction = row.conviction;
  if (row.variantView) out.variantView = row.variantView;
  if (row.setup) out.setup = setupEntry(row.setup);
  else if (row.setupId === NO_SETUP_FITS) out.setup = "NONE: a review said no setup fits";

  out.research = researchLine(row);
  const snapshot = unmarked(getSectionText(row.snapshot));
  if (snapshot) out.snapshot = snapshot;
  const bull = getSectionBullets(row.bullCase).map(unmarked);
  if (bull.length) out.bullCase = bull;
  const bear = getSectionBullets(row.bearCase).map(unmarked);
  if (bear.length) out.bearCase = bear;
  if (opts.research) {
    const s = row.scoring && typeof row.scoring === "object" ? (row.scoring as Obj) : {};
    const notes = Object.fromEntries(
      DIMENSIONS.map(([key, word]) => [word, (s[key] as Obj | undefined)?.note]).filter(([, note]) => typeof note === "string" && note),
    );
    if (Object.keys(notes).length) out.scoreNotes = notes;
    for (const k of MORE_RESEARCH) if (row[k] != null) out[k] = row[k];
  }
  if (opts.named && row.history?.length) out.history = row.history;
  return out;
}

/** A standing rule of the analyst's or the account's, with the stocks it applies to when that is not all of them. */
export interface StandingRule {
  trigger: unknown;
  /** "held" or "watched" when the rule applies to only one. */
  appliesTo?: "held" | "watched";
}

/**
 * The analyst's and the account's standing rules, once for a read, each as
 * its sentence and id, the way a row's triggers read. Every stock carries
 * them unless it sets its own in the same place; rows do not repeat them.
 */
export function standingRules(rules: StandingRule[]): Obj[] {
  return rules
    .map((r) => {
      const level = String((r.trigger as Obj)?.level);
      const entry = triggerEntry(r.trigger, r.appliesTo !== "watched", LEVEL_WORDS[level] ?? "analyst");
      return entry ? { ...entry, ...(r.appliesTo ? { appliesTo: r.appliesTo } : {}) } : null;
    })
    .filter((e): e is Obj => e != null);
}

/** The facts a one-line stock is written from. */
export interface StockLineFacts {
  id: string;
  ticker: string;
  status: string;
  direction: string | null;
  horizon?: string | null;
  conviction?: string | null;
  composite?: number | null;
  coreBelief?: string | null;
  entryPrice?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  currentPrice?: number | null;
  reviewDueAt?: Date | string | null;
  catalystDate?: Date | string | null;
  researchAge?: { daysOld?: number | null; freshness?: string } | null;
  principalNote?: string | null;
  [k: string]: unknown;
}

/** One line per stock: who it is, the plan against the price, the score, the belief, and when it is next looked at. */
export function stockLine(f: StockLineFacts): Obj {
  const price = num(f.currentPrice);
  const plan = planLine(f, price);
  const composite = num(f.composite);
  const age = f.researchAge?.daysOld;
  return {
    id: f.id,
    ticker: f.ticker,
    status: f.status,
    direction: f.direction,
    ...(f.horizon ? { horizon: f.horizon } : {}),
    ...(price != null ? { price: money(price) } : {}),
    ...(plan ? { plan } : {}),
    ...(composite != null ? { score: `${composite}/10` } : {}),
    ...(f.conviction ? { conviction: f.conviction } : {}),
    ...(f.coreBelief ? { coreBelief: f.coreBelief } : {}),
    ...(f.reviewDueAt && isDate(f.reviewDueAt) ? { reviewDue: day(f.reviewDueAt) } : {}),
    ...(f.catalystDate && isDate(f.catalystDate) ? { catalystDate: day(f.catalystDate) } : {}),
    ...(age != null ? { research: `${age} days old${f.researchAge?.freshness === "stale" ? ", stale" : ""}` } : f.researchAge?.freshness === "missing" ? { research: "none written" } : {}),
    ...(f.principalNote ? { principalNote: f.principalNote } : {}),
  };
}
