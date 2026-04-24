/**
 * reconcile-alpaca-positions.ts
 *
 * Read-only diagnostic. Prints the diff between Alpaca paper account
 * positions and DB `Position` rows so the user can see why the Trades
 * page looks "empty" when Alpaca shows significant long/short exposure.
 *
 * The Trades page lists DB Position rows. If the agent placed trades
 * that never persisted, or if positions were placed directly in Alpaca
 * outside the agent, the two sets drift — Alpaca knows about them,
 * the DB does not, and the UI has no way to display them.
 *
 * This script does NOT mutate anything. It prints three lists:
 *
 *   1. IN_ALPACA_NOT_IN_DB  — Alpaca positions the DB is missing. These
 *                             are your invisible positions. Root cause
 *                             is usually `place_trade` failing to
 *                             commit the DB row after Alpaca accepted
 *                             the order, OR positions opened outside
 *                             the agent.
 *
 *   2. IN_DB_NOT_IN_ALPACA  — DB rows Alpaca has no record of. Usually
 *                             closed on Alpaca without the close being
 *                             reconciled back to the DB (reconcile-orders
 *                             Inngest job timing gap).
 *
 *   3. IN_BOTH              — Sanity check that matched positions have
 *                             the same quantity / side. Mismatch here
 *                             means one side is stale.
 *
 * Remediation is manual and depends on which direction the drift is in.
 * See the README block printed at the end.
 *
 * Run:
 *   npx tsx scripts/reconcile-alpaca-positions.ts
 */

import { prisma } from "@/lib/prisma";
import { getAllPositions } from "@/lib/alpaca";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";

function fmtMoney(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

async function main() {
  // The app is single-tenant today — pick the first user. Extend if we
  // ever go multi-user.
  const user = await prisma.user
    .findFirst({ select: { id: true, email: true } })
    .catch(() => null);

  if (!user) {
    console.error(
      "No user row found. Run this against a database that has at least one user.",
    );
    process.exit(1);
  }

  console.log(`→ Reconciling for user ${user.email ?? user.id}\n`);

  const creds = await resolveAlpacaCredentials(user.id);
  if (!creds) {
    console.error(
      "No Alpaca credentials resolved for this user. Check the ApiKey table / env fallback.",
    );
    process.exit(1);
  }

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

  console.log(`Alpaca reports ${alpacaPositions.length} open positions`);
  console.log(`DB has         ${dbPositions.length} open positions\n`);

  // Key by symbol+side. Alpaca rarely has two distinct rows for the same
  // symbol (long and short would still be two separate Alpaca positions)
  // so (symbol, side) is unique enough for a diff.
  const key = (sym: string, side: string) =>
    `${sym.toUpperCase()}:${side.toUpperCase()}`;

  const alpacaBySymbol = new Map<string, (typeof alpacaPositions)[number]>();
  for (const p of alpacaPositions) {
    alpacaBySymbol.set(key(p.symbol, p.side), p);
  }

  const dbBySymbol = new Map<string, (typeof dbPositions)[number]>();
  for (const p of dbPositions) {
    dbBySymbol.set(key(p.symbol, p.direction), p);
  }

  // ── IN_ALPACA_NOT_IN_DB — the invisible positions ───────────────────────
  const onlyAlpaca = [...alpacaBySymbol.entries()].filter(
    ([k]) => !dbBySymbol.has(k),
  );
  if (onlyAlpaca.length > 0) {
    console.log(
      `⚠️  IN_ALPACA_NOT_IN_DB (${onlyAlpaca.length}) — invisible on the Trades page:\n`,
    );
    let totalValue = 0;
    for (const [, p] of onlyAlpaca) {
      const v = parseFloat(p.market_value);
      totalValue += Math.abs(v);
      console.log(
        `  ${p.symbol.padEnd(6)} ${p.side.padEnd(5)}  qty=${p.qty.padStart(6)}  ` +
          `avg=${fmtMoney(parseFloat(p.avg_entry_price)).padStart(10)}  ` +
          `mkt=${fmtMoney(v).padStart(12)}  ` +
          `pnl=${fmtMoney(parseFloat(p.unrealized_pl)).padStart(10)}`,
      );
    }
    console.log(
      `\n  Total market value hidden: ${fmtMoney(totalValue)}\n`,
    );
  } else {
    console.log("✓ No invisible positions on Alpaca side.\n");
  }

  // ── IN_DB_NOT_IN_ALPACA — DB thinks it's open, Alpaca doesn't ───────────
  const onlyDb = [...dbBySymbol.entries()].filter(
    ([k]) => !alpacaBySymbol.has(k),
  );
  if (onlyDb.length > 0) {
    console.log(
      `⚠️  IN_DB_NOT_IN_ALPACA (${onlyDb.length}) — DB thinks these are still open but Alpaca says no:\n`,
    );
    for (const [, p] of onlyDb) {
      console.log(
        `  ${p.symbol.padEnd(6)} ${p.direction.padEnd(5)}  qty=${String(p.quantity).padStart(6)}  ` +
          `avg=${fmtMoney(p.avgCost).padStart(10)}  ` +
          `analyst=${p.analyst?.name ?? "?"}  (Position.id=${p.id})`,
      );
    }
    console.log();
  } else {
    console.log("✓ No stale open DB positions.\n");
  }

  // ── IN_BOTH — sanity check for quantity / side mismatch ─────────────────
  const both = [...alpacaBySymbol.keys()].filter((k) => dbBySymbol.has(k));
  const mismatches = both.filter((k) => {
    const a = alpacaBySymbol.get(k)!;
    const d = dbBySymbol.get(k)!;
    return Math.abs(parseFloat(a.qty) - d.quantity) > 0.01;
  });
  if (mismatches.length > 0) {
    console.log(
      `⚠️  QUANTITY_MISMATCH (${mismatches.length}) — matched symbol+side but quantities differ:\n`,
    );
    for (const k of mismatches) {
      const a = alpacaBySymbol.get(k)!;
      const d = dbBySymbol.get(k)!;
      console.log(
        `  ${a.symbol.padEnd(6)}  alpaca=${a.qty}  db=${d.quantity}  (Position.id=${d.id})`,
      );
    }
    console.log();
  } else if (both.length > 0) {
    console.log(`✓ ${both.length} matched positions have consistent quantities.\n`);
  }

  // ── Remediation guide ───────────────────────────────────────────────────
  console.log(
    `───────────────────────────────────────────────────────────────────
REMEDIATION

IN_ALPACA_NOT_IN_DB (invisible positions):
  These are on your Alpaca account but have no Position row. Options:
    a) Liquidate them — Alpaca UI or \`closePosition()\` by symbol.
       Zero-attribution orphans go away; DB stays clean.
    b) Attribute them to an analyst — not supported by this script
       because it requires choosing an analyst AND a thesis per
       position, both of which are irrecoverable from Alpaca alone.
       Manual insert or a follow-up admin UI.

IN_DB_NOT_IN_ALPACA (stale DB rows):
  These rows claim status='OPEN' but Alpaca has already closed them.
  The reconcile-orders Inngest job likely missed the fill. Fix by
  manually setting status='CLOSED', closePrice, closedAt on each row:

    UPDATE "Position"
       SET status='CLOSED', "closePrice"=<last price>, "closedAt"=NOW()
     WHERE id='<id>';

  Or write a one-shot that walks these rows and pulls their close
  data from Alpaca's \`/v2/positions/history\` endpoint.

QUANTITY_MISMATCH:
  Usually a partial close / scale-in/out that wasn't captured. Pick
  which side is authoritative (almost always Alpaca) and overwrite
  the DB quantity + avgCost.
───────────────────────────────────────────────────────────────────`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
