/**
 * The two events behind the research brief (lib/inngest/functions/research-brief.ts).
 * Sending never throws: a failed send is logged and, where given, a fallback runs.
 */

import { inngest } from "@/lib/inngest/client";
import type { BriefKind } from "@/lib/research/brief-types";

export const BRIEF_REQUESTED = "app/research.brief.requested";
export const PROPOSAL_PENDING = "app/proposal.pending";

export interface BriefRequestedData {
  orderId: string;
  ticker: string;
  kind: BriefKind;
}

function sendSoft(event: { name: string; id?: string; data: object }, fallback?: () => unknown): void {
  void Promise.resolve()
    .then(() => inngest.send(event))
    .catch((err) => {
      console.warn(`[research-brief] could not send ${event.name}:`, err instanceof Error ? err.message : err);
      if (fallback) void Promise.resolve().then(fallback).catch(() => undefined);
    });
}

/** A proposal is waiting: the email goes out with its brief, or alone if Inngest can't take the event. */
export function emitProposalPending(orderId: string, sendEmailNow: () => unknown): void {
  sendSoft({ name: PROPOSAL_PENDING, id: `proposal-pending-${orderId}`, data: { orderId } }, sendEmailNow);
}

/** A sale went out without approval: build its brief so it is on file. */
export function requestSaleBrief(orderId: string, ticker: string): void {
  const data: BriefRequestedData = { orderId, ticker: ticker.toUpperCase(), kind: "SALE" };
  sendSoft({ name: BRIEF_REQUESTED, id: `research-brief-${orderId}`, data });
}
