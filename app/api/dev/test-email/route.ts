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
import { proposalPendingHtml } from "@/lib/emails/proposal-pending";
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

  const now = new Date();
  const twelveDaysAgo = new Date(now.getTime() - 12 * 86_400_000);

  // Sample 1: trade-opened (post-fill, executed)
  results.tradeOpened = await sendEmail({
    to: toEmail,
    subject: "[TEST] AI Infrastructure Analyst bought 10 NVDA",
    html: tradeOpenedHtml({
      ticker: "NVDA",
      tickerName: "NVIDIA Corp.",
      direction: "LONG",
      qty: 10,
      avgCost: 875.4,
      currentPrice: 881.12,
      stopLoss: 840,
      targetPrice: 950,
      analystName: "AI Infrastructure Analyst",
      thesisSummary:
        "AI compute demand remains structural — recent guide-raise reaffirms our long bias through the next earnings cycle.",
      environment: "PAPER",
      positionId: "test-position-id",
      openedAt: now,
    }),
  });

  // Sample 2: trade-closed (post-exit, with realized gain)
  results.tradeClosed = await sendEmail({
    to: toEmail,
    subject: "[TEST] Catalyst Event PM sold 25 AAPL for +8.4%",
    html: tradeClosedHtml({
      ticker: "AAPL",
      tickerName: "Apple Inc.",
      direction: "LONG",
      qty: 25,
      entryPrice: 178.2,
      closePrice: 193.21,
      currentPrice: 193.21,
      realizedPnl: 375.25,
      realizedPnlPct: 8.4,
      outcome: "WIN",
      closeReason: "TARGET",
      daysHeld: 12,
      tradeId: "test-position-id",
      analystName: "Catalyst Event PM",
      environment: "PAPER",
      openedAt: twelveDaysAgo,
      closedAt: now,
    }),
  });

  // Sample 3: proposal-pending (LIVE buy awaiting approval)
  results.proposalBuy = await sendEmail({
    to: toEmail,
    subject: "[TEST] [LIVE] Catalyst Event PM wants to buy 38 LNTH",
    html: proposalPendingHtml({
      analystName: "Catalyst Event PM",
      ticker: "LNTH",
      tickerName: "Lantheus Holdings",
      direction: "LONG",
      intent: "OPEN",
      qty: 38,
      estimatedPrice: 102.84,
      estimatedCost: 38 * 102.84,
      currentPrice: 102.84,
      targetPrice: 118,
      stopLoss: 95.5,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      rationale:
        "ENTER trigger validated: live $LNTH quote still holds above the $102.82 breakout level at ~$102.84, trend remains bullish above the 20/50-day SMAs, and there are no contradictory recent headlines in the feed. June 29 FDA PDUFA setup remains intact.",
      environment: "LIVE",
      positionId: "test-proposal-id",
    }),
  });

  // Sample 4: proposal-pending (paper close, projected gain)
  results.proposalSell = await sendEmail({
    to: toEmail,
    subject: "[TEST] Momentum Breakout wants to sell 53 MRVL",
    html: proposalPendingHtml({
      analystName: "Momentum Breakout",
      ticker: "MRVL",
      tickerName: "Marvell Technology",
      direction: "LONG",
      intent: "CLOSE",
      qty: 53,
      estimatedPrice: 286.07,
      estimatedCost: 53 * 286.07,
      entryPrice: 217.6,
      currentPrice: 286.07,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      rationale:
        "TARGET trigger fired: $MRVL is +31.5% from entry and breached the $285 level on heavy volume. Recommending exit before the upcoming earnings print to lock in the move.",
      environment: "PAPER",
      positionId: "test-proposal-id",
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
