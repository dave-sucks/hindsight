/**
 * A fire whose trigger run failed. The trigger is already marked fired, so the
 * check won't fire it again until a close finds it false: the fire is tried
 * again (lib/inngest/retry-then-tell.ts), and the owner is told if it still
 * fails. What is left, read from the database: a trade on the stock since the
 * try means it was acted on; a finished run means it was answered.
 */
import { prisma } from "@/lib/prisma";
import { sendRunLostEmail } from "@/lib/emails/run-lost";
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
  const traded = await prisma.order.findFirst({ where: { thesisId: fire.thesisId, createdAt: { gte: triedAt } }, select: { id: true } });
  if (traded) return "done";
  const answered = await prisma.researchRun.findFirst({
    where: {
      mode: "INTRADAY_TACTICAL",
      status: "COMPLETE",
      startedAt: { gte: triedAt },
      AND: [{ parameters: { path: ["thesisId"], equals: fire.thesisId } }, { parameters: { path: ["triggerId"], equals: fire.triggerId } }],
    },
    select: { id: true },
  });
  // The analyst answered and what followed failed: only a sale still owes the owner its card.
  if (answered) return fire.action === "EXIT" ? "tell" : "done";
  return "retry";
}

export async function tellFire(fire: FailedFire): Promise<void> {
  const analyst = await prisma.agentConfig.findUnique({ where: { id: fire.analystId }, select: { accountId: true, userId: true } });
  if (!analyst) return;
  await sendRunLostEmail({
    accountId: analyst.accountId,
    userId: analyst.userId,
    ticker: fire.ticker,
    subject: `${fire.ticker}: a trigger fired and its run failed`,
    body: `"${fire.sentence ?? "A trigger"}" fired on ${fire.ticker}, but its run didn't finish, so it may need your eye.`,
  });
}
