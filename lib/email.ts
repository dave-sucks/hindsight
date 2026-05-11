import { Resend } from "resend";

// FROM lives in env so we can change verified-domain configuration without
// a code deploy. The fallback ("Hindsight <onboarding@resend.dev>") is
// Resend's shared sender — works without a verified domain and is the
// least-broken default for local/dev. In prod, set RESEND_FROM_ADDRESS
// to a verified-domain address like "Hindsight <alerts@inbound.coulda.app>".
const FROM = process.env.RESEND_FROM_ADDRESS ?? "Hindsight <onboarding@resend.dev>";

// ─── Send helper ─────────────────────────────────────────────────────────────
//
// Returns true if Resend accepted the send (i.e. delivery is the SMTP layer's
// problem now), false otherwise. The boolean is for the test-email route +
// any caller that wants to know. Production callers that use sendEmail in a
// fire-and-forget pattern ignore the return value — but the helper no longer
// silently swallows everything. Errors are logged so a misconfigured FROM /
// missing API key shows up in Vercel logs instead of failing invisibly.

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[sendEmail] RESEND_API_KEY not set — skipping send");
    return false;
  }
  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({ from: FROM, to, subject, html });
    if (result.error) {
      console.error("[sendEmail] Resend rejected send:", {
        to,
        subject,
        from: FROM,
        error: result.error,
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error("[sendEmail] threw:", {
      to,
      subject,
      from: FROM,
      err: err instanceof Error ? err.message : err,
    });
    return false;
  }
}

// ─── Get a user's auth email via Supabase admin ───────────────────────────────

export async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data } = await admin.auth.admin.getUserById(userId);
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}
