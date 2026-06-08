/**
 * Daily Run Digest email — one summary email per morning cron, listing
 * every action the user's analysts took.
 *
 * Visual language matches the unified trade-card primitive: same color
 * tokens, same eyebrow + h1 header, same logo + ticker row pattern, same
 * CTA banner. The difference is density — a digest can carry a dozen rows
 * across multiple analysts, so each row is a compact line instead of a
 * full stats card.
 *
 * Analysts with zero actions are filtered out at render time. If the
 * caller passes them in (the cron does), the renderer drops them — never
 * shows a "No actions taken this morning" stub. The cron also bails out
 * before sending when totalActions === 0, so this is belt + suspenders.
 */

import {
  TRADE_CARD_COLORS,
  escapeHtml,
  tradesIndexUrl,
} from "./trade-card";

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

// Per-kind dot color + label. Greens for entries (BOUGHT/SHORTED), reds for
// exits (SOLD/COVERED), blue for ADD/WATCH (informational), amber for partial
// reduce. Colors come from the shared trade-card palette so the digest reads
// as part of the same family as the per-trade emails.
const KIND_STYLES: Record<DigestActionKind, { dot: string; label: string }> = {
  BOUGHT: { dot: TRADE_CARD_COLORS.positive, label: "Bought" },
  SHORTED: { dot: TRADE_CARD_COLORS.positive, label: "Shorted" },
  SOLD: { dot: TRADE_CARD_COLORS.negative, label: "Sold" },
  COVERED: { dot: TRADE_CARD_COLORS.negative, label: "Covered" },
  ADDED: { dot: "#3b82f6", label: "Added" }, // blue-500
  REDUCED: { dot: "#f59e0b", label: "Reduced" }, // amber-500
  WATCH: { dot: "#3b82f6", label: "Watch" }, // blue-500
};

export function dailyRunDigestHtml(d: DailyRunDigestData): string {
  const C = TRADE_CARD_COLORS;

  // Filter out empty-action analysts at render time. The cron already
  // refuses to send when totalActions === 0; this guards against any other
  // caller (preview routes, manual triggers) accidentally passing empties
  // through.
  const populated = d.analysts.filter((a) => a.actions.length > 0);
  const totalActions = populated.reduce((s, a) => s + a.actions.length, 0);

  if (totalActions === 0) {
    // Defensive — caller really shouldn't reach here. Render a minimal
    // empty-state instead of a half-broken card.
    return emptyDigestHtml(d.date);
  }

  const summaryLine = `${totalActions} action${totalActions !== 1 ? "s" : ""} across ${populated.length} analyst${populated.length !== 1 ? "s" : ""}.`;
  const sections = populated.map((a) => renderAnalystSection(a, C)).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:${C.pageBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${C.textPrimary};">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">

    <!-- Header -->
    <div style="margin-bottom:18px;">
      <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${C.textFaint};">Hindsight Agent</p>
      <h1 style="margin:8px 0 0;font-size:20px;font-weight:700;line-height:1.3;color:${C.textPrimary};letter-spacing:-0.01em;">
        Morning Run Digest — ${escapeHtml(d.date)}
      </h1>
      <p style="margin:6px 0 0;font-size:13px;color:${C.textMuted};">${escapeHtml(summaryLine)}</p>
    </div>

    ${sections}

    <!-- CTA -->
    <div style="margin:18px 0 0;padding:12px 14px;background:${C.logoBg};border:1px solid ${C.cardBorder};border-radius:10px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="font-size:13px;color:${C.textMuted};">Open Hindsight to review today's trades.</td>
          <td style="text-align:right;white-space:nowrap;">
            <a href="${escapeHtml(tradesIndexUrl())}" style="display:inline-block;padding:6px 14px;background:${C.textPrimary};color:${C.pageBg};font-size:13px;font-weight:600;text-decoration:none;border-radius:8px;">Open</a>
          </td>
        </tr>
      </table>
    </div>

    <!-- Footer -->
    <p style="margin:18px 0 0;font-size:12px;color:${C.textFaint};line-height:1.5;">
      Automated message from your Hindsight trading agent. Disable trade alerts per analyst on the analyst's settings page.
    </p>
  </div>
</body>
</html>`;
}

/**
 * One analyst's section: small uppercase analyst-name eyebrow above a
 * bordered card whose rows are the actions. No "no actions" stub — empty
 * analysts are filtered out before we get here.
 */
function renderAnalystSection(
  a: DigestAnalyst,
  C: typeof TRADE_CARD_COLORS,
): string {
  const rows = a.actions.map((row) => renderActionRow(row, C)).join("");
  return `
    <div style="margin:0 0 14px;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${C.textFaint};">${escapeHtml(a.analystName)}</p>
      <div style="background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:10px;overflow:hidden;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
          ${rows}
        </table>
      </div>
    </div>
  `;
}

function renderActionRow(
  row: DigestActionRow,
  C: typeof TRADE_CARD_COLORS,
): string {
  const style = KIND_STYLES[row.kind] ?? { dot: C.textFaint, label: row.kind };
  const logoUrl = `https://assets.parqet.com/logos/symbol/${encodeURIComponent(row.ticker)}`;

  return `
    <tr>
      <td style="padding:10px 14px;width:36px;vertical-align:middle;border-bottom:1px solid ${C.rowBorder};">
        <img src="${logoUrl}" alt="" width="24" height="24" style="display:block;border-radius:6px;background:${C.logoBg};border:1px solid ${C.cardBorder};" />
      </td>
      <td style="padding:10px 0;vertical-align:middle;white-space:nowrap;border-bottom:1px solid ${C.rowBorder};">
        <span style="font-size:13px;font-weight:700;color:${C.textPrimary};letter-spacing:0.01em;">${escapeHtml(row.ticker)}</span>
        <span style="margin-left:8px;display:inline-block;padding:2px 8px;border-radius:999px;background:${C.chipBg};font-size:11px;font-weight:500;color:${C.chipText};">
          <span style="display:inline-block;width:6px;height:6px;border-radius:999px;background:${style.dot};margin-right:6px;vertical-align:middle;"></span>${style.label}
        </span>
      </td>
      <td style="padding:10px 14px;vertical-align:middle;text-align:right;font-size:12px;color:${C.textMuted};font-variant-numeric:tabular-nums;border-bottom:1px solid ${C.rowBorder};">
        ${escapeHtml(row.description)}
      </td>
    </tr>
  `;
}

/**
 * Defensive empty-state — only renders if a caller bypassed the cron's
 * zero-activity gate. The cron itself never sends in this case.
 */
function emptyDigestHtml(date: string): string {
  const C = TRADE_CARD_COLORS;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:${C.pageBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${C.textPrimary};">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${C.textFaint};">Hindsight Agent</p>
    <h1 style="margin:8px 0 0;font-size:20px;font-weight:700;color:${C.textPrimary};letter-spacing:-0.01em;">
      Morning Run Digest — ${escapeHtml(date)}
    </h1>
    <p style="margin:8px 0 0;font-size:13px;color:${C.textMuted};">No actions taken this morning.</p>
  </div>
</body>
</html>`;
}
