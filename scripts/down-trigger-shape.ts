/**
 * The way back from scripts/backfill-trigger-shape.ts: rewrite every stored
 * trigger list from the condition shape into the kinds, for a rollback of the
 * cutover.
 *
 * > Design: docs/plans/TRIGGER_TYPES.md §9 (the cutover)
 *
 * Code from before the cutover reads only kinds, so run this right after a
 * revert of the cutover deploys (until then the app keeps storing the shape).
 * A condition no kind can say is left in the shape and listed: nothing writes
 * one until the agents and the form can, so the list should be empty.
 *
 * Not byte-exact. A kind's field that only restated its default is not
 * written back. Production, read-only, 2026-10-06: 16 of 950 rows (17
 * triggers) come back without `from: "LAST_REVIEW"` (10), `minSurprisePct`
 * 0 / -3 / -5 (7) or `side: "AFTER"` (1). The old checker read each of them
 * as the default, so every trigger decides the same.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/down-trigger-shape.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/down-trigger-shape.ts --apply   # write
 */

import { prismaRaw as prisma } from "@/lib/prisma";
import { isShape, viewTriggers } from "@/lib/agent/triggers/condition";

const APPLY = process.argv.includes("--apply");

async function main() {
  const [theses, analysts, accounts] = await Promise.all([
    prisma.thesis.findMany({ select: { id: true, ticker: true, triggers: true } }),
    prisma.agentConfig.findMany({ select: { id: true, name: true, triggers: true } }),
    prisma.account.findMany({ select: { id: true, triggers: true } }),
  ]);
  const rows = [
    ...theses.map((t) => ({ table: "Thesis" as const, id: t.id, label: t.ticker, triggers: t.triggers })),
    ...analysts.map((a) => ({ table: "AgentConfig" as const, id: a.id, label: a.name, triggers: a.triggers })),
    ...accounts.map((a) => ({ table: "Account" as const, id: a.id, label: "account", triggers: a.triggers })),
  ];

  const changed = rows.flatMap((row) => {
    const next = viewTriggers(row.triggers);
    return JSON.stringify(next) === JSON.stringify(row.triggers) ? [] : [{ row, next }];
  });
  const stuck = changed.flatMap(({ row, next }) =>
    (next as Array<{ id?: string; predicate: unknown }>).filter((t) => isShape(t.predicate)).map((t) => `${row.table} ${row.label} ${t.id}`),
  );
  console.log(`${rows.length} rows read; ${changed.length} hold the shape.`);
  console.log(stuck.length ? `No kind can say these, so they stay in the shape:\n  ${stuck.join("\n  ")}` : "Every condition has a kind.");

  if (!APPLY) {
    console.log(`Dry run: nothing written. Re-run with --apply to write ${changed.length} rows.`);
    return;
  }
  let written = 0;
  for (const { row, next } of changed) {
    const where = { id: row.id, triggers: { equals: row.triggers as object } };
    const data = { triggers: next as object };
    const r =
      row.table === "Thesis"
        ? await prisma.thesis.updateMany({ where, data })
        : row.table === "AgentConfig"
          ? await prisma.agentConfig.updateMany({ where, data })
          : await prisma.account.updateMany({ where, data });
    written += r.count;
  }
  console.log(`Wrote ${written} of ${changed.length} rows (any short were saved over mid-run: re-run).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
