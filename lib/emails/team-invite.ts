// ─── Team Invite email template ─────────────────────────────────────────────
// Sent when an OWNER invites a new member to their Account. Mirrors the
// dark, branded look of trade-closed.ts.

export interface TeamInviteData {
  accountName: string;
  inviterEmail: string;
  role: "EDITOR" | "VIEWER";
  acceptUrl: string;
  expiresInDays: number;
}

export function teamInviteHtml(d: TeamInviteData): string {
  const roleLabel = d.role === "EDITOR" ? "Editor" : "Viewer";
  const roleBlurb =
    d.role === "EDITOR"
      ? "You'll be able to view everything and trigger analyst runs / place paper trades."
      : "You'll have read-only access — every chart, run, and trade, no write actions.";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#030712;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f9fafb;">
  <div style="max-width:560px;margin:32px auto;padding:0 16px;">

    <!-- Header -->
    <div style="margin-bottom:24px;">
      <p style="margin:0;font-size:12px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;">Hindsight</p>
      <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;color:#f9fafb;">
        You've been invited to ${escapeHtml(d.accountName)}
      </h1>
    </div>

    <!-- Body card -->
    <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:20px;margin-bottom:16px;">
      <p style="margin:0 0 12px;font-size:14px;color:#d1d5db;line-height:1.5;">
        <strong style="color:#f9fafb;">${escapeHtml(d.inviterEmail)}</strong>
        invited you to collaborate on Hindsight as
        <strong style="color:#f9fafb;">${roleLabel}</strong>.
      </p>
      <p style="margin:0 0 20px;font-size:13px;color:#9ca3af;line-height:1.5;">
        ${roleBlurb}
      </p>
      <a href="${d.acceptUrl}"
         style="display:inline-block;background:#51b857;color:#0f172a;font-weight:600;font-size:14px;text-decoration:none;padding:10px 18px;border-radius:6px;">
        Accept invite
      </a>
    </div>

    <p style="margin:0 0 16px;font-size:12px;color:#6b7280;">
      This invite expires in ${d.expiresInDays} day${d.expiresInDays === 1 ? "" : "s"}.
      If you weren't expecting it, you can safely ignore this email.
    </p>

    <p style="margin:0;font-size:12px;color:#6b7280;">
      This is an automated message from Hindsight.
    </p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
