/**
 * POST /api/dev/test-email
 *
 * Fires a sample of each email template to the calling user's auth email.
 * Used to verify Resend wiring end-to-end (FROM address verified, API key
 * set, recipient lookup works) without waiting for a real trade or the
 * 10 AM digest cron.
 *
 * Auth-gated: requires a logged-in Supabase session. The send goes to that
 * user's own auth email — no recipient parameter, so it can't be abused as
 * a relay.
 *
 * Returns a per-template breakdown of whether Resend accepted each send.
 * Check Vercel logs for [sendEmail] entries if any return false.
 */
import { createClient } from "@/lib/supabase/server";
import { sendEmail, getUserEmail } from "@/lib/email";
import { tradeOpenedHtml } from "@/lib/emails/trade-opened";
import { tradeClosedHtml } from "@/lib/emails/trade-closed";
import { dailyRunDigestHtml } from "@/lib/emails/daily-run-digest";

// Accept GET so you can fire the test by just visiting the URL in a logged-in
// browser tab. Auth-gated, so even if a stray fetch hits it, only the logged-in
// user can trigger sends — and only to their own address.
export async function GET() {
  return handler();
}

export async function POST() {
  return handler();
}

async function handler() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const toEmail = (await getUserEmail(user.id)) ?? user.email;
  if (!toEmail) {
    return Response.json(
      { error: "No email address on file for this user" },
      { status: 400 },
    );
  }

  const results: Record<string, boolean> = {};

  // Sample 1: trade-opened
  results.tradeOpened = await sendEmail({
    to: toEmail,
    subject: "[TEST] 📈 Bought NVDA — Test Analyst",
    html: tradeOpenedHtml({
      ticker: "NVDA",
      direction: "LONG",
      qty: 10,
      avgCost: 875.4,
      stopLoss: 840,
      targetPrice: 950,
      analystName: "Test Analyst",
      thesisSummary:
        "Sample trade-opened email. AI compute demand remains structural; recent guide raised reaffirms our long bias through the next earnings cycle.",
    }),
  });

  // Sample 2: trade-closed
  results.tradeClosed = await sendEmail({
    to: toEmail,
    subject: "[TEST] ✅ AAPL closed +8.4% — WIN",
    html: tradeClosedHtml({
      ticker: "AAPL",
      direction: "LONG",
      entryPrice: 178.2,
      closePrice: 193.21,
      realizedPnl: 150.1,
      realizedPnlPct: 8.4,
      outcome: "WIN",
      closeReason: "TARGET",
      daysHeld: 12,
      tradeId: "test-position-id",
    }),
  });

  // Sample 3: daily run digest
  results.dailyDigest = await sendEmail({
    to: toEmail,
    subject: "[TEST] Morning Run Digest — Sample",
    html: dailyRunDigestHtml({
      date: "Test Day, Sample Date",
      analysts: [
        {
          analystName: "AI Infrastructure Analyst",
          actions: [
            {
              ticker: "NVDA",
              kind: "BOUGHT",
              description: "10 @ $875.40 · $8,754 · stop $840.00 · target $950.00",
            },
            {
              ticker: "AAPL",
              kind: "SOLD",
              description: "WIN · +8.4% · 25 @ $193.21",
            },
            {
              ticker: "AMD",
              kind: "ADDED",
              description: "Scaled in · 30 shares now @ avg $142.50",
            },
            {
              ticker: "TSLA",
              kind: "REDUCED",
              description: "Partial close · 15 shares remaining @ avg $175.20",
            },
            {
              ticker: "FIVN",
              kind: "WATCH",
              description: "Added to watchlist · target $42.00 · cloud contact-center inflection",
            },
          ],
        },
        {
          analystName: "Quiet Analyst",
          actions: [],
        },
      ],
    }),
  });

  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? "Hindsight <onboarding@resend.dev>";
  const apiKeyConfigured = !!process.env.RESEND_API_KEY;

  return Response.json({
    to: toEmail,
    from: fromAddress,
    apiKeyConfigured,
    results,
    allSucceeded: Object.values(results).every((v) => v),
  });
}
