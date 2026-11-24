/**
 * A fire whose trigger run failed. The trigger is already marked fired, so the
 * check won't fire it again until a close finds it false: the fire is tried
 * again (lib/inngest/retry-then-tell.ts), and the owner is told if it still
 * fails. What is left, read from the database: an order on the stock since the
 * try means it was acted on; a run for it that finished, or wrote on the
 * stock, means it was answered. An Auto trade is tried again only while its
 * trigger still holds.
 */
import { prisma } from "@/lib/prisma";
import { sendRunLostEmail } from "@/lib/emails/run-lost";
import { parseTriggersResilient } from "./schema";
import { trueNowIds } from "./true-now";
import type { Trigger } from "./types";
import type { Left, Retried } from "@/lib/inngest/retry-then-tell";

export interface FailedFire extends Retried {
  thesisId: string;
  triggerId: string;
  analystId: string;
  ticker: string;
  action: string;
  sentence?: string | null;
}

/** What the failed try leaves to do. */
export async function fireLeft(fire: FailedFire, triedAt: Date): Promise<Left> {
  // Without the try's time nothing can be checked, so the owner is told.
  if (!(triedAt.getTime() > 0)) return "tell";
  const traded = await prisma.order.findFirst({
    where: { thesisId: fire.thesisId, createdAt: { gte: triedAt }, status: { in: ["AWAITING_APPROVAL", "PENDING", "FILLED"] } },
    select: { id: true },
  });
  if (traded) return "done";
  const runs = await prisma.researchRun.findMany({
    where: {
      mode: "INTRADAY_TACTICAL",
      startedAt: { gte: triedAt },
      AND: [{ parameters: { path: ["thesisId"], equals: fire.thesisId } }, { parameters: { path: ["triggerId"], equals: fire.triggerId } }],
    },
    select: { id: true, status: true },
  });
  // A run that wrote on the stock (beyond the fire's own line) answered it, finished or not.
  const wrote = runs.length
    ? await prisma.thesisUpdate.findFirst({ where: { runId: { in: runs.map((r) => r.id) }, type: { not: "TRIGGER_FIRED" } }, select: { id: true } })
    : null;
  // The analyst answered and what followed failed: only a sale still owes the owner its card.
  if (wrote || runs.some((r) => r.status === "COMPLETE")) return fire.action === "EXIT" ? "tell" : "done";
  // An Auto trade has no agent to read the stock now: it goes again only while its trigger still holds.
  const auto = await autoTrigger(fire);
  if (auto && !(await trueNowIds(fire.thesisId, auto.who, [auto.trigger])).has(auto.trigger.id)) return "tell";
  return "retry";
}

async function autoTrigger(fire: FailedFire): Promise<{ trigger: Trigger; who: { userId: string; analystId: string } } | null> {
  const thesis = await prisma.thesis.findUnique({ where: { id: fire.thesisId }, select: { userId: true, triggers: true } });
  const trigger = (parseTriggersResilient(thesis?.triggers).triggers as Trigger[]).find((t) => t.id === fire.triggerId);
  return thesis && trigger?.fireMode === "DO_IT" ? { trigger, who: { userId: thesis.userId, analystId: fire.analystId } } : null;
}

export async function tellFire(fire: FailedFire): Promise<void> {
  const analyst = await prisma.agentConfig.findUnique({ where: { id: fire.analystId }, select: { accountId: true, userId: true } });
  if (!analyst) return;
  const sent = await sendRunLostEmail({
    accountId: analyst.accountId,
    userId: analyst.userId,
    ticker: fire.ticker,
    subject: `${fire.ticker}: a trigger fired and its run failed`,
    body: `"${fire.sentence ?? "A trigger"}" fired on ${fire.ticker}, but its run didn't finish, so it may need your eye.`,
  });
  // Unsent, the step fails and is tried again.
  if (!sent) throw new Error(`the email about ${fire.ticker}'s failed fire didn't send`);
}
