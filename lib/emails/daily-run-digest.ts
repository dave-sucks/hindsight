// ─── Daily Run Digest email template ─────────────────────────────────────────
// Mirrors the in-app "Summarizing run" card exactly: light theme, subtle
// border, each row = square ticker logo + bold ticker + chip pill + muted
// description on the right. Only action rows render (Bought / Shorted /
// Sold / Covered / Added / Reduced / Watch); Hold and Pass are skipped by
// the cron upstream.

export type DigestActionKind =
  | "BOUGHT"
  | "SHORTED"
  | "SOLD"
  | "COVERED"
  | "ADDED"
  | "REDUCED"
  | "WATCH";

export interface DigestActionRow {
  ticker: string;
  kind: DigestActionKind;
  /** Right-aligned muted description, e.g. "10 @ $875.40 · $8,754 · stop $840". */
  description: string;
}

export interface DigestAnalyst {
  analystName: string;
  actions: DigestActionRow[];
}

export interface DailyRunDigestData {
  /** "Monday, May 11" (already formatted in ET). */
  date: string;
  analysts: DigestAnalyst[];
}

const CHIP_STYLES: Record<DigestActionKind, { color: string; label: string }> = {
  BOUGHT: { color: "#22c55e", label: "Bought" },
  SHORTED: { color: "#22c55e", label: "Shorted" },
  SOLD: { color: "#94a3b8", label: "Sold" },
  COVERED: { color: "#94a3b8", label: "Covered" },
  ADDED: { color: "#3b82f6", label: "Added" },
  REDUCED: { color: "#f59e0b", label: "Reduced" },
  WATCH: { color: "#3b82f6", label: "Watch" },
};

// Light-mode palette — matches the in-app summary card.
const COLORS = {
  pageBg: "#ffffff",
  cardBg: "#ffffff",
  cardBorder: "#e5e7eb",
  textPrimary: "#0f172a",
  textMuted: "#64748b",
  textFaint: "#94a3b8",
  chipBg: "#f1f5f9",
  chipText: "#334155",
  logoBg: "#f8fafc",
};

export function dailyRunDigestHtml(d: DailyRunDigestData): string {
  const totalActions = d.analysts.reduce((s, a) => s + a.actions.length, 0);
  const summaryLine =
    totalActions === 0
      ? "No actions taken this morning."
      : `${totalActions} action${totalActions !== 1 ? "s" : ""} across ${d.analysts.length} analyst${d.analysts.length !== 1 ? "s" : ""}.`;

  const sections = d.analysts.map(renderAnalystSection).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:${COLORS.pageBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${COLORS.textPrimary};">
  <div style="max-width:640px;margin:0 auto;padding:40px 20px;">

    <!-- Header -->
    <div style="margin-bottom:24px;">
      <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${COLORS.textFaint};">Hindsight Agent</p>
      <h1 style="margin:10px 0 0;font-size:22px;font-weight:700;color:${COLORS.textPrimary};letter-spacing:-0.01em;">
        Morning Run Digest — ${escapeHtml(d.date)}
      </h1>
      <p style="margin:8px 0 0;font-size:14px;color:${COLORS.textMuted};">${escapeHtml(summaryLine)}</p>
    </div>

    ${sections}

    <!-- Footer -->
    <p style="margin:24px 0 0;font-size:12px;color:${COLORS.textFaint};">
      Automated message from your Hindsight trading agent. Disable trade alerts per analyst on the analyst's settings page.
    </p>
  </div>
</body>
</html>`;
}

function renderAnalystSection(a: DigestAnalyst): string {
  const body =
    a.actions.length === 0
      ? `<p style="margin:12px 0 0;font-size:14px;color:${COLORS.textFaint};font-style:italic;">No actions taken this morning.</p>`
      : `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:12px;">
          ${a.actions.map(renderActionRow).join("")}
        </table>`;

  return `
    <div style="background:${COLORS.cardBg};border:1px solid ${COLORS.cardBorder};border-radius:10px;padding:20px 22px;margin-bottom:14px;">
      <h2 style="margin:0;font-size:15px;font-weight:600;color:${COLORS.textPrimary};">${escapeHtml(a.analystName)}</h2>
      ${body}
    </div>
  `;
}

function renderActionRow(row: DigestActionRow): string {
  const style = CHIP_STYLES[row.kind] ?? { color: COLORS.textFaint, label: row.kind };
  const logoUrl = `https://assets.parqet.com/logos/symbol/${encodeURIComponent(row.ticker)}`;

  return `
    <tr>
      <td style="padding:8px 0;width:36px;vertical-align:middle;">
        <img src="${logoUrl}" alt="" width="28" height="28" style="display:block;border-radius:6px;background:${COLORS.logoBg};border:1px solid ${COLORS.cardBorder};" />
      </td>
      <td style="padding:8px 12px;vertical-align:middle;white-space:nowrap;">
        <span style="font-size:14px;font-weight:700;color:${COLORS.textPrimary};letter-spacing:0.01em;">${escapeHtml(row.ticker)}</span>
        <span style="margin-left:10px;display:inline-block;padding:3px 9px;border-radius:999px;background:${COLORS.chipBg};font-size:11px;font-weight:500;color:${COLORS.chipText};">
          <span style="display:inline-block;width:6px;height:6px;border-radius:999px;background:${style.color};margin-right:6px;vertical-align:middle;"></span>${style.label}
        </span>
      </td>
      <td style="padding:8px 0;vertical-align:middle;text-align:right;font-size:13px;color:${COLORS.textMuted};font-variant-numeric:tabular-nums;">
        ${escapeHtml(row.description)}
      </td>
    </tr>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
