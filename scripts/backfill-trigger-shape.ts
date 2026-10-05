/**
 * Rewrite every stored trigger list in the condition shape, once.
 *
 * > Design: docs/plans/TRIGGER_TYPES.md §9 (the cutover)
 *
 * Since the cutover every write stores the shape (lib/prisma.ts) and every
 * read accepts both, so rows written before it still hold kinds. This turns
 * them into the shape. A removed kind (REVIEW_DATE_HIT) is kept verbatim.
 * Fire history, ids, rationales and every other field are untouched: only
 * each trigger's `predicate` changes.
 *
 * The dry run prints how many conditions each catalog entry receives, and
 * every row that would change with each trigger before and after. Nothing is
 * written without --apply. A row is written only if its triggers are still
 * exactly what was read, so a save landing mid-run is never overwritten
 * (re-run to pick it up). Afterwards it counts the rows still holding a kind:
 * zero is the proof.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-trigger-shape.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/backfill-trigger-shape.ts --apply   # write
 *
 * The way back is scripts/down-trigger-shape.ts.
 */

import { prismaRaw as prisma } from "@/lib/prisma";
import { conditionsOf, isShape, toStoredPredicate, toStoredTriggers } from "@/lib/agent/triggers/condition";

const APPLY = process.argv.includes("--apply");

type Row = { table: "Thesis" | "AgentConfig" | "Account"; id: string; label: string; triggers: unknown };

async function readRows(): Promise<Row[]> {
  const [theses, analysts, accounts] = await Promise.all([
    prisma.thesis.findMany({ select: { id: true, ticker: true, status: true, triggers: true } }),
    prisma.agentConfig.findMany({ select: { id: true, name: true, triggers: true } }),
    prisma.account.findMany({ select: { id: true, triggers: true } }),
  ]);
  return [
    ...theses.map((t) => ({ table: "Thesis" as const, id: t.id, label: `${t.ticker} (${t.status})`, triggers: t.triggers })),
    ...analysts.map((a) => ({ table: "AgentConfig" as const, id: a.id, label: a.name, triggers: a.triggers })),
    ...accounts.map((a) => ({ table: "Account" as const, id: a.id, label: "account", triggers: a.triggers })),
  ];
}

/** Trigger predicates still stored as a kind (a removed kind counts separately: it stays). */
function kindsIn(triggers: unknown): { kinds: number; removed: number } {
  let kinds = 0;
  let removed = 0;
  for (const t of Array.isArray(triggers) ? triggers : []) {
    const p = (t as { predicate?: unknown })?.predicate;
    if (isShape(p)) continue;
    if (isShape(toStoredPredicate(p))) kinds++;
    else removed++;
  }
  return { kinds, removed };
}

async function write(row: Row, next: unknown) {
  // Only if nothing saved over the row since it was read.
  const where = { id: row.id, triggers: { equals: row.triggers as object } };
  const data = { triggers: next as object };
  const r =
    row.table === "Thesis"
      ? await prisma.thesis.updateMany({ where, data })
      : row.table === "AgentConfig"
        ? await prisma.agentConfig.updateMany({ where, data })
        : await prisma.account.updateMany({ where, data });
  return r.count === 1;
}

async function main() {
  const rows = await readRows();
  const perMeasure = new Map<string, number>();
  const changed: Array<{ row: Row; next: unknown }> = [];

  for (const row of rows) {
    const next = toStoredTriggers(row.triggers);
    if (JSON.stringify(next) === JSON.stringify(row.triggers)) continue;
    changed.push({ row, next });
    for (const t of next as Array<{ predicate: unknown }>) {
      if (!isShape(t.predicate)) continue;
      for (const c of conditionsOf(t.predicate)) perMeasure.set(c.watch, (perMeasure.get(c.watch) ?? 0) + 1);
    }
  }

  const before = rows.reduce((n, r) => n + kindsIn(r.triggers).kinds, 0);
  const removed = rows.reduce((n, r) => n + kindsIn(r.triggers).removed, 0);
  console.log(`${rows.length} rows read; ${changed.length} hold kinds (${before} trigger conditions); ${removed} removed-kind triggers stay as they are.\n`);
  console.log("Conditions per catalog entry:");
  for (const [watch, n] of [...perMeasure].sort((a, b) => b[1] - a[1])) console.log(`  ${watch.padEnd(10)} ${n}`);

  console.log("\nEvery row that changes:");
  for (const { row, next } of changed) {
    console.log(`\n${row.table} ${row.label} ${row.id}`);
    const was = row.triggers as Array<{ id?: string; action?: string; predicate: unknown }>;
    (next as Array<{ predicate: unknown }>).forEach((t, i) => {
      if (JSON.stringify(t.predicate) === JSON.stringify(was[i]?.predicate)) return;
      console.log(`  ${String(was[i]?.action ?? "").padEnd(6)} ${JSON.stringify(was[i]?.predicate)}\n         → ${JSON.stringify(t.predicate)}`);
    });
  }

  if (!APPLY) {
    console.log(`\nDry run: nothing written. Re-run with --apply to write ${changed.length} rows.`);
    return;
  }

  let written = 0;
  const skipped: string[] = [];
  for (const { row, next } of changed) {
    if (await write(row, next)) written++;
    else skipped.push(`${row.table} ${row.label} ${row.id}`);
  }
  console.log(`\nWrote ${written} rows.${skipped.length ? ` Skipped ${skipped.length} saved over mid-run (re-run): ${skipped.join(", ")}` : ""}`);
  const after = (await readRows()).reduce((n, r) => n + kindsIn(r.triggers).kinds, 0);
  console.log(`Trigger conditions still stored as a kind: ${after}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
