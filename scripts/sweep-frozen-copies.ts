/**
 * sweep-frozen-copies.ts — take the stamped copies off the book (DAV-322).
 *
 *   npx tsx --env-file=.env.local scripts/sweep-frozen-copies.ts            # prints, changes nothing
 *   npx tsx --env-file=.env.local scripts/sweep-frozen-copies.ts --apply    # writes
 *
 * Every removal goes through `applyTriggerDelete` — the same function the
 * trigger popover calls — so each one lands as its own Activity line with
 * the principal named, and the ratchet, the ladder check and the audit row
 * all run exactly as they do when Dave clicks the X. No SQL.
 *
 * Which rungs: `frozenCopies` in lib/agent/triggers/frozen-copy.ts. This
 * file only finds the rows and calls the function.
 */
import { prisma } from "@/lib/prisma";
import {
  frozenCopies,
  frozenCopyLine,
  sharedRationalesAcross,
  triggerValue,
} from "@/lib/agent/triggers/frozen-copy";
import { parseLevelTriggers } from "@/lib/agent/triggers/load-levels";
import { applyTriggerDelete } from "@/lib/actions/thesis-edit";
import { describeTrigger } from "@/lib/agent/triggers/ops";
import type { Trigger } from "@/lib/agent/triggers/types";

const ACCOUNT = "34f5c589-e216-4afe-9ee8-613c13f300e7";
const APPLY = process.argv.includes("--apply");

async function main() {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: ACCOUNT },
    select: {
      id: true,
      triggers: true,
      // The removals are recorded as the owner's, because they are: the
      // QB ruled them with Dave's delegation, and the popover path stamps
      // whoever is named here on every Activity line.
      memberships: {
        where: { role: "OWNER" },
        select: { userId: true },
        take: 1,
      },
    },
  });
  const actorUserId = account.memberships[0]?.userId;
  if (!actorUserId) throw new Error("no OWNER membership on the account");
  const accountRules = parseLevelTriggers(account.triggers, "account");

  const analysts = await prisma.agentConfig.findMany({
    where: { accountId: ACCOUNT },
    select: { id: true, name: true, triggers: true },
  });
  const rulesByAnalyst = new Map(
    analysts.map((a) => [a.id, parseLevelTriggers(a.triggers, `analyst=${a.name}`)]),
  );
  const nameByAnalyst = new Map(analysts.map((a) => [a.id, a.name]));

  const theses = await prisma.thesis.findMany({
    where: {
      accountId: ACCOUNT,
      status: { in: ["HOLDING", "WATCHING"] },
      closedAt: null,
    },
    select: {
      id: true,
      ticker: true,
      status: true,
      direction: true,
      triggers: true,
      researchRun: { select: { agentConfigId: true } },
    },
    orderBy: { ticker: "asc" },
  });

  // A sentence is only evidence of a template when it appears somewhere
  // else too, so this is computed across the whole live book first.
  const ladders = theses.map((t) => ({
    ticker: t.ticker,
    triggers: parseLevelTriggers(t.triggers, `thesis=${t.ticker}`) as Trigger[],
  }));
  const sharedRationales = sharedRationalesAcross(ladders);

  const table: Array<Record<string, unknown>> = [];
  let removedTotal = 0;

  for (const t of theses) {
    const own = ladders.find((l) => l.ticker === t.ticker)!.triggers;
    const analystId = t.researchRun?.agentConfigId ?? "";
    const copies = frozenCopies({
      own,
      analyst: rulesByAnalyst.get(analystId) ?? [],
      account: accountRules,
      sharedRationales,
    });
    if (copies.length === 0) continue;

    table.push({
      ticker: t.ticker,
      status: t.status,
      analyst: nameByAnalyst.get(analystId) ?? "(none)",
      before: own.length,
      removed: copies.length,
      after: own.length - copies.length,
    });
    for (const c of copies) {
      // The rule in the Activity feed's words; the bucket is a comparison key, never shown.
      console.log(`  ${t.ticker.padEnd(5)} ${describeTrigger(c.trigger, t.direction).padEnd(40)} ${frozenCopyLine(c)}`);
      if (APPLY) {
        await applyTriggerDelete(
          t.id,
          c.trigger.id,
          { accountId: ACCOUNT, actorUserId },
          // On the stock's Activity, so the line explains itself.
          frozenCopyLine(c),
        );
      }
      removedTotal += 1;
    }
  }

  // What each stock is left holding — the list the PR has to carry, so the
  // "after" can be read without trusting the "removed".
  console.log("\n── what each stock carries afterwards ──────────────────");
  for (const t of theses) {
    const own = ladders.find((l) => l.ticker === t.ticker)!.triggers;
    const analystId = t.researchRun?.agentConfigId ?? "";
    const gone = new Set(
      frozenCopies({
        own,
        analyst: rulesByAnalyst.get(analystId) ?? [],
        account: accountRules,
        sharedRationales,
      }).map((c) => c.trigger.id),
    );
    if (gone.size === 0) continue;
    console.log(`\n${t.ticker} (${nameByAnalyst.get(analystId)}) — ${own.length - gone.size} left:`);
    for (const r of own.filter((x) => !gone.has(x.id))) {
      const v = triggerValue(r);
      console.log(
        `    ${r.action.padEnd(6)} ${r.predicate.kind}${v != null ? ` ${v}` : ""}` +
          `${(r.predicate as { direction?: string }).direction ? ` ${(r.predicate as { direction?: string }).direction}` : ""}` +
          `   [${r.source ?? "unstamped"}]`,
      );
    }
  }

  console.log(`\n${APPLY ? "Removed" : "Would remove"} ${removedTotal} rungs across ${table.length} stocks.`);
  console.table(table);
  if (!APPLY) console.log("\nDry run. Re-run with --apply to write.");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
