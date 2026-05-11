// ─── Trade Opened email template ─────────────────────────────────────────────
// Fires from place_trade.ts after a paper order fills on Alpaca. Visual style
// mirrors trade-closed.ts for consistency in the user's inbox.

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

export function tradeOpenedHtml(d: TradeOpenedData): string {
  const isLong = d.direction === "LONG";
  const directionEmoji = isLong ? "📈" : "📉";
  const directionVerb = isLong ? "Bought" : "Shorted";

  // Percent moves from the actual fill price.
  // For LONG: stop is below entry (negative %), target above (positive %).
  // For SHORT: stop is above entry (still expressed as "% loss"), target below.
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
      ? `${fmtPrice(d.stopLoss)} <span style="color:#6b7280;">(${fmtPct(stopPct)})</span>`
      : `<span style="color:#6b7280;">—</span>`;
  const targetCell =
    d.targetPrice != null && targetPct != null
      ? `${fmtPrice(d.targetPrice)} <span style="color:#6b7280;">(${fmtPct(targetPct)})</span>`
      : `<span style="color:#6b7280;">—</span>`;
  const rrCell =
    riskReward != null
      ? `${riskReward.toFixed(1)}:1`
      : `<span style="color:#6b7280;">—</span>`;

  const notional = d.qty * d.avgCost;

  const thesisBlock = d.thesisSummary
    ? `
    <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:16px;margin-bottom:16px;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;">Thesis</p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#d1d5db;">${escapeHtml(truncate(d.thesisSummary, 240))}</p>
    </div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#030712;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f9fafb;">
  <div style="max-width:560px;margin:32px auto;padding:0 16px;">

    <!-- Header -->
    <div style="margin-bottom:24px;">
      <p style="margin:0;font-size:12px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;">${escapeHtml(d.analystName)}</p>
      <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;color:#f9fafb;">
        ${directionEmoji} ${directionVerb} ${escapeHtml(d.ticker)}
      </h1>
    </div>

    <!-- Stats card -->
    <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:20px;margin-bottom:16px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;">Direction</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:#f9fafb;">${isLong ? "📈 Long" : "📉 Short"}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;">Position</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:#f9fafb;font-variant-numeric:tabular-nums;">${d.qty.toLocaleString()} shares @ ${fmtPrice(d.avgCost)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;">Notional</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:#f9fafb;font-variant-numeric:tabular-nums;">$${notional.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;">Stop loss</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:#ff6d87;font-variant-numeric:tabular-nums;">${stopCell}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;">Price target</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:#51b857;font-variant-numeric:tabular-nums;">${targetCell}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;">Risk / reward</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:#f9fafb;font-variant-numeric:tabular-nums;">${rrCell}</td>
        </tr>
      </table>
    </div>
    ${thesisBlock}

    <!-- Footer -->
    <p style="margin:0;font-size:12px;color:#6b7280;">
      This is an automated message from your Hindsight trading agent. You can disable trade alerts on the analyst's settings page.
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
