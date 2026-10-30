/**
 * proposal-pending-email — the approval email. A trade a run proposed, or an
 * Auto trade, waits up to a quarter of an hour for the run's note
 * (lib/proposals/auto-writeup.ts), then goes with whatever is on the order;
 * your chat's proposal carries your chat's words and goes at once. The push
 * is not here: it goes out the instant the proposal is staged.
 */

import { inngest } from "@/lib/inngest/client";
import { sendProposalPendingEmail } from "@/lib/emails/proposal-pending";
import { PROPOSAL_PENDING } from "@/lib/proposals/proposal-events";
import { NOTE_WRITTEN, writeupComing } from "@/lib/proposals/auto-writeup";

/** How long the email waits for the run's note: a morning run can take a quarter of an hour. */
export const EMAIL_WAITS_FOR_NOTE = "15m";

interface StepLike {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  waitForEvent(id: string, opts: { event: string; if: string; timeout: string }): Promise<unknown>;
}

/** The email's steps, exported so a test can drive them with a fake step. */
export async function proposalEmailSteps(orderId: string, step: StepLike): Promise<{ waited: boolean }> {
  const coming = await step.run("writeup-coming", () => writeupComing(orderId));
  // The note for this order: `async` is the awaited event, `event` the proposal's own.
  if (coming) await step.waitForEvent("note-written", { event: NOTE_WRITTEN, if: "async.data.orderId == event.data.orderId", timeout: EMAIL_WAITS_FOR_NOTE });
  await step.run("email", () => sendProposalPendingEmail(orderId));
  return { waited: coming };
}

export const proposalPendingEmail = inngest.createFunction(
  { id: "proposal-pending-email", retries: 2 },
  { event: PROPOSAL_PENDING },
  async ({ event, step }) => proposalEmailSteps((event.data as { orderId: string }).orderId, step as unknown as StepLike),
);
