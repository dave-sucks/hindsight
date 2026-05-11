// ─── Daily Run Digest email template ─────────────────────────────────────────
// One email per owner at 10 AM ET on weekdays. Mirrors the in-app
// "Summarizing run" UI: per-row, a company logo + ticker + action chip + a
// short description. Shows only ACTION items (Bought / Sold / Added /
// Reduced / Watch) — Hold and Pass are intentionally skipped because they
// mean "nothing happened" and would just be noise in an inbox.

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
  /** Short right-aligned description, e.g. "10 shares · $8,754 · stop $840 / target $950". */
  description: string;
  /** Optional tone — drives chip color. Defaults are derived from `kind`. */
  tone?: "positive" | "negative" | "neutral" | "watch";
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

// Tone → (dot color, label) for the chip.
const CHIP_STYLES: Record<
  DigestActionKind,
  { color: string; label: string; tone: "positive" | "negative" | "neutral" | "watch" }
> = {
  BOUGHT: { color: "#51b857", label: "Bought", tone: "positive" },
  SHORTED: { color: "#51b857", label: "Shorted", tone: "positive" },
  SOLD: { color: "#9ca3af", label: "Sold", tone: "neutral" },
  COVERED: { color: "#9ca3af", label: "Covered", tone: "neutral" },
  ADDED: { color: "#60a5fa", label: "Added", tone: "positive" },
  REDUCED: { color: "#f59e0b", label: "Reduced", tone: "negative" },
  WATCH: { color: "#60a5fa", label: "Watch", tone: "watch" },
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
<body style="margin:0;padding:0;background:#030712;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f9fafb;">
  <div style="max-width:640px;margin:32px auto;padding:0 16px;">

    <!-- Header -->
    <div style="margin-bottom:24px;">
      <p style="margin:0;font-size:12px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;">Hindsight Agent</p>
      <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;color:#f9fafb;">
        Morning Run Digest — ${escapeHtml(d.date)}
      </h1>
      <p style="margin:8px 0 0;font-size:13px;color:#9ca3af;">${escapeHtml(summaryLine)}</p>
    </div>

    ${sections}

    <!-- Footer -->
    <p style="margin:24px 0 0;font-size:12px;color:#6b7280;">
      This is an automated message from your Hindsight trading agent. You can disable trade alerts per analyst on the analyst's settings page.
    </p>
  </div>
</body>
</html>`;
}

function renderAnalystSection(a: DigestAnalyst): string {
  const body =
    a.actions.length === 0
      ? `<p style="margin:8px 0 0;font-size:13px;color:#6b7280;font-style:italic;">No actions taken this morning.</p>`
      : `<table role="presentation" style="width:100%;border-collapse:collapse;margin-top:8px;">
          ${a.actions.map(renderActionRow).join("")}
        </table>`;

  return `
    <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:20px;margin-bottom:16px;">
      <h2 style="margin:0;font-size:15px;font-weight:600;color:#f9fafb;">${escapeHtml(a.analystName)}</h2>
      ${body}
    </div>
  `;
}

function renderActionRow(row: DigestActionRow): string {
  const style = CHIP_STYLES[row.kind] ?? {
    color: "#9ca3af",
    label: row.kind,
    tone: "neutral" as const,
  };
  const logoUrl = `https://assets.parqet.com/logos/symbol/${encodeURIComponent(row.ticker)}`;

  return `
    <tr>
      <td style="padding:10px 0;width:36px;vertical-align:middle;">
        <img src="${logoUrl}" alt="" width="28" height="28" style="display:block;border-radius:6px;background:#1f2937;" />
      </td>
      <td style="padding:10px 8px;vertical-align:middle;white-space:nowrap;">
        <span style="font-size:14px;font-weight:700;color:#f9fafb;letter-spacing:0.02em;">${escapeHtml(row.ticker)}</span>
        <span style="margin-left:8px;display:inline-block;padding:2px 8px;border-radius:999px;background:#1f2937;font-size:11px;font-weight:500;color:#e5e7eb;">
          <span style="display:inline-block;width:6px;height:6px;border-radius:999px;background:${style.color};margin-right:5px;vertical-align:middle;"></span>${style.label}
        </span>
      </td>
      <td style="padding:10px 0;vertical-align:middle;text-align:right;font-size:12px;color:#9ca3af;font-variant-numeric:tabular-nums;">
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
