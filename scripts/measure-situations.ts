/**
 * measure-situations.ts — every live stock's situations, beside what the read
 * sent the model before the list existed (lib/agent/situations).
 *
 *   npx tsx --env-file=.env.local scripts/measure-situations.ts --main <dump> [--out <file>]
 *
 * `--main` is scripts/dump-model-read.ts's output from main, run just before
 * this, after the same close. Read-only: database reads, quotes, bars and the
 * broker's account. For each analyst on the trading account it calls
 * get_theses twice, as the morning run does: once with every row in full
 * (each stock's inputs recorded as the list is built) and once on the
 * default read (which stocks are listed).
 *
 * It prints, and writes to the fixture:
 *  - for every live stock, its inputs, its situations, and main's value for
 *    each model-facing field the list now fills (needsAction, nameTheSetup,
 *    buyBlockedByFull, heldThroughFloor, resolved.planSanity,
 *    resolved.floorRisk) and whether main listed it;
 *  - every stock where this checkout's read differs from main on any of
 *    those;
 *  - the stocks where a ruling decides the lead: the lead picked by the work
 *    flag's precedence rather than by `order`, a fire no other situation
 *    claims carried by REVIEW_DUE, and a buy level reached or a past
 *    catalyst (the resolver's label) as a source.
 *
 * The principal's own words (notes, decline messages, the words of a
 * decision) and their user id are replaced before anything is written: the
 * repo is public. No check reads them.
 */
import { writeFileSync } from "fs";
import { isAgentAnswer, type ActivityRow } from "@/lib/agent/stock-context";
import { changedTheRow } from "@/lib/agent/fire-streak";
import { prisma } from "@/lib/prisma";
import { readFileSync } from "fs";
import { getTheses } from "@/lib/agent/tools/get-theses";
import { createToolContext } from "@/lib/agent/tool-context";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import type { WorkFlag } from "@/lib/agent/situations/work-flag";
import { recordSituations, situationsFor, type Situation, type SituationsCall } from "@/lib/agent/situations";
import { fromFixtureJson, toFixtureJson } from "@/lib/agent/situations/fixture-json";

const NOT_KEPT = "(the principal's words, not kept)";
const isDeep = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Row = Record<string, unknown> & {
  id: string;
  ticker: string;
  status: string;
  direction: string | null;
  needsAction: WorkFlag | null;
  situations: Situation[];
  nameTheSetup: unknown;
  buyBlockedByFull: unknown;
  heldThroughFloor: { rejectMessage?: unknown } | null;
  resolved: { planSanity: unknown; actionability: string; floorRisk: unknown } | null;
};

/** The model-facing fields the list now fills, as a row carries them. */
const MODEL_FIELDS = ["needsAction", "nameTheSetup", "buyBlockedByFull", "heldThroughFloor", "resolved.planSanity", "resolved.floorRisk"] as const;
function modelFields(row: Record<string, unknown>): Record<(typeof MODEL_FIELDS)[number], unknown> {
  const resolved = (row.resolved ?? null) as { planSanity?: unknown; floorRisk?: unknown } | null;
  const held = (row.heldThroughFloor ?? null) as { rejectMessage?: unknown } | null;
  return {
    needsAction: scrubFlag(row.needsAction ?? null),
    nameTheSetup: row.nameTheSetup ?? null,
    buyBlockedByFull: row.buyBlockedByFull ?? null,
    heldThroughFloor: held ? { ...held, rejectMessage: scrubText(held.rejectMessage) } : null,
    "resolved.planSanity": resolved ? resolved.planSanity ?? null : null,
    "resolved.floorRisk": resolved ? resolved.floorRisk ?? null : null,
  };
}

/** The principal's words out; the prefixes and keys every rule reads, kept. */
function scrubText(text: unknown): unknown {
  if (typeof text !== "string" || text.length === 0) return text;
  const prefix = /^\[(USER|REJECTED:USER)\]/.exec(text)?.[0];
  return prefix ? `${prefix} ${NOT_KEPT}` : NOT_KEPT;
}
function scrubChanges(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrubChanges);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [
        k,
        k === "userMessage" ? scrubText(x) : k === "approvedBy" || k === "rejectedBy" ? "(the principal)" : scrubChanges(x),
      ]),
    );
  }
  return v;
}
/**
 * The lines a rule can reach, and only what it reads of them. Kept: every
 * line back to the older of the newest answer a run wrote (the open fires,
 * the principal's decisions since) and the newest plan change (how long a
 * fire has asked), and every note. A run's own line keeps which fields it
 * changed, not its text; a line no run wrote keeps its changes, words
 * replaced.
 */
function trimActivity(rows: unknown): unknown {
  if (!Array.isArray(rows)) return rows;
  const desc = [...(rows as ActivityRow[])].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const answer = desc.findIndex((r) => isAgentAnswer(r));
  const change = desc.findIndex((r) => changedTheRow(r));
  const reach = answer < 0 || change < 0 ? desc.length - 1 : Math.max(answer, change);
  return desc
    .filter((r, i) => i <= reach || r.type === "NOTE")
    .map((row) => {
      const r = row as unknown as Record<string, unknown>;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { thesisId, run, ...kept } = r;
      const changes = r.fieldChanges && typeof r.fieldChanges === "object" ? (r.fieldChanges as Record<string, unknown>) : null;
      if (r.runId && r.type !== "NOTE" && !String(r.type).startsWith("PROPOSAL_")) {
        return { ...kept, rationale: null, fieldChanges: changes ? Object.fromEntries(Object.keys(changes).map((k) => [k, null])) : r.fieldChanges };
      }
      return {
        ...kept,
        rationale: scrubText(r.rationale),
        summary: r.type === "NOTE" ? scrubText(r.summary) : r.summary,
        fieldChanges: scrubChanges(r.fieldChanges),
      };
    });
}
function scrubFlag<T>(flag: T): T {
  const f = flag as unknown as Record<string, unknown> | null;
  if (f && typeof f === "object" && "rejectMessage" in f) return { ...f, rejectMessage: scrubText(f.rejectMessage) } as unknown as T;
  return flag;
}
function scrubSituations(list: Situation[]): Situation[] {
  return list.map((s) => {
    const data = { ...(s.data as Record<string, unknown>) };
    if (data.flag) data.flag = scrubFlag(data.flag);
    if (data.decision) data.decision = { ...(data.decision as object), line: NOT_KEPT };
    return { ...s, data } as Situation;
  });
}
function scrubCall(call: SituationsCall) {
  const { stock } = call;
  // No rule reads a trigger's rationale (an analyst's words, or the
  // principal's on one they set): blanked. Of the stored column, only the
  // buy's last fire is read.
  const triggers = stock.work.thesis.triggers.map((t) => ({ ...t, rationale: "" }));
  const ownTriggers = Array.isArray(stock.ownTriggers)
    ? (stock.ownTriggers as Array<Record<string, unknown>>).map((t) => ({ id: t.id, action: t.action, lastFiredAt: t.lastFiredAt }))
    : stock.ownTriggers;
  return {
    now: call.now,
    book: call.book,
    stock: {
      ...stock,
      ownTriggers,
      work: {
        ...stock.work,
        thesis: { ...stock.work.thesis, triggers },
        activity: trimActivity(stock.work.activity),
        recentUpdates: trimActivity(stock.work.recentUpdates),
        declinedSale: stock.work.declinedSale ? scrubFlag(stock.work.declinedSale) : stock.work.declinedSale,
      },
    },
  };
}

interface ModelRead {
  data?: { theses?: Array<Record<string, unknown>>; quiet_theses?: Array<Record<string, unknown>> };
}

async function main() {
  const flag = (name: string) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const mainDump = flag("--main");
  if (!mainDump) throw new Error("usage: measure-situations.ts --main <dump-model-read output from main> [--out <file>]");
  const out = flag("--out") ?? "lib/agent/situations/__fixtures__/live-book.json";
  const mainReads = JSON.parse(readFileSync(mainDump, "utf8")) as Record<string, ModelRead>;
  const measuredAt = new Date();

  const analysts = await prisma.agentConfig.findMany({
    // The enabled analysts: all three trade from the one account that trades.
    where: { enabled: true },
    orderBy: { name: "asc" },
  });

  const stocks: unknown[] = [];
  const sold: unknown[] = [];
  const decidedBy: Array<{ ticker: string; analyst: string; ruling: string; what: string }> = [];
  const differences: string[] = [];
  let leadCount = 0;
  let listedCount = 0;
  let replayMismatches = 0;

  for (const config of analysts) {
    const mainBook = new Map(((mainReads[`${config.name} — book`]?.data?.theses) ?? []).map((r) => [String(r.id), r]));
    const mainDefault = mainReads[`${config.name} — default`]?.data;
    if (!mainDefault || mainBook.size === 0) throw new Error(`${config.name}: not in the main dump`);
    const mainListed = new Set((mainDefault.theses ?? []).map((r) => String(r.id)));

    const runEnvironment = (config.tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER";
    const alpacaCreds = (await resolveAlpacaCredentials(config.userId, runEnvironment)) ?? undefined;
    const ctx = createToolContext({
      runId: "measure-situations",
      userId: config.userId,
      accountId: config.accountId,
      analystId: config.id,
      runMode: "MORNING_PLAN",
      alpacaCreds,
      runEnvironment,
      maxOpenPositions: config.maxOpenPositions,
      minConfidence: config.minConfidence,
      dryRun: true,
    } as Parameters<typeof createToolContext>[0]);
    const tool = getTheses(ctx) as unknown as { execute: (a: unknown) => Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> };

    // Every row in full, the situations' inputs recorded.
    const calls = new Map<string, SituationsCall>();
    recordSituations((c) => calls.set(c.stock.work.thesis.id, c));
    const book = await tool.execute({ detail: "book", limit: 50 });
    recordSituations(null);
    if (!book.ok || !book.data) throw new Error(`${config.name}: get_theses failed: ${book.error}`);
    // The default read: which stocks are listed.
    const listed = await tool.execute({ limit: 50 });
    if (!listed.ok || !listed.data) throw new Error(`${config.name}: get_theses (default) failed: ${listed.error}`);
    const listedIds = new Set(((listed.data.theses as Row[]) ?? []).map((r) => r.id));

    for (const row of (book.data.theses as Row[]) ?? []) {
      const call = calls.get(row.id);
      const list = row.situations ?? [];
      const mainRow = mainBook.get(row.id);
      if (!mainRow) throw new Error(`${row.ticker}: not in the main dump's book read`);
      const mainValues = { ...modelFields(mainRow), listed: mainListed.has(row.id) };
      const branchValues = { ...modelFields(row), listed: listedIds.has(row.id) };
      for (const k of Object.keys(mainValues) as Array<keyof typeof mainValues>) {
        if (!isDeep(mainValues[k], branchValues[k])) differences.push(`${row.ticker} (${config.name}) ${k}: main ${JSON.stringify(mainValues[k])} — here ${JSON.stringify(branchValues[k])}`);
      }
      if (mainValues.needsAction != null) leadCount++;
      if (mainValues.listed) listedCount++;

      // Where a ruling decides the lead.
      const first = list[0] ?? null;
      const byOrder = [...list].sort((a, b) => a.order - b.order)[0]?.code ?? null;
      if (first && byOrder !== first.code) {
        decidedBy.push({ ticker: row.ticker, analyst: config.name, ruling: "1 (lead by the work flag's precedence)", what: `lead ${first.code}; by order alone ${byOrder}` });
      }
      const review = list.find((s) => s.code === "REVIEW_DUE");
      for (const f of ((review?.data as { fires?: Array<{ action: string; summary: string; source: string }> } | undefined)?.fires ?? []).filter((f) => f.action !== "REVIEW")) {
        decidedBy.push({ ticker: row.ticker, analyst: config.name, ruling: "4 (REVIEW_DUE carries an unclaimed fire)", what: `${f.source} ${f.action}: ${f.summary}${first?.code === "REVIEW_DUE" ? " (holds the lead)" : ""}` });
      }
      const label = row.resolved?.actionability;
      if (label === "ENTER_NOW" || label === "STALE_PAST_CATALYST") {
        decidedBy.push({ ticker: row.ticker, analyst: config.name, ruling: "5 (resolver label as a source)", what: label });
      }

      // The fixture must replay: the trimmed, scrubbed inputs give the same
      // list. The one difference allowed is the principal's word, which the
      // replay words from the scrubbed lines; what is kept is the replayed
      // list, which carries none of their words.
      const kept = call ? scrubCall(call) : null;
      let keptList = scrubSituations(list);
      if (kept) {
        const back = fromFixtureJson<ReturnType<typeof scrubCall>>(toFixtureJson(kept));
        const again = situationsFor(back.stock as SituationsCall["stock"], back.book, back.now);
        if (!isDeep(scrubSituations(again), keptList)) {
          replayMismatches++;
          console.warn(`[measure] ${row.ticker}: the kept inputs replay to ${again.map((x) => x.code).join(", ")}, not ${list.map((x) => x.code).join(", ")}`);
        } else {
          keptList = again;
        }
      }

      stocks.push({
        ticker: row.ticker,
        analyst: config.name,
        thesisId: row.id,
        status: row.status,
        direction: row.direction,
        main: mainValues,
        situations: keptList,
        input: kept,
      });
    }

    for (const s of (book.data.sold_to_review as Array<{ ticker: string; thesis_id: string; situations: Situation[] }>) ?? []) {
      sold.push({ ticker: s.ticker, analyst: config.name, thesisId: s.thesis_id, situations: scrubSituations(s.situations) });
    }
  }

  const fixture = {
    measuredAt: measuredAt.toISOString(),
    what:
      "Every live stock on the trading account: its inputs and situations from the real get_theses, beside main's value for each model-facing field the list now fills and whether main listed it. The principal's words are replaced.",
    modelFields: [...MODEL_FIELDS, "listed"],
    totals: {
      stocks: stocks.length,
      withALead: leadCount,
      listed: listedCount,
      fieldsDifferingFromMain: differences.length,
      keptInputsReplayDifferently: replayMismatches,
      soldOwedALook: sold.length,
    },
    decidedBy,
    stocks,
    sold,
  };
  writeFileSync(out, toFixtureJson(fixture) + "\n");

  // ── Print ────────────────────────────────────────────────────────────
  console.log(`\nmeasured ${measuredAt.toISOString()} — ${analysts.length} analysts, ${stocks.length} live stocks, ${sold.length} sold owed a look`);
  console.log(`main: ${leadCount} stocks with a lead, ${listedCount} listed`);
  console.log(`fields differing from main (${MODEL_FIELDS.length} model-facing fields and the listing, on every stock): ${differences.length}`);
  for (const d of differences) console.log(`  ${d}`);
  console.log(`fixture: ${replayMismatches} stocks whose kept inputs replay to a different list\n`);
  console.log("ticker  analyst                 status    situations");
  for (const s of stocks as Array<{ ticker: string; analyst: string; status: string; main: { listed: boolean }; situations: Situation[] }>) {
    console.log(`${s.ticker.padEnd(7)} ${s.analyst.slice(0, 23).padEnd(23)} ${s.status.padEnd(9)} ${s.situations.map((x) => x.code).join(", ") || "—"}${s.main.listed ? "" : "   (quiet)"}`);
  }
  for (const s of sold as Array<{ ticker: string; analyst: string; situations: Situation[] }>) {
    console.log(`${s.ticker.padEnd(7)} ${s.analyst.slice(0, 23).padEnd(23)} SOLD      ${s.situations.map((x) => x.code).join(", ")}`);
  }
  console.log("\nwhere a ruling decides the lead:");
  for (const d of decidedBy) console.log(`  ${d.ticker.padEnd(6)} ${d.ruling}: ${d.what}`);
  if (decidedBy.length === 0) console.log("  none");
  console.log(`\nwrote ${out}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
