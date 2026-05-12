// ─── Trade Opened email template ─────────────────────────────────────────────
// Light-mode card matching the in-app "Summarizing run" visual: white bg,
// subtle gray border, single ticker row with logo + ticker + chip, and a
// stats grid below. Fires from place_trade after a fill on Alpaca.

export interface TradeOpenedData {
  ticker: string;
  direction: "LONG" | "SHORT";
  qty: number;
  avgCost: number;
  stopLoss?: number | null;
  targetPrice?: number | null;
  analystName: string;
  thesisSummary?: string | null;
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
  rowDivider: "#f1f5f9",
};

export function tradeOpenedHtml(d: TradeOpenedData): string {
  const isLong = d.direction === "LONG";
  const verb = isLong ? "Bought" : "Shorted";
  const chipColor = "#22c55e"; // both directions are an "open" action

  const stopPct =
    d.stopLoss != null && d.avgCost > 0
      ? isLong
        ? ((d.stopLoss - d.avgCost) / d.avgCost) * 100
        : ((d.avgCost - d.stopLoss) / d.avgCost) * 100
      : null;
  const targetPct =
    d.targetPrice != null && d.avgCost > 0
      ? isLong
        ? ((d.targetPrice - d.avgCost) / d.avgCost) * 100
        : ((d.avgCost - d.targetPrice) / d.avgCost) * 100
      : null;
  const riskReward =
    stopPct != null && targetPct != null && Math.abs(stopPct) > 0.001
      ? Math.abs(targetPct / stopPct)
      : null;

  const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  const fmtPrice = (n: number) => `$${n.toFixed(2)}`;

  const stopCell =
    d.stopLoss != null && stopPct != null
      ? `${fmtPrice(d.stopLoss)} <span style="color:${COLORS.textFaint};">(${fmtPct(stopPct)})</span>`
      : `<span style="color:${COLORS.textFaint};">—</span>`;
  const targetCell =
    d.targetPrice != null && targetPct != null
      ? `${fmtPrice(d.targetPrice)} <span style="color:${COLORS.textFaint};">(${fmtPct(targetPct)})</span>`
      : `<span style="color:${COLORS.textFaint};">—</span>`;
  const rrCell =
    riskReward != null
      ? `${riskReward.toFixed(1)}:1`
      : `<span style="color:${COLORS.textFaint};">—</span>`;

  const notional = d.qty * d.avgCost;
  const logoUrl = `https://assets.parqet.com/logos/symbol/${encodeURIComponent(d.ticker)}`;

  const thesisBlock = d.thesisSummary
    ? `
    <div style="margin-top:14px;padding:14px 16px;background:${COLORS.logoBg};border-radius:8px;">
      <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${COLORS.textFaint};">Thesis</p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:${COLORS.textMuted};">${escapeHtml(truncate(d.thesisSummary, 240))}</p>
    </div>`
    : "";

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
      <p style="margin:8px 0 0;font-size:14px;color:${COLORS.textMuted};">${escapeHtml(d.analystName)}</p>
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
            ${d.qty.toLocaleString()} @ ${fmtPrice(d.avgCost)}
          </td>
        </tr>
      </table>
    </div>

    <!-- Stats card -->
    <div style="background:${COLORS.cardBg};border:1px solid ${COLORS.cardBorder};border-radius:10px;padding:20px 22px;margin-bottom:14px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:6px 0;font-size:13px;color:${COLORS.textMuted};">Notional</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:${COLORS.textPrimary};font-variant-numeric:tabular-nums;">$${notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:${COLORS.textMuted};">Stop loss</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:${COLORS.negative};font-variant-numeric:tabular-nums;">${stopCell}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:${COLORS.textMuted};">Price target</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:${COLORS.positive};font-variant-numeric:tabular-nums;">${targetCell}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:${COLORS.textMuted};">Risk / reward</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:${COLORS.textPrimary};font-variant-numeric:tabular-nums;">${rrCell}</td>
        </tr>
      </table>
      ${thesisBlock}
    </div>

    <!-- Footer -->
    <p style="margin:0;font-size:12px;color:${COLORS.textFaint};">
      Automated message from your Hindsight trading agent. Disable trade alerts per analyst on the analyst's settings page.
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

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
