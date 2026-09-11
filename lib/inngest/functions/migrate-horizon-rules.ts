/**
 * One-time: move each account's sell rules to one set per horizon (DAV-250).
 *
 * Event-triggered, never on a cron. Send `app/triggers.horizon-rules.migrate`
 * with `{ dryRun?: boolean, loosen?: string[] }`. `dryRun` defaults to TRUE —
 * the run returns the plan and writes nothing; send `dryRun: false` to apply.
 * `loosen` names the held compounders whose own tighter trail sell comes off
 * (Dave's ruling: ["ASML", "CEG", "WST"]).
 *
 * The plan itself is `planHorizonRules` (pure, tested against the book as it
 * stood on 2026-09-11). Idempotent: a second run finds the account already on
 * horizon rules, nothing to pin and nothing to loosen, and writes nothing.
 */

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { parseLevelTriggers } from "@/lib/agent/triggers/load-levels";
import { planHorizonRules, type HeldThesisRow } from "@/lib/agent/triggers/horizon-rules-migration";
import { predicateSentence } from "@/lib/agent/triggers/format";
import type { Trigger } from "@/lib/agent/triggers/types";

const line = (t: Trigger) => `${predicateSentence(t.predicate)} → ${t.action}`;

export const migrateHorizonRules = inngest.createFunction(
  {
    id: "migrate-horizon-rules",
    name: "Migrate sell rules to per-horizon (DAV-250)",
    concurrency: { limit: 1 },
    retries: 0,
  },
  { event: "app/triggers.horizon-rules.migrate" },
  async ({ event, step }) => {
    const dryRun = event.data?.dryRun !== false;
    const loosen: string[] = Array.isArray(event.data?.loosen) ? event.data.loosen : [];

    return step.run("plan-and-apply", async () => {
      const accounts = await prisma.account.findMany({
        where: { triggersSeededAt: { not: null } },
        select: { id: true, name: true, triggers: true },
      });
      const report = [];

      for (const acct of accounts) {
        const analysts = await prisma.agentConfig.findMany({
          where: { accountId: acct.id },
          select: { id: true, triggers: true },
        });
        const analystRules = new Map(
          analysts.map((a) => [a.id, parseLevelTriggers(a.triggers, `analyst=${a.id}`)]),
        );
        const theses = await prisma.thesis.findMany({
          where: { status: "HOLDING", researchRun: { agentConfigId: { in: analysts.map((a) => a.id) } } },
          select: {
            id: true,
            ticker: true,
            horizon: true,
            direction: true,
            triggers: true,
            researchRun: { select: { agentConfigId: true } },
          },
        });
        const held: HeldThesisRow[] = theses.map((t) => ({
          id: t.id,
          ticker: t.ticker,
          horizon: t.horizon,
          direction: t.direction,
          triggers: parseLevelTriggers(t.triggers, `thesis=${t.id}`),
          analystRules: analystRules.get(t.researchRun?.agentConfigId ?? "") ?? [],
        }));

        const plan = planHorizonRules({
          account: parseLevelTriggers(acct.triggers, `account=${acct.id}`),
          held,
          loosen,
          mintId: () => globalThis.crypto.randomUUID(),
        });

        if (!dryRun) {
          await prisma.$transaction(async (tx) => {
            if (plan.account) {
              await tx.account.update({
                where: { id: acct.id },
                data: { triggers: plan.account.next as unknown as object },
              });
            }
            for (const c of plan.theses) {
              await tx.thesis.update({
                where: { id: c.thesisId },
                data: { triggers: c.nextTriggers as unknown as object },
              });
              const ops = [
                ...c.pinned.map((t) => ({ op: "add", id: t.id, text: line(t) })),
                ...c.loosened.map((t) => ({ op: "remove", id: t.id, text: line(t) })),
              ];
              await tx.thesisUpdate.create({
                data: {
                  thesisId: c.thesisId,
                  type: "UPDATED",
                  summary: c.loosened.length
                    ? `Sell line loosened to the compounder's rules (principal's ruling): ${c.loosened.map(line).join("; ")}`
                    : `Sell line kept on ${c.ticker} as the account moved to per-horizon sell rules: ${c.pinned.map(line).join("; ")}`,
                  rationale: c.loosened.length
                    ? "Named by the principal on DAV-250: this compounder carried an automatic 8% sale its mandate forbids. It now inherits the compounder rules — a 15% give-back is a review, 25% is the only automatic sale."
                    : "The account's sell rules now come in one set per horizon (DAV-250). This stock inherited a tighter line than its horizon's new rules; it is kept here at today's value. Only the principal lowers it.",
                  fieldChanges: { triggerOps: { from: null, to: ops } } as unknown as object,
                },
              });
            }
          });
        }

        report.push({
          account: acct.name,
          accountRules: plan.account
            ? { removed: plan.account.removed.map(line), added: plan.account.added.map((t) => `${t.horizons?.join("+") ?? "every"}: ${line(t)}`) }
            : "already on per-horizon rules",
          theses: plan.theses.map((c) => ({
            ticker: c.ticker,
            pinned: c.pinned.map(line),
            loosened: c.loosened.map(line),
          })),
          warnings: plan.warnings,
        });
      }

      return { dryRun, loosen, report };
    });
  },
);
