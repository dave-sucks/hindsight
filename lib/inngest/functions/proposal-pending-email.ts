/**
 * proposal-pending-email — the approval email. A trade an analyst proposed
 * carries its note and goes at once; an Auto trade waits up to six minutes
 * for the analyst's write-up (lib/proposals/auto-writeup.ts), then goes with
 * whatever is on the order. The push is not here: it goes out the instant
 * the proposal is staged.
 */

import { inngest } from "@/lib/inngest/client";
import { sendProposalPendingEmail } from "@/lib/emails/proposal-pending";
import { PROPOSAL_PENDING } from "@/lib/proposals/proposal-events";
import { NOTE_WRITTEN, writeupComing } from "@/lib/proposals/auto-writeup";

/** How long the email waits for an Auto trade's write-up. */
export const EMAIL_WAITS_FOR_NOTE = "6m";

interface StepLike {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  waitForEvent(id: string, opts: { event: string; match: string; timeout: string }): Promise<unknown>;
}

/** The email's steps, exported so a test can drive them with a fake step. */
export async function proposalEmailSteps(orderId: string, step: StepLike): Promise<{ waited: boolean }> {
  const coming = await step.run("writeup-coming", () => writeupComing(orderId));
  if (coming) await step.waitForEvent("note-written", { event: NOTE_WRITTEN, match: "data.orderId", timeout: EMAIL_WAITS_FOR_NOTE });
  await step.run("email", () => sendProposalPendingEmail(orderId));
  return { waited: coming };
}

export const proposalPendingEmail = inngest.createFunction(
  { id: "proposal-pending-email", retries: 2 },
  { event: PROPOSAL_PENDING },
  async ({ event, step }) => proposalEmailSteps((event.data as { orderId: string }).orderId, step as unknown as StepLike),
);
