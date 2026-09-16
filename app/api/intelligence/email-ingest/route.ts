// ── Resend Inbound Email Webhook — retired ────────────────────────────────
//
// This endpoint used to be the last live producer of the Signals pipeline:
// every newsletter Resend forwarded became GPT-extracted "signals" (92 in
// the week before it was switched off), which fed a router that had been
// paused since 2026-05-31 — and, on any BREAKING label on a held ticker,
// could spawn a full daily run. That spawn was the one path in the retired
// machinery that cost money.
//
// Retired 2026-09-10 (principal's decision; docs/plans/MARKET_DATA.md §1);
// the extraction, signal-writing and urgent-run code was deleted 2026-09-15.
// The signals it wrote are kept and still readable on /intelligence. The
// route stays so Resend gets a clean 200 and stops retrying — there is no
// signature check because nothing is acted on. Stop the forward at Resend
// too, so the mailbox stops paying for delivery.

import { NextResponse } from "next/server";

export async function POST(req: Request) {
  // Drain the body so the connection closes cleanly; ignore the content.
  await req.text().catch(() => "");
  return NextResponse.json({ ok: true, skipped: "signals-retired" });
}
