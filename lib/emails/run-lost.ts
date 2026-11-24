/**
 * The email when work that had to happen didn't: a filled buy's After the buy
 * or a fired trigger's run failed, the app tried again, and it stopped.
 */
import { sendEmail } from "@/lib/email";
import { getEmailRecipients } from "./recipients";
import { appBaseUrl, escapeHtml } from "./trade-card";

/** True once everyone who wants this email has it (no one opted in counts). */
export async function sendRunLostEmail(args: { accountId: string; userId: string; ticker: string; subject: string; body: string }): Promise<boolean> {
  const to = await getEmailRecipients(args.accountId, "TRADE_ACTIVITY", { fallbackUserId: args.userId });
  if (to.length === 0) return true;
  const url = `${appBaseUrl()}/stocks/${encodeURIComponent(args.ticker)}`;
  const html = `<p>${escapeHtml(args.body)}</p><p><a href="${url}">Open ${escapeHtml(args.ticker)}</a></p>`;
  const sent = await Promise.all(to.map((address) => sendEmail({ to: address, subject: args.subject, html })));
  return sent.some(Boolean);
}
