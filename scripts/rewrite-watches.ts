/**
 * rewrite-watches.ts — rewrite old watches under their analyst's playbooks
 * (roadmap 9.1), one stock at a time. Run by hand, outside market hours.
 *
 *   npx tsx --env-file=.env.local scripts/rewrite-watches.ts --tickers MA,TRV --dry-run
 *   npx tsx --env-file=.env.local scripts/rewrite-watches.ts --tickers MA,TRV [--analyst "Secular Compounder"]
 *   npx tsx --env-file=.env.local scripts/rewrite-watches.ts --restore MA [--analyst …]
 *
 * For each watch (rewriteOne):
 * 1. The triggers an agent or code wrote (source AGENT or DEFAULT) are read
 *    with the row locked, written to the journal, and taken off through
 *    applyTriggerOps, with one Activity line. The owner's stay, and so does a
 *    trigger with no source: it is kept as the owner's.
 * 2. Its playbook's watch triggers go on as a new watch's do:
 *    writerPlaybookWrites, priced from today's chart, marked playbook "WATCH",
 *    each with its template's reason. They are written the way code writes its
 *    own trigger lines (applyTriggerOps, one Activity line that is a title):
 *    not a note, so no review is answered and the review clock doesn't move.
 *    A watch with no playbook gets none: the Writer names one.
 * 3. The stock goes to the Writer with the normal send
 *    (dispatch_thesis_research): a refresh, which tailors the triggers. A line
 *    that holds at today's price, read as the trigger check reads it
 *    (true-now.ts), is named in the brief: it fires at the next check.
 *
 * If any of the playbook's triggers is refused, or the send fails, the
 * journal's triggers go back on at once and the script stops: it never goes
 * on past a refusal. Then the script waits for the Writer run to end before
 * the next stock. If the run fails, or ends with nothing but the owner's
 * triggers on a watch, they go back on and the script stops. If the run
 * hasn't ended after 20 minutes nothing is put back, which would race it: the
 * script stops and prints the --restore command. If the Writer passed on the
 * stock or let it go, the script says it is no longer on watch and where its
 * cleared triggers are; nothing here reopens a stock.
 *
 * --restore finds the stock by the journal: it takes off every trigger an
 * agent or code wrote and puts the last set cleared from it back, with one
 * Activity line, unless a Writer run on it is running or it isn't a watch
 * now (then it says so, and where the journal is). --dry-run prints what each watch would
 * lose, what it would get, which of those hold today, and the brief; it
 * writes and sends nothing. The journal is
 * ~/hindsight-rewrite-watches/journal.jsonl (--journal <file> for another).
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { prisma } from "@/lib/prisma";
import { createToolContext } from "@/lib/agent/tool-context";
import { dispatchThesisResearch } from "@/lib/agent/tools/dispatch-thesis-research";
import { findInFlightWriter } from "@/lib/agent/thesis-writer-dispatch";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import { writerPlaybookWrites, type WriterPlaybooks } from "@/lib/agent/run-thesis-writer";
import { isNamedSetup } from "@/lib/agent/knowledge/setups";
import { loadPlaybooks } from "@/lib/agent/knowledge/load-playbook";
import { loadFillChart } from "@/lib/proposals/fill-chart";
import { acceptedOps, applyTriggerOps, describeTrigger } from "@/lib/agent/triggers/ops";
import { parseTriggersResilient, triggerInputSchema } from "@/lib/agent/triggers/schema";
import { holdingNow, readNow } from "@/lib/agent/triggers/true-now";
import type { PriceStructure } from "@/lib/market-data/price-structure";
import type { Trigger } from "@/lib/agent/triggers/types";

const WAIT_MS = 20 * 60 * 1000;
const POLL_MS = 15 * 1000;

/** A trigger an agent or code wrote comes off; the owner's, and one with no source, stay. */
export const clearable = (t: Trigger) => t.source === "AGENT" || t.source === "DEFAULT";

/** The stock as the rewrite reads it. */
export interface Watch {
  thesisId: string;
  ticker: string;
  direction: string | null;
  setupId: string | null;
  triggers: Trigger[];
}

/** The analyst the watch is for. */
export interface Analyst {
  id: string;
  name: string;
  userId: string;
  accountId: string;
}

/**
 * The playbook's watch triggers the rewrite puts on, priced from the chart,
 * as on a new watch: after the clear the stock carries none of them, so none
 * is skipped as already there, and one of a kind the owner's triggers hold is
 * not written beside it (writerPlaybookWrites). None on a stock with no view
 * or no playbook. Pure.
 */
export function stampFor(w: Watch, chart: PriceStructure | null, playbooks: WriterPlaybooks) {
  if ((w.direction !== "LONG" && w.direction !== "SHORT") || !isNamedSetup(w.setupId)) return { add: [], notWritten: [] };
  const staying = w.triggers.filter((t) => !clearable(t));
  const { add, notWritten } = writerPlaybookWrites({ direction: w.direction, setup_id: w.setupId }, { priceStructure: chart }, { direction: w.direction, status: "WATCHING", setupId: null, triggers: staying }, playbooks);
  return { add, notWritten };
}

/** What a line that holds does at the next check, and the decision the Writer is asked for, neither one first. */
const AT_THE_NEXT_CHECK: Partial<Record<string, [string, string]>> = {
  STOP_WATCHING: ["ending the watch", "Say whether the watch should end, and why."],
  ENTER: ["proposing the buy", "Say whether the buy should be proposed, and why."],
  REVIEW: ["waking a look at the stock", "Say whether it should, and why."],
};

/** What the Writer reads first: the run's message, written by whoever starts it. `holding` is each stamped line that holds today. */
export function brief(analyst: string, playbook: string | null, holding: Trigger[]): string {
  return [
    `Rewrite this watch under ${analyst}'s playbooks. It was written before a playbook wrote a watch's triggers; the triggers an agent wrote were taken off, and the owner's stay.`,
    playbook
      ? `Its playbook, ${playbook}, has put its watch triggers on from today's chart. Keep that playbook or name another that fits the chart today, and tailor the triggers after the save, each change with its reason.`
      : "It has no playbook yet: name the one that fits the chart today, or none, and tailor the triggers after the save, each change with its reason.",
    ...holding.map((t) => {
      const [does, ask] = AT_THE_NEXT_CHECK[t.action] ?? ["acting on it", "Say whether it should, and why."];
      return `"${describeTrigger(t)}" is true today and fires at the next check, ${does}. ${ask}`;
    }),
    "Rewrite any belief, assumption or proof-it's-wrong that names a stock price, in terms of what the business has to do.",
  ].join(" ");
}

type Entry = { at: string; ticker: string; thesisId: string; analyst: string; cleared: Trigger[] };

/** The journal's last entry for a stock (and analyst, when named), or null. */
export function lastEntry(journal: string, ticker: string, analyst?: string): Entry | null {
  const mine = journal
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Entry)
    .filter((e) => e.ticker === ticker && (!analyst || e.analyst.toLowerCase() === analyst.toLowerCase()));
  return mine.length ? mine[mine.length - 1] : null;
}

const sentences = (ts: Trigger[]) => (ts.length ? ts.map((t) => `    - ${describeTrigger(t)} (${t.source ?? "no source: kept as the owner's"})`).join("\n") : "    (none)");

/**
 * A stock's stored triggers, or how many of them can't be read. Writing back
 * only what parses would delete the rest without a word and without a journal
 * entry, so a stock with any unreadable trigger is left as it is.
 */
export function storedTriggers(raw: unknown): { triggers: Trigger[] } | { unreadable: number } {
  const r = parseTriggersResilient(raw);
  return r.dropped > 0 ? { unreadable: r.dropped } : { triggers: r.triggers as Trigger[] };
}
export const unreadableLine = (ticker: string, n: number) => `$${ticker} skipped: ${n} stored ${n === 1 ? "trigger" : "triggers"} can't be read`;

/** Take the triggers an agent or code wrote off, journaling them first, with one Activity line. Returns what came off, or that nothing could be (an unreadable trigger). */
async function clear(thesisId: string, entry: Omit<Entry, "cleared" | "at">, journalPath: string): Promise<{ off: Trigger[] } | { unreadable: number }> {
  const done = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Thesis" WHERE id = ${thesisId} FOR UPDATE`;
    const thesis = await tx.thesis.findUniqueOrThrow({ where: { id: thesisId }, select: { direction: true, status: true, triggers: true } });
    const read = storedTriggers(thesis.triggers);
    if ("unreadable" in read) return read;
    const stored = read.triggers;
    const off = stored.filter(clearable);
    // The journal first, from the row as it is now: a crash or Ctrl-C after this line is undone with --restore.
    mkdirSync(dirname(journalPath), { recursive: true });
    appendFileSync(journalPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry, cleared: off })}\n`);
    if (!off.length) return null;
    const applied = applyTriggerOps({ stored, ops: off.map((t) => ({ op: "remove" as const, id: t.id })), direction: thesis.direction, status: thesis.status, actor: "SYSTEM", mintId: () => randomUUID() });
    await tx.thesis.update({ where: { id: thesisId }, data: { triggers: applied.triggers as unknown as object[] } });
    return { off, applied };
  });
  if (!done) return { off: [] };
  if ("unreadable" in done) return done;
  await writeThesisUpdate({ thesisId, type: "UPDATED", summary: `Cleared for the rewrite under its playbook: ${done.off.map(describeTrigger).join("; ")}`, fieldChanges: { triggerOps: { from: null, to: acceptedOps(done.applied.results) } }, runId: null });
  return { off: done.off };
}

/** Take off what an agent or code wrote and put `cleared` back, with one Activity line. Returns how many went back. */
export async function putBack(thesisId: string, cleared: Trigger[], why: string): Promise<number> {
  const done = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Thesis" WHERE id = ${thesisId} FOR UPDATE`;
    const thesis = await tx.thesis.findUniqueOrThrow({ where: { id: thesisId }, select: { direction: true, status: true, triggers: true } });
    const read = storedTriggers(thesis.triggers);
    if ("unreadable" in read) {
      console.log(`    not put back: ${read.unreadable} stored triggers on it can't be read; nothing was written. Its cleared triggers are in the journal.`);
      return null;
    }
    const stored = read.triggers;
    const ops = [...stored.filter(clearable).map((t) => ({ op: "remove" as const, id: t.id })), ...cleared.map((t) => ({ op: "add" as const, trigger: t }))];
    if (!ops.length) return null;
    const applied = applyTriggerOps({ stored, ops, direction: thesis.direction, status: thesis.status, actor: "SYSTEM", mintId: () => randomUUID() });
    await tx.thesis.update({ where: { id: thesisId }, data: { triggers: applied.triggers as unknown as object[] } });
    return applied;
  });
  if (!done) return 0;
  await writeThesisUpdate({ thesisId, type: "UPDATED", summary: `Put back: ${why}`, fieldChanges: { triggerOps: { from: null, to: acceptedOps(done.results) } }, runId: null });
  for (const r of done.results.filter((x) => !x.ok)) console.log(`    not put back: ${r.text} (${r.reason})`);
  return done.results.filter((r) => r.ok && r.op === "add").length;
}

/**
 * Put the playbook's watch triggers on the way code writes its own trigger
 * lines (the fill's: lib/agent/triggers/filled.ts): through applyTriggerOps on
 * the locked row, with one Activity line that is a title. It isn't a note, so
 * it answers no review and leaves the review clock where it was (update_thesis
 * writes a note and moves the clock). Each trigger goes on in the stored shape
 * with its template's reason; one the shape or the ops refuse refuses the
 * stamp, and nothing is written.
 */
async function stampOn(thesisId: string, adds: Array<Record<string, unknown>>): Promise<{ ok: true; lines: string[] } | { ok: false; why: string }> {
  const parsed = adds.map((t) => triggerInputSchema.safeParse(t));
  const bad = parsed.find((p) => !p.success);
  if (bad && !bad.success) return { ok: false, why: bad.error.issues[0]?.message ?? "a trigger couldn't be read" };
  const triggers = parsed.map((p) => ({ ...(p.data as Trigger), id: randomUUID() }));
  const done = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Thesis" WHERE id = ${thesisId} FOR UPDATE`;
    const thesis = await tx.thesis.findUniqueOrThrow({ where: { id: thesisId }, select: { direction: true, status: true, triggers: true } });
    const read = storedTriggers(thesis.triggers);
    if ("unreadable" in read) return { refused: `${read.unreadable} stored triggers can't be read` };
    const stored = read.triggers;
    const applied = applyTriggerOps({ stored, ops: triggers.map((t) => ({ op: "add" as const, trigger: t })), direction: thesis.direction, status: thesis.status, actor: "SYSTEM", mintId: () => randomUUID() });
    const refused = applied.results.filter((r) => !r.ok);
    if (refused.length || applied.results.length !== triggers.length) return { refused: refused.map((r) => `${r.text}: ${r.reason}`).join("; ") || "not all of them landed" };
    await tx.thesis.update({ where: { id: thesisId }, data: { triggers: applied.triggers as unknown as object[] } });
    return { applied };
  });
  if (!done.applied) return { ok: false, why: done.refused ?? "not all of them landed" };
  const lines = done.applied.results.map((r) => r.text);
  await writeThesisUpdate({ thesisId, type: "UPDATED", summary: `Its playbook's watch triggers, put on for the rewrite: ${triggers.map(describeTrigger).join("; ")}`, fieldChanges: { triggerOps: { from: null, to: acceptedOps(done.applied.results) } }, runId: null });
  return { ok: true, lines };
}

export type Rewritten = { ok: true; childRunId: string; cleared: Trigger[]; stamped: string[] } | { ok: false; why: string; putBack: number; skipped?: true };

/**
 * One watch's rewrite up to the send: journal and clear, put the playbook's
 * watch triggers on, send it to the Writer. On a refused stamp or a failed
 * send, the cleared triggers go back on at once and it says why.
 */
export async function rewriteOne(o: { thesisId: string; ticker: string; analyst: Analyst; chart: PriceStructure | null; playbooks: WriterPlaybooks; brief: string; journalPath: string }): Promise<Rewritten> {
  const cleared = await clear(o.thesisId, { ticker: o.ticker, thesisId: o.thesisId, analyst: o.analyst.name }, o.journalPath);
  // Nothing is cleared, journaled, stamped or sent on a stock with a trigger that can't be read.
  if ("unreadable" in cleared) return { ok: false, skipped: true, why: unreadableLine(o.ticker, cleared.unreadable), putBack: 0 };
  const off = cleared.off;
  const row = await prisma.thesis.findUniqueOrThrow({ where: { id: o.thesisId }, select: { direction: true, setupId: true, triggers: true } });
  const plan = stampFor({ thesisId: o.thesisId, ticker: o.ticker, direction: row.direction, setupId: row.setupId, triggers: parseTriggersResilient(row.triggers).triggers as Trigger[] }, o.chart, o.playbooks);
  const stamped: string[] = [];
  if (plan.add.length) {
    const on = await stampOn(o.thesisId, plan.add);
    if (!on.ok) {
      const why = `the playbook's triggers were refused (${on.why})`;
      return { ok: false, why, putBack: await putBack(o.thesisId, off, why) };
    }
    stamped.push(...on.lines);
  }
  const ctx = createToolContext({ runId: "", userId: o.analyst.userId, accountId: o.analyst.accountId, analystId: o.analyst.id });
  const sent = (await dispatchThesisResearch(ctx).execute!({ ticker: o.ticker, brief: o.brief } as never, { messages: [] } as never)) as { summary?: string; error?: string; data?: { childRunId?: string | null; note?: string } };
  const childRunId = sent.data?.childRunId;
  if (!childRunId) {
    const why = `the rewrite couldn't be sent to the Writer (${sent.data?.note ?? sent.summary ?? sent.error ?? "no reason given"})`;
    return { ok: false, why, putBack: await putBack(o.thesisId, off, why) };
  }
  return { ok: true, childRunId, cleared: off, stamped };
}

/** The Writer run's status once it stops running, or "STILL_RUNNING" after the wait. */
async function waitFor(runId: string): Promise<string> {
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    const run = await prisma.researchRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (run && run.status !== "RUNNING" && run.status !== "PENDING") return run.status;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return "STILL_RUNNING";
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Put a stock back from the journal: only a watch, and never while its Writer runs. */
async function restore(ticker: string, analystName: string | undefined, journalPath: string, dry: boolean) {
  const entry = existsSync(journalPath) ? lastEntry(readFileSync(journalPath, "utf8"), ticker, analystName) : null;
  if (!entry) return console.log(`$${ticker}: nothing in the journal (${journalPath}).`);
  const row = await prisma.thesis.findUnique({ where: { id: entry.thesisId }, select: { status: true, retiredReason: true, triggers: true, accountId: true, researchRun: { select: { agentConfigId: true } } } });
  if (!row) return console.log(`$${ticker}: its thesis ${entry.thesisId} is gone.`);
  const now = parseTriggersResilient(row.triggers).triggers as Trigger[];
  console.log(`$${ticker} · ${entry.analyst} · thesis ${entry.thesisId} (${row.status}), cleared ${entry.at}. Back on (${entry.cleared.length}):\n${sentences(entry.cleared)}\n  and off, every trigger an agent or code wrote now:\n${sentences(now.filter(clearable))}`);
  // Nothing here reopens a stock: a passed or dropped thesis isn't one watch_again takes back (checkWatchingOptOut).
  if (row.status !== "WATCHING") return console.log(`  not restored: $${ticker} is ${row.status}${row.retiredReason ? ` (${row.retiredReason})` : ""}, not on watch. Its cleared triggers are in the journal: ${journalPath}.`);
  if (dry) return;
  const busy = row.accountId ? await findInFlightWriter(row.accountId, ticker, row.researchRun?.agentConfigId) : null;
  if (busy?.status === "RUNNING") return console.log(`  not restored: its Writer run ${busy.id} is running. Run --restore ${ticker} again when it ends.`);
  console.log(`  put back ${await putBack(entry.thesisId, entry.cleared, "from the rewrite journal")}.`);
}

export async function main(argv: string[] = process.argv) {
  const dry = argv.includes("--dry-run");
  const restoring = arg(argv, "--restore")?.toUpperCase();
  const analystName = arg(argv, "--analyst");
  const journalPath = arg(argv, "--journal") ?? join(homedir(), "hindsight-rewrite-watches", "journal.jsonl");
  if (restoring) return restore(restoring, analystName, journalPath, dry);
  const tickers = (arg(argv, "--tickers") ?? "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  if (!tickers.length) throw new Error("Name the watches: --tickers MA,TRV (--dry-run to only print), or --restore MA.");

  const rows = await prisma.thesis.findMany({
    where: { ticker: { in: tickers }, status: "WATCHING", ...(analystName ? { researchRun: { agentConfig: { name: { equals: analystName, mode: "insensitive" } } } } : {}) },
    select: { id: true, ticker: true, direction: true, setupId: true, triggers: true, researchRun: { select: { agentConfig: { select: { id: true, name: true, userId: true, accountId: true } } } } },
  });
  console.log(dry ? "DRY RUN: nothing is written or sent.\n" : "");
  for (const ticker of tickers) {
    const found = rows.filter((r) => r.ticker === ticker);
    if (!found.length) { console.log(`$${ticker}: not a watch${analystName ? ` of ${analystName}` : ""}; skipped.\n`); continue; }
    if (found.length > 1) { console.log(`$${ticker}: watched by ${found.map((r) => r.researchRun?.agentConfig?.name ?? "no analyst").join(" and ")}; name one with --analyst. Skipped.\n`); continue; }
    const row = found[0];
    const analyst = row.researchRun?.agentConfig;
    if (!analyst) { console.log(`$${ticker}: its thesis has no analyst; skipped.\n`); continue; }
    const read = storedTriggers(row.triggers);
    if ("unreadable" in read) { console.log(`${unreadableLine(ticker, read.unreadable)}.\n`); continue; }
    const watch: Watch = { thesisId: row.id, ticker, direction: row.direction, setupId: row.setupId, triggers: read.triggers };

    const chart = await loadFillChart(ticker);
    const playbooks = await loadPlaybooks(analyst.accountId);
    const plan = stampFor(watch, chart, playbooks);
    const planned = plan.add.map((t, i) => ({ ...(triggerInputSchema.parse(t) as Trigger), id: `stamp-${i}` }));
    const now = planned.length ? await readNow(row.id, { userId: analyst.userId, analystId: analyst.id }, planned) : null;
    const holding = now ? holdingNow(planned, now.read) : [];
    const text = brief(analyst.name, isNamedSetup(row.setupId) ? row.setupId : null, holding);
    console.log(`$${ticker} · ${analyst.name} · its playbook: ${row.setupId ?? "none"} · thesis ${row.id}`);
    console.log(`  comes off (${watch.triggers.filter(clearable).length}):\n${sentences(watch.triggers.filter(clearable))}`);
    console.log(`  stays, the owner's (${watch.triggers.filter((t) => !clearable(t)).length}):\n${sentences(watch.triggers.filter((t) => !clearable(t)))}`);
    console.log(`  goes on, the playbook's (${planned.length}):\n${planned.length ? planned.map((t) => `    - ${describeTrigger(t)}`).join("\n") : "    (none)"}`);
    for (const n of plan.notWritten) console.log(`    not written: ${n.why} (${n.reason})`);
    console.log(`  true today: ${holding.length ? holding.map(describeTrigger).join("; ") : "none"}${now || !planned.length ? "" : " (no price to read them against)"}`);
    console.log(`  brief: ${text}`);
    if (dry) { console.log(""); continue; }

    const busy = await findInFlightWriter(analyst.accountId, ticker, analyst.id);
    if (busy) { console.log(`  skipped: a Writer run on $${ticker} started ${busy.startedAt.toISOString()} (run ${busy.id}, ${busy.status}).\n`); continue; }

    const done = await rewriteOne({ thesisId: row.id, ticker, analyst, chart, playbooks, brief: text, journalPath });
    if (!done.ok && done.skipped) { console.log(`${done.why}.\n`); continue; }
    if (!done.ok) {
      console.log(`  stopped: ${done.why}. Put back ${done.putBack}.\n`);
      break;
    }
    console.log(`  cleared ${done.cleared.length} (journal: ${journalPath}); put on ${done.stamped.length}: ${done.stamped.join("; ") || "none"}.`);
    console.log(`  sent to the Writer: run ${done.childRunId} (/runs/${done.childRunId}). Waiting…`);
    const status = await waitFor(done.childRunId);
    if (status === "STILL_RUNNING") {
      console.log(`  the Writer run hasn't ended after ${WAIT_MS / 60000} minutes. Nothing put back, so it can't race the run. When it ends, read the stock; to undo: --restore ${ticker}. Stopping.\n`);
      break;
    }
    const after = await prisma.thesis.findUniqueOrThrow({ where: { id: row.id }, select: { status: true, retiredReason: true, setupId: true, triggers: true } });
    const left = parseTriggersResilient(after.triggers).triggers as Trigger[];
    console.log(`  Writer ${status}. $${ticker} is ${after.status}, playbook ${after.setupId ?? "none"}, triggers now (${left.length}):\n${sentences(left)}`);
    if (after.status !== "WATCHING") {
      console.log(`  $${ticker} is ${after.status}${after.retiredReason ? ` (${after.retiredReason})` : ""} after its rewrite, not on watch. Its cleared triggers are in the journal: ${journalPath}. Stopping.\n`);
      break;
    }
    if (status !== "COMPLETE" || !left.some(clearable)) {
      const why = status !== "COMPLETE" ? `its rewrite didn't complete (${status})` : "its rewrite left nothing an agent wrote on it";
      console.log(`  ${why}: put back ${await putBack(row.id, done.cleared, why)}. Stopping.\n`);
      break;
    }
    console.log("");
  }
  if (dry) {
    // Across every watch, not only the ones named: how many this script would leave as they are.
    const all = await prisma.thesis.findMany({ where: { status: "WATCHING" }, select: { ticker: true, triggers: true } });
    const unreadable = all.filter((t) => "unreadable" in storedTriggers(t.triggers)).map((t) => t.ticker);
    console.log(`Of the ${all.length} watches, ${unreadable.length} would be skipped: stored triggers that can't be read${unreadable.length ? ` (${unreadable.join(", ")})` : ""}.`);
  }
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
