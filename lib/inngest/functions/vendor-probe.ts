/**
 * vendor-probe — 6:25 AM ET every weekday, five minutes before the
 * intelligence pipeline wakes: hit every market-data endpoint we depend on
 * with a mid-cap name from the book and say, out loud, which ones did not
 * answer. DAV-239.
 *
 * Output:
 *   - one log line every run: `[vendor-probe] ok=8 empty=0 error=0 (SMMT)`
 *   - an email to the account's digest recipients ONLY when something is
 *     `empty` or `error` — a quiet vendor must never be quiet twice.
 *
 * The probe itself (lib/market-data/vendor-probe.ts) is pure apart from the
 * clients; this file only picks the ticker, resolves credentials, and
 * reports.
 */

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { sendEmail } from "@/lib/email";
import { getEmailRecipients } from "@/lib/emails/recipients";
import {
  DEFAULT_PROBE_TICKER,
  runVendorProbe,
  summarizeProbe,
  type ProbeResult,
} from "@/lib/market-data/vendor-probe";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function reportHtml(ticker: string, results: ProbeResult[]): string {
  const rows = results
    .map(
      (r) =>
        `<tr><td style="padding:4px 8px">${escapeHtml(r.source)}</td>` +
        `<td style="padding:4px 8px;font-weight:${r.status === "ok" ? "normal" : "bold"}">${r.status}</td>` +
        `<td style="padding:4px 8px">${escapeHtml(r.detail)}</td>` +
        `<td style="padding:4px 8px;text-align:right">${r.ms} ms</td></tr>`,
    )
    .join("");
  return (
    `<p>Probed with <b>${escapeHtml(ticker)}</b>. A source marked <b>empty</b> answered 200 with nothing in it — ` +
    `that is the reply the app used to log as "ok". A source marked <b>error</b> refused or timed out.</p>` +
    `<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">` +
    `<tr><th align="left" style="padding:4px 8px">Source</th><th align="left" style="padding:4px 8px">Status</th>` +
    `<th align="left" style="padding:4px 8px">Detail</th><th style="padding:4px 8px">Time</th></tr>${rows}</table>` +
    `<p style="color:#666;font-size:12px">Every thesis written while a source is empty is missing that input. ` +
    `Ticket: DAV-239.</p>`
  );
}

export const vendorProbe = inngest.createFunction(
  {
    id: "vendor-probe",
    name: "Vendor Probe (market-data health)",
    retries: 0,
  },
  { cron: "TZ=America/New_York 25 6 * * 1-5" },
  async ({ step }) => {
    // A held mid-cap from the book, else the standing default. Never a
    // mega-cap: the free lists cover those, which is how the August audit
    // missed FMP refusing the rest of the book.
    const target = await step.run("pick-ticker", async () => {
      const held = await prisma.thesis.findFirst({
        where: { status: "HOLDING" },
        orderBy: { updatedAt: "desc" },
        select: { ticker: true, researchRun: { select: { agentConfigId: true } } },
      });
      const analystId = held?.researchRun?.agentConfigId ?? null;
      const analyst = analystId
        ? await prisma.agentConfig.findUnique({
            where: { id: analystId },
            select: { userId: true, accountId: true },
          })
        : await prisma.agentConfig.findFirst({
            where: { enabled: true },
            select: { userId: true, accountId: true },
          });
      return {
        ticker: held?.ticker ?? DEFAULT_PROBE_TICKER,
        userId: analyst?.userId ?? null,
        accountId: analyst?.accountId ?? null,
      };
    });

    const results = await step.run("probe", async () => {
      const creds = target.userId
        ? ((await resolveAlpacaCredentials(target.userId)) ?? undefined)
        : undefined;
      return runVendorProbe(target.ticker, { creds });
    });

    const summary = summarizeProbe(target.ticker, results);
    const bad = results.filter((r) => r.status !== "ok");
    if (bad.length === 0) {
      console.log(`[vendor-probe] ${summary}`);
      return { ticker: target.ticker, summary, emailed: false };
    }
    console.warn(`[vendor-probe] ${summary}`);

    const emailed = await step.run("email-on-failure", async () => {
      if (!target.accountId) return false;
      const to = await getEmailRecipients(target.accountId, "DAILY_DIGEST", {
        fallbackUserId: target.userId ?? undefined,
      });
      if (to.length === 0) return false;
      const subject = `Hindsight: ${bad.length} data source${bad.length === 1 ? "" : "s"} not answering (${target.ticker})`;
      const html = reportHtml(target.ticker, results);
      const sent = await Promise.all(to.map((addr) => sendEmail({ to: addr, subject, html })));
      return sent.some(Boolean);
    });

    return { ticker: target.ticker, summary, emailed };
  },
);
