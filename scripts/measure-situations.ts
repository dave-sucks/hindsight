/**
 * measure-situations.ts — every live stock's situations beside today's flags
 * (lib/agent/situations), from the real get_theses.
 *
 *   npx tsx --env-file=.env.local scripts/measure-situations.ts [--out <file>]
 *
 * Read-only: database reads, quotes, bars and the broker's account. Run it
 * after the close. For each analyst on the trading account it calls
 * get_theses twice, as the morning run does: once with every row in full
 * (the old fields and the situations side by side) and once on the default
 * read (which stocks are listed). Each stock's inputs are kept, so a later
 * change can replay them.
 *
 * It prints, and writes to the fixture:
 *  - the lead: today's needsAction, the first situation, and whether the
 *    first situation carries today's flag unchanged;
 *  - every plan check today, and whether each is on PLAN_PROBLEM;
 *  - the situations after the first, which today's one-reason flag hides;
 *  - the stocks where a ruling decides the lead or the listing: the lead
 *    picked by today's precedence rather than by `order`, a fire no other
 *    situation claims carried by REVIEW_DUE, and a buy level reached or a
 *    past catalyst (the resolver's label) as a source.
 *
 * The principal's own words (notes, decline messages, the words of a
 * decision) and their user id are replaced before anything is written: the
 * repo is public. No check reads them.
 */
import { writeFileSync } from "fs";
import { isAgentAnswer, type ActivityRow } from "@/lib/agent/stock-context";
import { changedTheRow } from "@/lib/agent/fire-streak";
import { prisma } from "@/lib/prisma";
import { getTheses, listsTheStock } from "@/lib/agent/tools/get-theses";
import { createToolContext } from "@/lib/agent/tool-context";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { needsActionFlag } from "@/lib/agent/needs-action-line";
import type { NeedsAction } from "@/lib/agent/needs-action";
import { recordSituations, situationsFor, type Situation, type SituationsCall } from "@/lib/agent/situations";
import { fromFixtureJson, toFixtureJson } from "@/lib/agent/situations/fixture-json";

const NOT_KEPT = "(the principal's words, not kept)";
const ACTIONABLE_RESOLVED = new Set(["ENTER_NOW", "STALE_PAST_CATALYST", "PROMOTED_DECIDE_TODAY"]);
const isDeep = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Row = Record<string, unknown> & {
  id: string;
  ticker: string;
  status: string;
  direction: string | null;
  needsAction: NeedsAction | null;
  situations: Situation[];
  nameTheSetup: unknown;
  buyBlockedByFull: unknown;
  resolved: { planSanity: Array<{ kind: string }> | null; actionability: string; floorRisk: unknown } | null;
};

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
      unansweredDecision: stock.unansweredDecision ? { ...stock.unansweredDecision, line: NOT_KEPT } : stock.unansweredDecision,
    },
  };
}

/** Why today's code lists a stock on the default read (get-theses.ts isFullDetail), from the full row and its inputs. */
function listingReasons(row: Row, call: SituationsCall | undefined): string[] {
  const reasons: string[] = [];
  if (row.nameTheSetup != null) reasons.push("no setup named");
  if (row.buyBlockedByFull != null) reasons.push("buy blocked, analyst full");
  if (row.status === "PROMOTED") reasons.push("promoted");
  if (row.needsAction != null) reasons.push(`needsAction ${row.needsAction.kind}`);
  if (ACTIONABLE_RESOLVED.has(row.resolved?.actionability ?? "")) reasons.push(`resolver label ${row.resolved?.actionability}`);
  if (listsTheStock(row.resolved?.planSanity ?? null)) reasons.push("plan check");
  if (row.resolved?.floorRisk != null) reasons.push("floor risk");
  if (call?.stock.unansweredDecision != null) reasons.push("the principal's word");
  return reasons;
}

async function main() {
  const outIdx = process.argv.indexOf("--out");
  const out = outIdx > 0 ? process.argv[outIdx + 1] : "lib/agent/situations/__fixtures__/live-book.json";
  const measuredAt = new Date();

  const analysts = await prisma.agentConfig.findMany({
    // The enabled analysts: all three trade from the one account that trades.
    where: { enabled: true },
    orderBy: { name: "asc" },
  });

  const stocks: unknown[] = [];
  const sold: unknown[] = [];
  const decidedBy: Array<{ ticker: string; analyst: string; ruling: string; what: string }> = [];
  let leadMatches = 0;
  let leadCount = 0;
  let planChecks = 0;
  let planChecksOnSituation = 0;
  let listingMismatches = 0;
  let replayMismatches = 0;

  for (const config of analysts) {
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
      const lead = row.needsAction;
      const first = list[0] ?? null;
      const leadHeld = lead ? isDeep(first?.data.flag, lead) : list.every((s) => s.data.flag === undefined);
      if (lead) {
        leadCount++;
        if (leadHeld) leadMatches++;
      }
      const plan = (row.resolved?.planSanity ?? []).map((f) => f.kind);
      const onSituation = (list.find((s) => s.code === "PLAN_PROBLEM")?.data as { codes?: Array<{ kind: string }> } | undefined)?.codes?.map((c) => c.kind) ?? [];
      planChecks += plan.length;
      planChecksOnSituation += plan.filter((k) => onSituation.includes(k)).length;
      const reasons = listingReasons(row, call);
      const isListed = listedIds.has(row.id);
      if (isListed !== reasons.length > 0) listingMismatches++;

      // Where a ruling decides the lead or the listing.
      const byOrder = [...list].sort((a, b) => a.order - b.order)[0]?.code ?? null;
      if (first && byOrder !== first.code) {
        decidedBy.push({ ticker: row.ticker, analyst: config.name, ruling: "1 (lead by today's precedence)", what: `lead ${first.code}; by order alone ${byOrder}` });
      }
      const review = list.find((s) => s.code === "REVIEW_DUE");
      for (const f of ((review?.data as { fires?: Array<{ action: string; summary: string; source: string }> } | undefined)?.fires ?? []).filter((f) => f.action !== "REVIEW")) {
        decidedBy.push({ ticker: row.ticker, analyst: config.name, ruling: "4 (REVIEW_DUE carries an unclaimed fire)", what: `${f.source} ${f.action}: ${f.summary}${first?.code === "REVIEW_DUE" ? " (holds the lead)" : ""}` });
      }
      const label = row.resolved?.actionability;
      if (label === "ENTER_NOW" || label === "STALE_PAST_CATALYST") {
        const only = reasons.every((r) => r.startsWith("resolver label"));
        decidedBy.push({ ticker: row.ticker, analyst: config.name, ruling: "5 (resolver label as a source)", what: `${label}${only ? " — the only reason it is listed" : ""}` });
      }

      // The fixture must replay: the trimmed, scrubbed inputs give the same list.
      const kept = call ? scrubCall(call) : null;
      if (kept) {
        const back = fromFixtureJson<ReturnType<typeof scrubCall>>(toFixtureJson(kept));
        const again = situationsFor(back.stock as SituationsCall["stock"], back.book, back.now);
        if (!isDeep(again, scrubSituations(list))) {
          replayMismatches++;
          console.warn(`[measure] ${row.ticker}: the kept inputs replay to ${again.map((x) => x.code).join(", ")}, not ${list.map((x) => x.code).join(", ")}`);
        }
      }

      stocks.push({
        ticker: row.ticker,
        analyst: config.name,
        thesisId: row.id,
        status: row.status,
        direction: row.direction,
        today: {
          lead: lead ? scrubFlag(lead) : null,
          header: lead ? needsActionFlag(lead) : null,
          planChecks: plan,
          listed: isListed,
          listingReasons: reasons,
          resolverLabel: label ?? null,
        },
        situations: scrubSituations(list),
        checks: {
          firstCarriesTodaysLead: leadHeld,
          everyPlanCheckOnPlanProblem: plan.every((k) => onSituation.includes(k)),
          hiddenToday: list.slice(1).map((s) => s.code),
        },
        input: kept,
      });
    }

    for (const s of (book.data.sold_to_review as Array<{ ticker: string; thesis_id: string; situations: Situation[] }>) ?? []) {
      sold.push({ ticker: s.ticker, analyst: config.name, thesisId: s.thesis_id, situations: scrubSituations(s.situations) });
    }
  }

  const fixture = {
    measuredAt: measuredAt.toISOString(),
    what: "Every live stock on the trading account: today's flags beside its situations (lib/agent/situations), from the real get_theses. The principal's words are replaced.",
    totals: {
      stocks: stocks.length,
      withALead: leadCount,
      firstSituationCarriesTheLead: leadMatches,
      planChecks,
      planChecksOnPlanProblem: planChecksOnSituation,
      listingReasonsDisagreeWithTheRead: listingMismatches,
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
  console.log(`lead: ${leadMatches} of ${leadCount} stocks with a lead carry it unchanged on their first situation`);
  console.log(`plan checks: ${planChecksOnSituation} of ${planChecks} on PLAN_PROBLEM`);
  console.log(`listing: ${listingMismatches} stocks where the reasons read off the row disagree with the default read`);
  console.log(`fixture: ${replayMismatches} stocks whose kept inputs replay to a different list\n`);
  console.log("ticker  analyst                 status    today's lead                     situations");
  for (const s of stocks as Array<{ ticker: string; analyst: string; status: string; today: { lead: NeedsAction | null; listed: boolean }; situations: Situation[]; checks: { firstCarriesTodaysLead: boolean } }>) {
    const lead = s.today.lead ? `${s.today.lead.kind}${"action" in s.today.lead ? ` ${s.today.lead.action}` : ""}` : "—";
    console.log(
      `${s.ticker.padEnd(7)} ${s.analyst.slice(0, 23).padEnd(23)} ${s.status.padEnd(9)} ${lead.padEnd(32)} ${s.situations.map((x) => x.code).join(", ") || "—"}${s.checks.firstCarriesTodaysLead ? "" : "   ✗ LEAD"}${s.today.listed ? "" : "   (quiet)"}`,
    );
  }
  for (const s of sold as Array<{ ticker: string; analyst: string; situations: Situation[] }>) {
    console.log(`${s.ticker.padEnd(7)} ${s.analyst.slice(0, 23).padEnd(23)} SOLD      —                                ${s.situations.map((x) => x.code).join(", ")}`);
  }
  console.log("\nwhere a ruling decides the lead or the listing:");
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
