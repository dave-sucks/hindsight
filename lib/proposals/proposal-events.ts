/**
 * The event behind the approval email (lib/inngest/functions/proposal-pending-email.ts).
 * Sending never throws: a failed send is logged and the email goes out at once.
 */

import { inngest } from "@/lib/inngest/client";

export const PROPOSAL_PENDING = "app/proposal.pending";

/** A proposal is waiting: the email goes from Inngest, or now if Inngest can't take the event. */
export function emitProposalPending(orderId: string, sendEmailNow: () => unknown): void {
  void Promise.resolve()
    .then(() => inngest.send({ name: PROPOSAL_PENDING, id: `proposal-pending-${orderId}`, data: { orderId } }))
    .catch((err) => {
      console.warn(`[proposal-pending] could not send ${PROPOSAL_PENDING}:`, err instanceof Error ? err.message : err);
      void Promise.resolve().then(sendEmailNow).catch(() => undefined);
    });
}
