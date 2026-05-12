// ─── Trade Closed email template ─────────────────────────────────────────────
// Light-mode card matching trade-opened + daily digest: white bg, subtle
// border, action row with logo + ticker + chip, stats grid below.

export interface TradeClosedData {
  ticker: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  closePrice: number;
  realizedPnl: number;
  realizedPnlPct: number;
  outcome: "WIN" | "LOSS" | "BREAKEVEN";
  closeReason: string;
  daysHeld: number;
  tradeId: string;
}

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
  positive: "#16a34a",
  negative: "#dc2626",
  neutral: "#f59e0b",
};

const REASON_LABELS: Record<string, string> = {
  TARGET: "Price target reached",
  STOP: "Stop loss hit",
  TIME: "Time exit",
  MANUAL: "Manually closed",
};

export function tradeClosedHtml(d: TradeClosedData): string {
  const isWin = d.outcome === "WIN";
  const isBreakeven = d.outcome === "BREAKEVEN";
  const pnlColor = isWin ? COLORS.positive : isBreakeven ? COLORS.neutral : COLORS.negative;
  const sign = d.realizedPnl >= 0 ? "+" : "";
  const isLong = d.direction === "LONG";
  const verb = isLong ? "Sold" : "Covered";
  const chipColor = "#94a3b8"; // closed = neutral gray dot

  const reasonLabel = REASON_LABELS[d.closeReason] ?? d.closeReason;
  const logoUrl = `https://assets.parqet.com/logos/symbol/${encodeURIComponent(d.ticker)}`;

  const outcomePill = isWin
    ? `<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:#dcfce7;color:${COLORS.positive};font-size:11px;font-weight:600;letter-spacing:0.04em;">WIN</span>`
    : isBreakeven
      ? `<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:#fef3c7;color:${COLORS.neutral};font-size:11px;font-weight:600;letter-spacing:0.04em;">BREAKEVEN</span>`
      : `<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:#fee2e2;color:${COLORS.negative};font-size:11px;font-weight:600;letter-spacing:0.04em;">LOSS</span>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:${COLORS.pageBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${COLORS.textPrimary};">
  <div style="max-width:640px;margin:0 auto;padding:40px 20px;">

    <!-- Header -->
    <div style="margin-bottom:24px;">
      <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${COLORS.textFaint};">Hindsight Agent</p>
      <h1 style="margin:10px 0 0;font-size:22px;font-weight:700;color:${COLORS.textPrimary};letter-spacing:-0.01em;">
        ${verb} ${escapeHtml(d.ticker)}
      </h1>
      <p style="margin:8px 0 0;font-size:14px;color:${COLORS.textMuted};">
        ${outcomePill}
        <span style="margin-left:8px;color:${pnlColor};font-weight:600;font-variant-numeric:tabular-nums;">${sign}${d.realizedPnlPct.toFixed(1)}%</span>
        <span style="margin-left:8px;color:${COLORS.textFaint};">·</span>
        <span style="margin-left:8px;color:${COLORS.textMuted};">held ${d.daysHeld}d</span>
      </p>
    </div>

    <!-- Action row (matches digest row style) -->
    <div style="background:${COLORS.cardBg};border:1px solid ${COLORS.cardBorder};border-radius:10px;padding:16px 22px;margin-bottom:14px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:0;width:36px;vertical-align:middle;">
            <img src="${logoUrl}" alt="" width="28" height="28" style="display:block;border-radius:6px;background:${COLORS.logoBg};border:1px solid ${COLORS.cardBorder};" />
          </td>
          <td style="padding:0 12px;vertical-align:middle;white-space:nowrap;">
            <span style="font-size:14px;font-weight:700;color:${COLORS.textPrimary};letter-spacing:0.01em;">${escapeHtml(d.ticker)}</span>
            <span style="margin-left:10px;display:inline-block;padding:3px 9px;border-radius:999px;background:${COLORS.chipBg};font-size:11px;font-weight:500;color:${COLORS.chipText};">
              <span style="display:inline-block;width:6px;height:6px;border-radius:999px;background:${chipColor};margin-right:6px;vertical-align:middle;"></span>${verb}
            </span>
          </td>
          <td style="padding:0;vertical-align:middle;text-align:right;font-size:13px;color:${COLORS.textMuted};font-variant-numeric:tabular-nums;">
            $${d.entryPrice.toFixed(2)} → $${d.closePrice.toFixed(2)}
          </td>
        </tr>
      </table>
    </div>

    <!-- Stats card -->
    <div style="background:${COLORS.cardBg};border:1px solid ${COLORS.cardBorder};border-radius:10px;padding:20px 22px;margin-bottom:14px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:6px 0;font-size:13px;color:${COLORS.textMuted};">Direction</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:${COLORS.textPrimary};">${isLong ? "Long" : "Short"}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:${COLORS.textMuted};">Entry</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:${COLORS.textPrimary};font-variant-numeric:tabular-nums;">$${d.entryPrice.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:${COLORS.textMuted};">Exit</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:${COLORS.textPrimary};font-variant-numeric:tabular-nums;">$${d.closePrice.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:${COLORS.textMuted};">Realized P&amp;L</td>
          <td style="padding:6px 0;font-size:15px;font-weight:700;text-align:right;color:${pnlColor};font-variant-numeric:tabular-nums;">${sign}$${d.realizedPnl.toFixed(2)} (${sign}${d.realizedPnlPct.toFixed(1)}%)</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:${COLORS.textMuted};">Days held</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:${COLORS.textPrimary};font-variant-numeric:tabular-nums;">${d.daysHeld}d</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:${COLORS.textMuted};">Close reason</td>
          <td style="padding:6px 0;font-size:13px;text-align:right;color:${COLORS.textPrimary};">${escapeHtml(reasonLabel)}</td>
        </tr>
      </table>
    </div>

    <!-- Footer -->
    <p style="margin:0;font-size:12px;color:${COLORS.textFaint};">
      Automated message from your Hindsight trading agent.
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
