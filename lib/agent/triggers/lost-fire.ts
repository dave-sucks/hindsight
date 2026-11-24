/**
 * A fire whose trigger run failed. The trigger is already marked fired, so the
 * check won't fire it again until a close finds it false: the fire is tried
 * again here, and if it still fails the owner is told. A try that left a trade
 * or a proposal is never repeated.
 */
import { prisma } from "@/lib/prisma";
import { sendRunLostEmail } from "@/lib/emails/run-lost";

/** Tries one fire gets, the first included. */
export const FIRE_TRIES = 3;

export interface FailedFire {
  thesisId: string;
  triggerId: string;
  analystId: string;
  ticker: string;
  action: string;
  sentence?: string | null;
  /** How many times this fire has been tried again. */
  recoveryTry?: number;
  /** When the first try started: a retry keeps that try's Activity line. */
  firstFiredAt?: string;
}

interface FireStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  sleep(id: string, time: string): Promise<unknown>;
  sendEvent(id: string, event: { name: string; data: unknown }): Promise<unknown>;
}

/** What the failed try leaves to do. */
export async function whatIsLeft(fire: FailedFire, triedAt: Date): Promise<"retry" | "tell" | "nothing"> {
  const traded = await prisma.order.findFirst({ where: { thesisId: fire.thesisId, createdAt: { gte: triedAt } }, select: { id: true } });
  if (traded) return "nothing";
  const answered = await prisma.researchRun.findFirst({
    where: {
      mode: "INTRADAY_TACTICAL",
      status: "COMPLETE",
      startedAt: { gte: triedAt },
      AND: [{ parameters: { path: ["thesisId"], equals: fire.thesisId } }, { parameters: { path: ["triggerId"], equals: fire.triggerId } }],
    },
    select: { id: true },
  });
  // The analyst answered and what followed failed: only a sale still owes the owner a card.
  if (answered) return fire.action === "EXIT" ? "tell" : "nothing";
  return (fire.recoveryTry ?? 0) + 1 >= FIRE_TRIES ? "tell" : "retry";
}

async function tellOwner(fire: FailedFire): Promise<void> {
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

/** The trigger run's failure handler. */
export async function recoverFire(original: { data: FailedFire; ts?: number }, step: FireStep): Promise<{ next: string }> {
  const fire = original.data;
  const triedAt = new Date(original.ts ?? 0);
  const next = await step.run("what-is-left", () => whatIsLeft(fire, triedAt));
  if (next === "retry") {
    await step.sleep("wait-before-retry", "5m");
    await step.sendEvent("retry-fire", {
      name: "app/thesis.trigger.fired",
      data: { ...fire, recoveryTry: (fire.recoveryTry ?? 0) + 1, firstFiredAt: fire.firstFiredAt ?? triedAt.toISOString() },
    });
  }
  if (next === "tell") await step.run("tell-owner", () => tellOwner(fire));
  return { next };
}
