/**
 * The Agent work tab on /performance: what the morning run was shown (its
 * situations), what each run did with a stock, which triggers fired and what
 * they led to, and the proposals they made. Read-only; nothing here reaches an
 * agent. The situation query, the outcome rules and the category map live here
 * and nowhere else, so the tab and the 2026-11-13 audit count the same way.
 *
 * Situations are not stored. They are read back from each morning run's saved
 * thread: the first get_theses result, the run's default read (THREAD_SHAPE).
 * A trigger run saves no codes; its situation is worked out from what fired.
 */
import { prisma } from "@/lib/prisma";
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";
import { conditionsOf, shapeOf } from "@/lib/agent/triggers/condition";
import { etDateOf } from "@/lib/market-data/intraday-window";
import { marketHolidays } from "@/lib/market-hours";

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

export const CATEGORIES = ["Selling and protection", "Buying and adding", "Events", "Upkeep", "Your word", "Auto"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Every situation's category: the one map to change when codes are cut or merged. */
export const SITUATION_CATEGORY: Record<SituationCode, Category> = {
  PROTECTIVE_SALE: "Selling and protection", PROTECTION: "Selling and protection",
  BUY_ARRIVES: "Buying and adding", BUY_BLOCKED_FULL: "Buying and adding", ADD_OR_WINNER: "Buying and adding",
  EARNINGS: "Events", FILING: "Events",
  REVIEW_DUE: "Upkeep", FIRST_RESEARCH: "Upkeep", QUIET_WATCH_WOKE: "Upkeep", STALE_RESEARCH: "Upkeep",
  PLAN_PROBLEM: "Upkeep", SOLD_ONE_REVIEW: "Upkeep", PROMOTED_AWAITING: "Upkeep", NO_SETUP_NAMED: "Upkeep",
  YOUR_WORD_UNANSWERED: "Your word", PINNED_NOTE: "Your word",
  AUTO_TRADE: "Auto",
};

/** Where a saved morning thread keeps the read's codes: tool-result → output.value.data.<list>[].situations. */
export const THREAD_SHAPE = {
  part: "tool-result",
  tool: "get_theses",
  data: ["output", "value", "data"],
  lists: { work: "theses", quiet: "quiet_theses", sold: "sold_to_review" },
  codes: "situations",
} as const;

export const OUTCOMES = ["trade", "refused", "plan", "research", "note", "nothing"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABEL: Record<Outcome | "pending", string> = {
  trade: "Proposal or trade", refused: "Trade refused", plan: "Level or trigger change",
  research: "Research rewrite", note: "Note only", nothing: "Nothing", pending: "Not answered yet",
};

export const MODE_LABEL: Record<string, string> = {
  MORNING_PLAN: "Morning", INTRADAY_TACTICAL: "Trigger", THESIS_WRITER: "Writer", PRINCIPAL_CHAT: "Chat",
  PORTFOLIO_DIGEST: "Portfolio Digest", MARKET_REVIEWER: "Market Reviewer",
};

export type FireMode = "Auto" | "Send to Agent" | "Flag for Review" | "Plan taken down";
const TRADE_TOOLS = ["place_trade", "close_position", "manage_position"];
const PLAN_KEYS = ["entryPrice", "stopLoss", "targetPrice", "status", "direction", "retiredReason", "catalystDate"];
const RESEARCH_KEYS = ["researchData", "bullCase", "bearCase", "fundamentals", "coreBelief", "keyAssumptions", "invalidationConds", "variantView", "snapshot", "scoring"];

// ── Rows as the queries return them ──────────────────────────────────────

export interface RunRow { id: string; mode: string; analystId: string | null; status: string; createdAt: Date; completedAt: Date | null; parentRunId: string | null; thesisId: string | null; action: string | null; auto: boolean }
export interface ReadRow { runId: string; list: "read" | "work" | "quiet" | "sold"; thesisId: string | null; ticker: string | null; codes: string[] }
export interface UpdateRow { id: string; thesisId: string; at: Date; type: string; runId: string | null; tradeId: string | null; triggerId: string | null; triggerAction: string | null; condition: unknown; summary: string | null; keys: string[]; realOps: boolean }
export interface OrderRow { id: string; thesisId: string; symbol: string; intent: string; status: string; createdAt: Date }
export interface ThesisRow { id: string; ticker: string; status: string; analystId: string | null; triggerIds: string[]; inheritedIds: string[] }
export interface RefusalRow { runId: string; thesisId: string | null; ticker: string | null }
export interface Raw {
  analysts: Array<{ id: string; name: string }>;
  levels: { analyst: string[]; account: string[] };
  runs: RunRow[]; reads: ReadRow[]; updates: UpdateRow[]; orders: OrderRow[]; theses: ThesisRow[]; refusals: RefusalRow[];
}

// ── The outcome rules ────────────────────────────────────────────────────

export interface Index {
  run: Map<string, RunRow>;
  updates: Map<string, UpdateRow[]>;
  orders: Map<string, OrderRow[]>;
  orderById: Map<string, OrderRow>;
  refused: Set<string>;
  thesis: Map<string, ThesisRow>;
}

/** The run a Writer was dispatched from: its writes count for that run. */
export function rootOf(runId: string, run: Map<string, RunRow>): string {
  let id = runId;
  for (let i = 0; i < 5; i++) {
    const parent = run.get(id)?.parentRunId;
    if (!parent || !run.has(parent)) break;
    id = parent;
  }
  return id;
}

export function indexOf(raw: Raw): Index {
  const run = new Map(raw.runs.map((r) => [r.id, r]));
  const updates = new Map<string, UpdateRow[]>();
  for (const u of raw.updates) {
    if (!u.runId || u.type === "TRIGGER_FIRED" || u.type.startsWith("PROPOSAL")) continue;
    const key = `${rootOf(u.runId, run)}|${u.thesisId}`;
    updates.set(key, [...(updates.get(key) ?? []), u]);
  }
  const orders = new Map<string, OrderRow[]>();
  for (const o of raw.orders) orders.set(o.thesisId, [...(orders.get(o.thesisId) ?? []), o]);
  const thesis = new Map(raw.theses.map((t) => [t.id, t]));
  const refused = new Set<string>();
  for (const g of raw.refusals) {
    if (g.thesisId) refused.add(`${g.runId}|${g.thesisId}`);
    if (g.ticker) refused.add(`${g.runId}|${g.ticker.toUpperCase()}`);
  }
  return { run, updates, orders, orderById: new Map(raw.orders.map((o) => [o.id, o])), refused, thesis };
}

/**
 * What a run did with a stock, first match wins: a proposal or trade (an
 * order on the stock while the run ran, or one its note was stamped with); a
 * trade tool the gates refused; a research rewrite (a Writer it dispatched); a
 * price, trigger or status change ("wording updated" edits don't count); a
 * note only; nothing.
 */
export function outcomeOf(runId: string, thesisId: string, ix: Index): { outcome: Outcome; orders: OrderRow[] } {
  const r = ix.run.get(runId);
  if (!r) return { outcome: "nothing", orders: [] };
  const from = r.createdAt.getTime() - 30_000;
  const to = (r.completedAt ?? new Date(r.createdAt.getTime() + 15 * 60_000)).getTime() + 3 * 60_000;
  const us = ix.updates.get(`${runId}|${thesisId}`) ?? [];
  const stamped = new Set(us.map((u) => u.tradeId).filter((x): x is string => !!x));
  const orders = (ix.orders.get(thesisId) ?? []).filter((o) => stamped.has(o.id) || (o.createdAt.getTime() >= from && o.createdAt.getTime() <= to));
  if (orders.length) return { outcome: "trade", orders };
  const ticker = ix.thesis.get(thesisId)?.ticker;
  if (ix.refused.has(`${runId}|${thesisId}`) || (ticker && ix.refused.has(`${runId}|${ticker}`))) return { outcome: "refused", orders };
  if (us.some((u) => u.keys.some((k) => RESEARCH_KEYS.includes(k)))) return { outcome: "research", orders };
  const plan = (u: UpdateRow) =>
    ["STATUS_CHANGED", "INVALIDATED", "CLOSED"].includes(u.type) || u.keys.some((k) => PLAN_KEYS.includes(k)) || (u.keys.includes("triggerOps") && u.realOps);
  if (us.some(plan)) return { outcome: "plan", orders };
  return { outcome: us.length ? "note" : "nothing", orders };
}

// ── Reading a fire ───────────────────────────────────────────────────────

const ACTION_WORDS: Record<string, string> = { EXIT: "Sell", TRIM: "Trim", ADD: "Add", ENTER: "Buy", REVIEW: "Review" };

/** A fire's action; lines written before the rule was kept on them are read from their sentence. */
export function fireAction(u: Pick<UpdateRow, "triggerAction" | "summary">): string {
  if (u.triggerAction) return u.triggerAction;
  const s = u.summary ?? "";
  if (s.startsWith("Sell") || s.includes("plan set down")) return "EXIT";
  const hit = Object.entries(ACTION_WORDS).find(([, w]) => s.startsWith(w));
  return hit?.[0] ?? "REVIEW";
}

/** What a fire's condition watched, in a few words. */
export function measureLabel(condition: unknown, summary: string | null): string {
  const w = shapeOf(condition);
  if (!w) {
    const s = summary ?? "";
    if (s.includes("from the high")) return "Give-back off the high";
    if (s.includes("yesterday")) return "Move from yesterday's close";
    if (s.includes("every")) return "Review every N days";
    return s.includes("average") ? "Price vs an average" : "Price vs a set price";
  }
  const one = (c: { watch: string; variable?: string }) => {
    const v = c.variable ?? "";
    if (c.watch === "price") return /^sma\d+$/.test(v) ? "Price vs an average" : v.startsWith("street") ? "Price vs the Street target" : "Price vs a set price";
    if (c.watch === "move") return v === "entry" ? "Move from our entry" : v === "peak" ? "Give-back off the high" : v === "prev_close" ? "Move from yesterday's close" : "Move vs an average or high";
    return { report: "Before a report", surprise: "Earnings beat or miss", filing: "A filing", insiders: "Insider buying", repeat: "Review every N days", from_date: "Days from a date", strength: "Strength vs the S&P", rsi: "RSI", volume: "Volume", gap: "A gap" }[c.watch] ?? c.watch;
  };
  return [...new Set(conditionsOf(w).map(one))].join(" + ");
}

export function levelOf(u: Pick<UpdateRow, "triggerId">, t: ThesisRow | undefined, levels: Raw["levels"]): string {
  const id = u.triggerId ?? "";
  if (t?.triggerIds.includes(id)) return "Stock";
  if (levels.analyst.includes(id)) return "Analyst";
  if (levels.account.includes(id)) return "Account";
  return t?.inheritedIds.includes(id) ? "Analyst or account (removed)" : "Stock (removed)";
}

export function fireModeOf(u: Pick<UpdateRow, "runId" | "summary">, run: RunRow | undefined): FireMode {
  if ((u.summary ?? "").includes("plan set down")) return "Plan taken down";
  if (!u.runId) return "Flag for Review";
  return run?.auto ? "Auto" : "Send to Agent";
}

/** A trigger run's situation, from what fired: the code the morning read would have given it. */
export function triggerRunCode(run: RunRow, condition: unknown): SituationCode {
  if (run.auto) return "AUTO_TRADE";
  if (run.action === "EXIT" || run.action === "TRIM") return "PROTECTIVE_SALE";
  if (run.action === "ENTER") return "BUY_ARRIVES";
  if (run.action === "ADD") return "ADD_OR_WINNER";
  const w = shapeOf(condition);
  const watched = w ? conditionsOf(w).map((c) => c.watch as string) : [];
  if (watched.some((x) => x === "report" || x === "surprise")) return "EARNINGS";
  if (watched.some((x) => x === "filing" || x === "insiders")) return "FILING";
  return "REVIEW_DUE";
}

function isTradingDay(ymd: string): boolean {
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !marketHolidays(d.getUTCFullYear()).has(ymd);
}

/** The longest run of consecutive trading days in a set of ET dates. */
export function longestStreak(days: string[]): number {
  const sorted = [...new Set(days)].sort();
  let best = sorted.length ? 1 : 0;
  let cur = best;
  for (let i = 1; i < sorted.length; i++) {
    let gap = 0;
    for (let d = new Date(`${sorted[i - 1]}T12:00:00Z`); ; ) {
      d = new Date(d.getTime() + 86_400_000);
      const ymd = d.toISOString().slice(0, 10);
      if (isTradingDay(ymd)) gap++;
      if (ymd >= sorted[i]) break;
    }
    cur = gap === 1 ? cur + 1 : 1;
    best = Math.max(best, cur);
  }
  return best;
}

// ── The queries ──────────────────────────────────────────────────────────

export async function loadRaw(accountId: string, since: Date, analystId: string | null): Promise<Raw> {
  const a = analystId;
  const [analysts, levelRows, runs, reads, theses] = await Promise.all([
    prisma.agentConfig.findMany({ where: { accountId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.$queryRaw<Array<{ level: string; ids: string[] }>>`
      select 'analyst' as level, coalesce(array_agg(x->>'id'), '{}') as ids from "AgentConfig" c, jsonb_array_elements(case when jsonb_typeof(c.triggers) = 'array' then c.triggers else '[]' end) x where c."accountId" = ${accountId}
      union all select 'account', coalesce(array_agg(x->>'id'), '{}') from "Account" c, jsonb_array_elements(case when jsonb_typeof(c.triggers) = 'array' then c.triggers else '[]' end) x where c.id = ${accountId}`,
    prisma.$queryRaw<RunRow[]>`
      select r.id, r.mode, r."agentConfigId" as "analystId", r.status, r."createdAt", r."completedAt", r."parentRunId",
        r.parameters->>'thesisId' as "thesisId", r.parameters->>'action' as action, coalesce(r.parameters->>'autoTrade', '') = 'true' as auto
      from "ResearchRun" r where r."accountId" = ${accountId} and r."createdAt" >= ${since} and (${a}::text is null or r."agentConfigId" = ${a})`,
    prisma.$queryRaw<ReadRow[]>`
      with th as (
        select r.id, m.content::jsonb as j from "RunMessage" m join "ResearchRun" r on r.id = m."runId"
        where m.role = 'thread' and r.mode = 'MORNING_PLAN' and r."accountId" = ${accountId} and r."createdAt" >= ${since} and (${a}::text is null or r."agentConfigId" = ${a})
      ), firsts as (
        select distinct on (th.id) th.id as run_id, p #> ${[...THREAD_SHAPE.data]}::text[] as d
        from th, jsonb_array_elements(case when jsonb_typeof(th.j) = 'array' then th.j else '[]' end) with ordinality msg(m, mi),
          jsonb_array_elements(case when jsonb_typeof(m->'content') = 'array' then m->'content' else '[]' end) with ordinality pp(p, pi)
        where p->>'type' = ${THREAD_SHAPE.part}::text and p->>'toolName' = ${THREAD_SHAPE.tool}::text
        order by th.id, mi, pi
      )
      select run_id as "runId", 'read' as list, null as "thesisId", null as ticker, '{}'::text[] as codes from firsts
      union all
      select f.run_id, l.list, coalesce(x->>'id', x->>'thesis_id'), x->>'ticker',
        array(select jsonb_array_elements_text(case when jsonb_typeof(x->(${THREAD_SHAPE.codes}::text)) = 'array' then x->(${THREAD_SHAPE.codes}::text) else '[]' end))
      from firsts f,
        (values ('work', ${THREAD_SHAPE.lists.work}::text), ('quiet', ${THREAD_SHAPE.lists.quiet}::text), ('sold', ${THREAD_SHAPE.lists.sold}::text)) l(list, key),
        jsonb_array_elements(case when jsonb_typeof(f.d->l.key) = 'array' then f.d->l.key else '[]' end) x`,
    prisma.$queryRaw<ThesisRow[]>`
      select t.id, t.ticker, t.status::text as status, r."agentConfigId" as "analystId",
        array(select x->>'id' from jsonb_array_elements(case when jsonb_typeof(t.triggers) = 'array' then t.triggers else '[]' end) x) as "triggerIds",
        array(select jsonb_object_keys(case when jsonb_typeof(t."triggerState") = 'object' then t."triggerState" else '{}' end)) as "inheritedIds"
      from "Thesis" t left join "ResearchRun" r on r.id = t."researchRunId"
      where t."accountId" = ${accountId} and (${a}::text is null or r."agentConfigId" = ${a})
        and (t.status::text in ('WATCHING', 'HOLDING', 'PROMOTED')
          or exists (select 1 from "ThesisUpdate" u where u."thesisId" = t.id and u.timestamp >= ${since})
          or exists (select 1 from "Order" o where o."thesisId" = t.id and o."createdAt" >= ${since}))`,
  ]);
  const ids = theses.map((t) => t.id);
  const runIds = runs.map((r) => r.id);
  const [updates, orders, refusals] = await Promise.all([
    prisma.$queryRaw<UpdateRow[]>`
      select u.id, u."thesisId", u.timestamp as at, u.type, u."runId", u."tradeId", u."triggerId", u."triggerAction", u."triggerCondition" as condition,
        case when u.type = 'TRIGGER_FIRED' then u.summary end as summary,
        array(select jsonb_object_keys(case when jsonb_typeof(u."fieldChanges") = 'object' then u."fieldChanges" else '{}' end)) as keys,
        exists(select 1 from jsonb_array_elements(case when jsonb_typeof(u."fieldChanges"->'triggerOps'->'to') = 'array' then u."fieldChanges"->'triggerOps'->'to' else '[]' end) e
          where coalesce(e->>'text', '') not like '%wording updated') as "realOps"
      from "ThesisUpdate" u where u."thesisId" = any(${ids}) and u.timestamp >= ${since} order by u.timestamp, u.id`,
    prisma.$queryRaw<OrderRow[]>`
      select o.id, o."thesisId", o.symbol, o.intent, o.status, o."createdAt" from "Order" o where o."thesisId" = any(${ids}) and o."createdAt" >= ${since}`,
    prisma.$queryRaw<RefusalRow[]>`
      select g."runId", g."thesisId", g.ticker from "GateRejection" g where g."runId" = any(${runIds}) and g.tool = any(${TRADE_TOOLS})`,
  ]);
  return {
    analysts,
    levels: { analyst: levelRows.find((l) => l.level === "analyst")?.ids ?? [], account: levelRows.find((l) => l.level === "account")?.ids ?? [] },
    runs, reads, updates, orders, theses, refusals,
  };
}

// ── The tab's numbers ────────────────────────────────────────────────────

type Counts = Record<string, number>;
const bump = (o: Counts, k: string, n = 1) => { o[k] = (o[k] ?? 0) + n; };
const entry = <V>(m: Map<string, V>, k: string, make: () => V): V => { if (!m.has(k)) m.set(k, make()); return m.get(k) as V; };

export function buildAgentWork(raw: Raw, opts: { days: RangeDays; analystId: string | null; since: Date; now: Date }) {
  const ix = indexOf(raw);
  const name = new Map(raw.analysts.map((x) => [x.id, x.name]));
  const morning = raw.runs.filter((r) => r.mode === "MORNING_PLAN");

  // Situations: the work list (and sold stocks) of each morning read, with what the run did.
  const work = raw.reads.filter((x) => (x.list === "work" || x.list === "sold") && x.thesisId).map((x) => {
    const run = ix.run.get(x.runId);
    return { ...x, thesisId: x.thesisId as string, date: run ? etDateOf(run.createdAt) : "", analyst: name.get(run?.analystId ?? "") ?? "", outcome: outcomeOf(x.runId, x.thesisId as string, ix).outcome };
  });
  const quiet = raw.reads.filter((x) => x.list === "quiet");
  const tactical = raw.runs.filter((r) => r.mode === "INTRADAY_TACTICAL");
  const fireOfRun = new Map(raw.updates.filter((u) => u.type === "TRIGGER_FIRED" && u.runId).map((u) => [u.runId as string, u]));
  const runCodes: Counts = {};
  for (const r of tactical) bump(runCodes, triggerRunCode(r, fireOfRun.get(r.id)?.condition));
  const codes = (Object.keys(SITUATIONS) as SituationCode[]).map((code) => {
    const rows = work.filter((x) => x.codes.includes(code));
    const out: Counts = {};
    rows.forEach((x) => bump(out, x.outcome));
    return {
      code, name: SITUATIONS[code].name, category: SITUATION_CATEGORY[code], shown: rows.length,
      stocks: new Set(rows.map((x) => x.thesisId)).size, days: new Set(rows.map((x) => x.date)).size,
      quiet: quiet.filter((x) => x.codes.includes(code)).length, out, triggerRuns: runCodes[code] ?? 0,
    };
  });
  const categories = CATEGORIES.map((category) => {
    const rows = work.filter((x) => x.codes.some((c) => SITUATION_CATEGORY[c as SituationCode] === category));
    const out: Counts = {};
    rows.forEach((x) => bump(out, x.outcome));
    return { category, shown: rows.length, out, triggerRuns: codes.filter((c) => c.category === category).reduce((s, c) => s + c.triggerRuns, 0) };
  });

  // Fires, each with its level, mode and what it led to.
  const nextMorning = (analystId: string | null, at: Date) =>
    morning.filter((r) => r.analystId === analystId && r.createdAt > at).sort((x, y) => +x.createdAt - +y.createdAt)[0];
  const fires = raw.updates.filter((u) => u.type === "TRIGGER_FIRED").map((u) => {
    const t = ix.thesis.get(u.thesisId);
    const run = u.runId ? ix.run.get(u.runId) : undefined;
    const mode = fireModeOf(u, run);
    const answer = u.runId ?? nextMorning(t?.analystId ?? null, u.at)?.id;
    const res = answer ? outcomeOf(answer, u.thesisId, ix) : null;
    return {
      thesisId: u.thesisId, ticker: t?.ticker ?? "?", triggerId: u.triggerId ?? u.id, date: etDateOf(u.at), sentence: (u.summary ?? "").replace(/ — folded into.*$/, ""),
      action: fireAction(u), measure: measureLabel(u.condition, u.summary), level: levelOf(u, t, raw.levels), mode,
      outcome: (res?.outcome ?? "pending") as Outcome | "pending", orders: res?.orders ?? [],
    };
  });
  const tally = (k: "action" | "measure" | "level" | "mode") => {
    const c: Counts = {};
    fires.forEach((f) => bump(c, k === "action" ? ACTION_WORDS[f.action] ?? f.action : f[k]));
    return Object.entries(c).sort((x, y) => y[1] - x[1]).map(([label, n]) => ({ label, n }));
  };
  // Two triggers that fired into one run share its proposal: each proposal counts once.
  const ledTo = new Map<string, { mode: string; action: string; n: number; out: Counts; orders: Counts; seen: Set<string> }>();
  for (const f of fires) {
    const e = entry(ledTo, `${f.mode}|${f.action}`, () => ({ mode: f.mode, action: ACTION_WORDS[f.action] ?? f.action, n: 0, out: {}, orders: {}, seen: new Set<string>() }));
    e.n++; bump(e.out, f.outcome);
    f.orders.filter((o) => !e.seen.has(o.id)).forEach((o) => { e.seen.add(o.id); bump(e.orders, o.status); });
  }

  // The same trigger, day after day; and different triggers on one stock the same day.
  const byTrigger = new Map<string, typeof fires>();
  fires.forEach((f) => entry(byTrigger, `${f.thesisId}|${f.triggerId}`, () => []).push(f));
  const refirers = [...byTrigger.values()].map((fs) => {
    const orders = new Map(fs.flatMap((f) => f.orders).map((o) => [o.id, o]));
    const days = fs.map((f) => f.date);
    const modes: Counts = {};
    fs.forEach((f) => bump(modes, f.mode));
    return {
      thesisId: fs[0].thesisId, ticker: fs[0].ticker, sentence: fs[fs.length - 1].sentence, level: fs[0].level,
      mode: Object.entries(modes).sort((x, y) => y[1] - x[1])[0][0],
      fires: fs.length, days: new Set(days).size, streak: longestStreak(days),
      proposals: orders.size, expired: [...orders.values()].filter((o) => o.status === "EXPIRED").length,
    };
  }).filter((s) => s.days > 1).sort((x, y) => y.days - x.days || y.fires - x.fires).slice(0, 15);
  const byStockDay = new Map<string, typeof fires>();
  fires.forEach((f) => entry(byStockDay, `${f.thesisId}|${f.date}`, () => []).push(f));
  const pairs = new Map<string, { a: string; b: string; stockDays: number; tickers: Set<string> }>();
  for (const fs of byStockDay.values()) {
    const labels = [...new Set(fs.map((f) => `${f.level}: ${ACTION_WORDS[f.action] ?? f.action}, ${f.measure.toLowerCase()}`))].sort();
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const k = `${labels[i]}|${labels[j]}`;
      const e = pairs.get(k) ?? { a: labels[i], b: labels[j], stockDays: 0, tickers: new Set<string>() };
      e.stockDays++; e.tickers.add(fs[0].ticker); pairs.set(k, e);
    }
  }

  // Each day: fires by action, and proposals made that day that expired.
  const daily = new Map<string, Counts>();
  fires.forEach((f) => bump(entry(daily, f.date, () => ({})), f.action));
  raw.orders.filter((o) => o.status === "EXPIRED").forEach((o) => bump(entry(daily, etDateOf(o.createdAt), () => ({})), "expired"));

  // Proposals by stock, how they ended.
  const proposals = new Map<string, { thesisId: string; ticker: string; total: number; status: Counts }>();
  for (const o of raw.orders) {
    const e = proposals.get(o.thesisId) ?? { thesisId: o.thesisId, ticker: o.symbol, total: 0, status: {} };
    e.total++; bump(e.status, o.status); proposals.set(o.thesisId, e);
  }

  // Runs by type, and the stocks each touched.
  const byType: Counts = {};
  raw.runs.forEach((r) => bump(byType, `${name.get(r.analystId ?? "") ?? "Account"}|${MODE_LABEL[r.mode] ?? r.mode}`));
  // A run's own lines, and a morning run's include the Writer's it dispatched.
  const wrote = new Map<string, Set<string>>();
  for (const u of raw.updates) {
    if (!u.runId || u.type === "TRIGGER_FIRED" || u.type.startsWith("PROPOSAL")) continue;
    entry(wrote, u.runId, () => new Set()).add(u.thesisId);
    entry(wrote, rootOf(u.runId, ix.run), () => new Set()).add(u.thesisId);
  }
  const touched = Object.keys(MODE_LABEL).map((mode) => {
    const rs = raw.runs.filter((r) => r.mode === mode);
    const n = rs.map((r) => wrote.get(r.id)?.size ?? 0);
    const listed = mode === "MORNING_PLAN" ? work.length / Math.max(1, new Set(work.map((x) => x.runId)).size) : null;
    return { mode: MODE_LABEL[mode], runs: rs.length, listed, written: n.reduce((s, x) => s + x, 0) / Math.max(1, rs.length), max: Math.max(0, ...n) };
  }).filter((t) => t.runs > 0);

  // Per stock.
  const stocks = raw.theses.map((t) => {
    const us = raw.updates.filter((u) => u.thesisId === t.id);
    const runs = new Set<string>();
    us.forEach((u) => u.runId && runs.add(u.type === "TRIGGER_FIRED" ? u.runId : rootOf(u.runId, ix.run)));
    const listed = work.filter((x) => x.thesisId === t.id);
    listed.forEach((x) => runs.add(x.runId));
    const os = raw.orders.filter((o) => o.thesisId === t.id);
    return {
      thesisId: t.id, ticker: t.ticker, analyst: name.get(t.analystId ?? "") ?? "", status: t.status,
      reviews: us.filter((u) => u.type === "REVIEWED" || u.type === "UPDATED").length, fires: us.filter((u) => u.type === "TRIGGER_FIRED").length,
      runs: runs.size, listed: listed.length, triggerRuns: new Set(us.filter((u) => u.type === "TRIGGER_FIRED" && u.runId).map((u) => u.runId)).size,
      proposals: os.length, expired: os.filter((o) => o.status === "EXPIRED").length,
    };
  }).sort((x, y) => y.reviews + y.fires + y.runs + y.proposals - (x.reviews + x.fires + x.runs + x.proposals));

  return {
    range: { days: opts.days, since: opts.since.toISOString(), until: opts.now.toISOString() },
    analysts: raw.analysts, analystId: opts.analystId,
    reads: { morningRuns: morning.filter((r) => r.status === "COMPLETE").length, read: raw.reads.filter((x) => x.list === "read").length },
    totals: {
      fires: fires.length, firedStocks: new Set(fires.map((f) => f.thesisId)).size, triggerRuns: tactical.length, morningRuns: morning.length,
      proposals: raw.orders.length, expired: raw.orders.filter((o) => o.status === "EXPIRED").length, filled: raw.orders.filter((o) => o.status === "FILLED").length,
      workRows: work.length, quietRows: quiet.length, nothing: work.filter((x) => x.outcome === "nothing").length,
    },
    runs: { byType: Object.entries(byType).map(([k, n]) => ({ analyst: k.split("|")[0], mode: k.split("|")[1], n })), touched },
    situations: {
      codes, categories,
      nothing: work.filter((x) => x.outcome === "nothing").map((x) => ({ date: x.date, analyst: x.analyst, ticker: x.ticker, thesisId: x.thesisId, codes: x.codes })).sort((x, y) => y.date.localeCompare(x.date)),
    },
    fires: {
      byAction: tally("action"), byMeasure: tally("measure"), byLevel: tally("level"), byMode: tally("mode"),
      ledTo: [...ledTo.values()].map((e) => ({ mode: e.mode, action: e.action, n: e.n, out: e.out, orders: e.orders })).sort((x, y) => y.n - x.n),
      refirers, duplicates: [...pairs.values()].map((p) => ({ a: p.a, b: p.b, stockDays: p.stockDays, tickers: [...p.tickers].sort() })).sort((x, y) => y.stockDays - x.stockDays).slice(0, 10),
      daily: [...daily.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([date, c]) => ({ date, ...c })),
    },
    proposals: [...proposals.values()].sort((x, y) => y.total - x.total),
    stocks,
  };
}
export type AgentWork = ReturnType<typeof buildAgentWork>;

export async function loadAgentWork(opts: { accountId: string; days: RangeDays; analystId: string | null; now?: Date }): Promise<AgentWork> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - opts.days * 86_400_000);
  const raw = await loadRaw(opts.accountId, since, opts.analystId);
  return buildAgentWork(raw, { days: opts.days, analystId: opts.analystId, since, now });
}
