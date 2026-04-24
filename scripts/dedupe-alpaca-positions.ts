/**
 * dedupe-alpaca-positions.ts
 *
 * Reconciles an Alpaca paper account against the DB `Position` table in
 * exactly one direction: Alpaca becomes the source of truth for what's
 * currently open, DB rows are the historical record that should match it.
 *
 * Policy:
 *   1. MATCH  (same symbol + direction in both Alpaca and DB as OPEN):
 *      KEEP the DB row. Sync quantity + avgCost from Alpaca so the app
 *      displays the true state. Position.id, analystId, thesis linkage,
 *      targetPrice, stopLoss — all preserved. History intact.
 *
 *   2. ALPACA-ONLY (position exists on Alpaca but has no matching DB
 *      OPEN row): CLOSE on Alpaca. These are the orphans created by
 *      `place_trade` failing to persist. User wants them nuked.
 *
 *   3. DB-ONLY (DB row says OPEN but Alpaca has nothing): the agent
 *      closed it on Alpaca but never updated the DB. Mark the DB row
 *      CLOSED with closePrice=avgCost (we can't reconstruct the actual
 *      close price), realizedPnl=0, outcome='BREAKEVEN', closeReason=
 *      'RECONCILE_MANUAL'. The row stays as history; its P&L impact is
 *      neutralized.
 *
 * Usage:
 *   npx tsx scripts/dedupe-alpaca-positions.ts                # dry run
 *   npx tsx scripts/dedupe-alpaca-positions.ts --execute      # actually do it
 *
 * The dry run prints EVERY action it would take so you can sanity-check
 * before committing. The --execute flag is required to mutate anything.
 */

import { prisma } from "@/lib/prisma";
import {
  getAllPositions,
  closePosition as closeAlpacaPosition,
} from "@/lib/alpaca";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";

const EXECUTE = process.argv.includes("--execute");

function fmtMoney(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

async function main() {
  const user = await prisma.user
    .findFirst({ select: { id: true, email: true } })
    .catch(() => null);
  if (!user) {
    console.error("No user found.");
    process.exit(1);
  }

  const creds = await resolveAlpacaCredentials(user.id);
  if (!creds) {
    console.error("No Alpaca credentials resolved for this user.");
    process.exit(1);
  }

  console.log(`→ Dedupe for ${user.email ?? user.id}`);
  console.log(`→ Mode: ${EXECUTE ? "EXECUTE (will mutate)" : "DRY RUN"}\n`);

  const [alpacaPositions, dbPositions] = await Promise.all([
    getAllPositions(creds),
    prisma.position.findMany({
      where: { userId: user.id, status: "OPEN" },
      select: {
        id: true,
        symbol: true,
        direction: true,
        quantity: true,
        avgCost: true,
        analyst: { select: { name: true } },
      },
    }),
  ]);

  console.log(`Alpaca: ${alpacaPositions.length} open positions`);
  console.log(`DB:     ${dbPositions.length} open positions\n`);

  const key = (sym: string, side: string) =>
    `${sym.toUpperCase()}:${side.toUpperCase()}`;
  // Normalize Alpaca's "long" / "short" to DB's "LONG" / "SHORT"
  const alpacaDirOf = (p: (typeof alpacaPositions)[number]): "LONG" | "SHORT" =>
    p.side === "short" ? "SHORT" : "LONG";

  const alpacaBy = new Map<string, (typeof alpacaPositions)[number]>();
  for (const p of alpacaPositions) alpacaBy.set(key(p.symbol, alpacaDirOf(p)), p);

  const dbBy = new Map<string, (typeof dbPositions)[number]>();
  for (const p of dbPositions) dbBy.set(key(p.symbol, p.direction), p);

  // ── Classify ───────────────────────────────────────────────────────────
  const matched: Array<{
    k: string;
    alpaca: (typeof alpacaPositions)[number];
    db: (typeof dbPositions)[number];
  }> = [];
  const alpacaOnly: Array<(typeof alpacaPositions)[number]> = [];
  const dbOnly: Array<(typeof dbPositions)[number]> = [];

  for (const [k, a] of alpacaBy) {
    const d = dbBy.get(k);
    if (d) matched.push({ k, alpaca: a, db: d });
    else alpacaOnly.push(a);
  }
  for (const [k, d] of dbBy) {
    if (!alpacaBy.has(k)) dbOnly.push(d);
  }

  // ── Print the plan ─────────────────────────────────────────────────────
  console.log(
    `MATCHED (${matched.length}) — will KEEP the DB row, sync qty/avgCost:\n`,
  );
  for (const { alpaca, db } of matched) {
    const aQty = parseFloat(alpaca.qty);
    const aAvg = parseFloat(alpaca.avg_entry_price);
    const qtyChange = Math.abs(aQty) !== db.quantity ? " ← QTY CHANGED" : "";
    const avgChange =
      Math.abs(aAvg - db.avgCost) > 0.01 ? " ← AVG COST CHANGED" : "";
    console.log(
      `  ${alpaca.symbol.padEnd(6)} ${alpaca.side.padEnd(5)}  ` +
        `db: qty=${String(db.quantity).padStart(6)} avg=${fmtMoney(db.avgCost).padStart(10)}  →  ` +
        `alpaca: qty=${String(Math.abs(aQty)).padStart(6)} avg=${fmtMoney(aAvg).padStart(10)}` +
        qtyChange + avgChange,
    );
  }

  console.log(
    `\nALPACA-ONLY (${alpacaOnly.length}) — orphans, will CLOSE on Alpaca:\n`,
  );
  let orphanValue = 0;
  for (const p of alpacaOnly) {
    const v = parseFloat(p.market_value);
    orphanValue += Math.abs(v);
    console.log(
      `  ${p.symbol.padEnd(6)} ${p.side.padEnd(5)}  qty=${p.qty.padStart(6)}  ` +
        `mkt=${fmtMoney(v).padStart(12)}  pnl=${fmtMoney(parseFloat(p.unrealized_pl)).padStart(10)}`,
    );
  }
  console.log(`  ─ Total exposure to unwind: ${fmtMoney(orphanValue)}\n`);

  console.log(
    `DB-ONLY (${dbOnly.length}) — Alpaca has no record, will mark DB CLOSED:\n`,
  );
  for (const p of dbOnly) {
    console.log(
      `  ${p.symbol.padEnd(6)} ${p.direction.padEnd(5)}  qty=${String(p.quantity).padStart(6)}  ` +
        `avg=${fmtMoney(p.avgCost).padStart(10)}  analyst=${p.analyst?.name ?? "?"}  (Position.id=${p.id})`,
    );
  }

  if (!EXECUTE) {
    console.log(
      `\n─────────────────────────────────────────────────────────────────
DRY RUN — nothing changed. Review the lists above. When you're
satisfied with the plan, re-run with:

  npx tsx scripts/dedupe-alpaca-positions.ts --execute

The --execute pass:
  • Calls closePosition(symbol) on Alpaca for each ALPACA-ONLY row
    (buys to cover shorts, sells to exit longs). Paper-trading only.
  • Updates each MATCHED DB row's quantity + avgCost from Alpaca.
  • Sets each DB-ONLY row to status=CLOSED, closePrice=avgCost,
    realizedPnl=0, outcome=BREAKEVEN, closeReason=RECONCILE_MANUAL,
    closedAt=NOW.
─────────────────────────────────────────────────────────────────`,
    );
    await prisma.$disconnect();
    return;
  }

  // ── EXECUTE ────────────────────────────────────────────────────────────
  console.log("\n═══ EXECUTING ═══\n");

  // 1) Close orphans on Alpaca
  let orphansClosed = 0;
  let orphansFailed = 0;
  for (const p of alpacaOnly) {
    try {
      await closeAlpacaPosition(p.symbol, creds);
      console.log(`  ✓ Closed ${p.symbol} (${p.side}) on Alpaca`);
      orphansClosed++;
    } catch (err) {
      console.error(
        `  ✗ FAILED to close ${p.symbol}: ${err instanceof Error ? err.message : err}`,
      );
      orphansFailed++;
    }
  }

  // 2) Sync matched DB rows' qty/avgCost from Alpaca
  let synced = 0;
  for (const { alpaca, db } of matched) {
    const aQty = Math.abs(parseFloat(alpaca.qty));
    const aAvg = parseFloat(alpaca.avg_entry_price);
    if (Math.abs(aQty - db.quantity) < 0.0001 && Math.abs(aAvg - db.avgCost) < 0.01) {
      continue; // no-op
    }
    await prisma.position.update({
      where: { id: db.id },
      data: { quantity: aQty, avgCost: aAvg },
    });
    console.log(
      `  ✓ Synced DB ${db.symbol}: qty ${db.quantity}→${aQty}, avg ${db.avgCost}→${aAvg}`,
    );
    synced++;
  }

  // 3) Mark DB-only rows as CLOSED (neutralized)
  let closed = 0;
  for (const p of dbOnly) {
    await prisma.position.update({
      where: { id: p.id },
      data: {
        status: "CLOSED",
        closePrice: p.avgCost,
        realizedPnl: 0,
        outcome: "BREAKEVEN",
        closeReason: "RECONCILE_MANUAL",
        closedAt: new Date(),
      },
    });
    console.log(`  ✓ Marked DB ${p.symbol} CLOSED (Position.id=${p.id})`);
    closed++;
  }

  console.log(`\n═══ DONE ═══`);
  console.log(`  Orphans closed on Alpaca: ${orphansClosed}`);
  if (orphansFailed > 0)
    console.log(`  Orphans FAILED to close:  ${orphansFailed} ← re-run or close manually`);
  console.log(`  Matched rows synced:      ${synced}`);
  console.log(`  DB rows neutralized:      ${closed}`);
  console.log(
    `\nAlpaca and DB should now agree on what's open. Re-run this script\nwith no flags to verify (dry run will show zero changes needed).`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
