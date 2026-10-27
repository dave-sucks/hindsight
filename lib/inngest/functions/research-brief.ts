/**
 * research-brief — builds the research brief for an order (lib/research/brief.ts).
 * proposal-pending-email — waits up to 30s for that brief, then sends the
 * proposal email with whatever is on file; a brief that lands later shows on
 * the card. The push is not here: it goes out the instant the proposal is staged.
 */

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { briefForOrder } from "@/lib/research/brief";
import { sendProposalPendingEmail } from "@/lib/emails/proposal-pending";
import { BRIEF_REQUESTED, PROPOSAL_PENDING, type BriefRequestedData } from "@/lib/research/brief-events";

/** How long the proposal email waits for its brief. */
export const EMAIL_WAITS_FOR_BRIEF_MS = 30_000;

export const researchBrief = inngest.createFunction(
  // One build per stock at a time, so a second order on the same name reuses the first.
  { id: "research-brief", retries: 1, concurrency: { key: "event.data.ticker", limit: 1 } },
  { event: BRIEF_REQUESTED },
  async ({ event, step }) => {
    const { orderId, kind } = event.data as BriefRequestedData;
    return step.run("build", () => briefForOrder(orderId, kind));
  },
);

interface StepLike {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  invoke(id: string, opts: { function: unknown; data: BriefRequestedData; timeout: number }): Promise<unknown>;
}

/** The proposal email's steps, exported so a test can drive them with a fake step. */
export async function proposalEmailSteps(orderId: string, step: StepLike): Promise<{ briefOnTime: boolean }> {
  const ticker = await step.run("order", async () =>
    (await prisma.order.findUnique({ where: { id: orderId }, select: { symbol: true } }))?.symbol ?? null,
  );
  let briefOnTime = false;
  if (ticker) {
    try {
      await step.invoke("brief", {
        function: researchBrief,
        data: { orderId, ticker: ticker.toUpperCase(), kind: "PROPOSAL" },
        timeout: EMAIL_WAITS_FOR_BRIEF_MS,
      });
      briefOnTime = true;
    } catch (err) {
      // Timed out or failed: the email goes now, the build carries on and the card picks it up.
      console.warn(`[proposal-pending-email] brief not ready for ${orderId}:`, err instanceof Error ? err.message : err);
    }
  }
  await step.run("email", () => sendProposalPendingEmail(orderId));
  return { briefOnTime };
}

export const proposalPendingEmail = inngest.createFunction(
  { id: "proposal-pending-email", retries: 2 },
  { event: PROPOSAL_PENDING },
  async ({ event, step }) => proposalEmailSteps((event.data as { orderId: string }).orderId, step as unknown as StepLike),
);
